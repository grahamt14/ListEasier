// CategoryContext.jsx - Global category state management
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { cacheService } from './CacheService';

const CategoryContext = createContext();

export const useCategories = () => {
  const context = useContext(CategoryContext);
  if (!context) {
    throw new Error('useCategories must be used within CategoryProvider');
  }
  return context;
};

export const CategoryProvider = ({ children }) => {
  const [categories, setCategories] = useState({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [error, setError] = useState(null);

  // AWS Configuration
  const REGION = "us-east-2";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const dynamoClient = useMemo(() => {
    return new DynamoDBClient({
      region: REGION,
      credentials: fromCognitoIdentityPool({
        clientConfig: { region: REGION },
        identityPoolId: IDENTITY_POOL_ID,
      }),
    });
  }, []);

  // Helper function to clean category data
  const cleanCategoryData = (categoryData) => {
    const cleaned = {};
    Object.entries(categoryData).forEach(([category, subcategories]) => {
      // Skip invalid categories
      if (!category || category === '[object Object]') {
        return;
      }
      // Filter out invalid subcategories
      const validSubcategories = (subcategories || []).filter(sub => 
        sub && sub !== '[object Object]'
      );
      if (validSubcategories.length > 0) {
        cleaned[category] = validSubcategories;
      }
    });
    // Always ensure -- option exists
    cleaned['--'] = ['--'];
    return cleaned;
  };

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        console.log('📚 CategoryContext: Starting category fetch...');
        setCategoriesLoading(true);
        setError(null);
        
        const cacheKey = 'categories_all';
        const cachedCategories = cacheService.get(cacheKey);
        
        if (cachedCategories) {
          console.log('📚 CategoryContext: Using cached categories');
          setCategories(cleanCategoryData(cachedCategories));
          setCategoriesLoading(false);
          return;
        }

        const scanCommand = new ScanCommand({
          TableName: 'ListCategory',
        });

        const response = await dynamoClient.send(scanCommand);
        const categoryData = {};
        
        // Properly unmarshall DynamoDB items
        const items = response.Items?.map(item => unmarshall(item)) || [];
        
        items.forEach(item => {
          // Ensure category and subcategory are strings
          const category = typeof item.Category === 'string' ? item.Category : String(item.Category || '');
          const subcategory = typeof item.SubCategory === 'string' ? item.SubCategory : String(item.SubCategory || '');
          
          // Skip invalid entries
          if (!category || category === '[object Object]' || !subcategory || subcategory === '[object Object]') {
            console.warn('⚠️ CategoryContext: Skipping invalid category entry:', item);
            return;
          }
          
          if (!categoryData[category]) {
            categoryData[category] = [];
          }
          categoryData[category].push(subcategory);
        });
        
        categoryData['--'] = ['--'];
        
        // Cache the clean data
        cacheService.set(cacheKey, categoryData, null, 'categories');
        
        console.log('📚 CategoryContext: Categories loaded successfully');
        setCategories(cleanCategoryData(categoryData));
      } catch (err) {
        console.error('📚 CategoryContext: Error fetching categories:', err);
        setError(err.message);
        
        // Try to use cached data as fallback
        const fallbackData = cacheService.get('categories_all');
        if (fallbackData) {
          console.log('📚 CategoryContext: Using cached fallback');
          setCategories(cleanCategoryData(fallbackData));
        } else {
          // Ultimate fallback categories
          console.log('📚 CategoryContext: Using hardcoded fallback');
          setCategories({
            '--': ['--'],
            'Electronics': ['Cell Phones', 'Computers', 'Gaming'],
            'Collectibles': ['Sports Cards', 'Coins', 'Comics'],
            'Clothing': ['Men', 'Women', 'Children']
          });
        }
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, [dynamoClient]);

  const value = {
    categories,
    categoriesLoading,
    error,
    refreshCategories: () => {
      // Clear cache and refetch
      cacheService.delete('categories_all');
      window.location.reload();
    }
  };

  return (
    <CategoryContext.Provider value={value}>
      {children}
    </CategoryContext.Provider>
  );
};