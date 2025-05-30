// FormSection.jsx - Enhanced for Batch Mode with eBay Integration
import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';

// Import caching service
import { cacheService } from './CacheService';
import { useCategories } from './CategoryContext';

// Import the optimized image handlers and uploader
import OptimizedImageUploader from './OptimizedImageUploader';
import { processImagesInBatch, isHeicFile, convertHeicToJpeg } from './OptimizedImageHandler';
import EbayAuth from './EbayAuth';
import EbayPolicySelector from './EbayPolicySelector';
import EbayMarketplaceSelector from './EbayMarketplaceSelector';
import './OptimizedUploaderStyles.css';
import './EbayAuth.css';

export const getSelectedCategoryOptionsJSON = (fieldSelections, price, sku, ebayPolicies = null) => {
  const output = {};
  Object.entries(fieldSelections).forEach(([label, value]) => {
    output[label] = value || "-- Select --";
  });
  if (price) output["price"] = price;
  if (sku) output["sku"] = sku;
  
  if (ebayPolicies) {
    if (ebayPolicies.paymentPolicyId) output["ebayPaymentPolicyId"] = ebayPolicies.paymentPolicyId;
    if (ebayPolicies.fulfillmentPolicyId) output["ebayFulfillmentPolicyId"] = ebayPolicies.fulfillmentPolicyId;
    if (ebayPolicies.returnPolicyId) output["ebayReturnPolicyId"] = ebayPolicies.returnPolicyId;
  }
  
  return output;
};
const buildEnhancedCategoryFieldsPrompt = (categoryFields, fieldSelections) => {
  const emptyFields = categoryFields.filter(field => {
    const currentValue = fieldSelections[field.FieldLabel];
    return !currentValue || currentValue === "-- Select --" || currentValue.trim() === "";
  });

  if (emptyFields.length === 0) {
    return "";
  }

  let prompt = "\n\nADDITIONAL TASK: Based on the images and any existing information, please attempt to determine appropriate values for the following category fields that the user has not filled in:\n\n";

  emptyFields.forEach(field => {
    prompt += `**${field.FieldLabel}**:\n`;
    
    if (field.CategoryOptions && field.CategoryOptions.trim()) {
      const options = field.CategoryOptions.split(';').map(opt => opt.trim()).filter(opt => opt);
      if (options.length > 0 && options.length <= 20) {
        prompt += `- Choose from: ${options.join(', ')}\n`;
      } else if (options.length > 20) {
        prompt += `- Choose from available options (there are ${options.length} total options)\n`;
      }
    } else {
      prompt += `- Provide an appropriate value\n`;
    }
    prompt += `- If you cannot determine a value from the images, use "Unknown" or "Not Specified"\n\n`;
  });

  prompt += `Please include these determined values in your JSON response under the existing field names. Only provide values for fields you can reasonably determine from the images. If you cannot determine a value with confidence, use "Unknown" or leave the field unchanged.\n`;

  return prompt;
};

function FormSection({ onGenerateListing, onCategoryFieldsChange, batchMode = false, currentBatch = null }) {
  const { state, dispatch } = useAppState();
  const {
    filesBase64,
    category,
    subCategory,
    errorMessages,
    batchSize,
    selectedImages,
    imageGroups,
    isLoading,
    isDirty,
    totalChunks,
    completedChunks,
    price,
    sku,
    fieldSelections,
    imageRotations,
    rawFiles,
    uploadStatus,
    processedGroupIndices,
    processingStatus,
    groupMetadata
  } = state;
  
  const { isAuthenticated: ebayAuthenticated, selectedPolicies } = useEbayAuth();
  
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Use global categories from context
  const { categories, categoriesLoading } = useCategories();
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [showEbayAuth, setShowEbayAuth] = useState(false);
  const [aiResolveCategoryFields, setAiResolveCategoryFields] = useState(false);
  const [cacheStats, setCacheStats] = useState(null);

  useEffect(() => {
    if (onCategoryFieldsChange) {
      onCategoryFieldsChange(categoryFields);
    }
  }, [categoryFields, onCategoryFieldsChange]);
  
  // AWS Configuration
  const REGION = "us-east-2";
  const BUCKET_NAME = "listeasier";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const client = new DynamoDBClient({
   region: REGION,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId: IDENTITY_POOL_ID,
    }),
  });
  
  const handleAutoRotateToggle = (e) => {
    setAutoRotateEnabled(e.target.checked);
  };

  const handleAiResolveCategoryFieldsToggle = (e) => {
    setAiResolveCategoryFields(e.target.checked);
  };

  const docClient = DynamoDBDocumentClient.from(client);
  
  const s3Client = new S3Client({
    region: REGION,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId: IDENTITY_POOL_ID,
    }),
    endpoint: `https://s3.${REGION}.amazonaws.com`,
    forcePathStyle: false,
  });

 const handleClearAllLocal = () => {
  if (batchMode && currentBatch) {
    // In batch mode, clear current working state but keep batch info
    console.log('🧹 FormSection: Clearing working state in batch mode');
    
    // Keep category and subcategory from batch
    setSelectedCategory(currentBatch.category || "--");
    setSubcategories(categories[currentBatch.category] || ["--"]);
    setCategoryFields([]);
    setAutoRotateEnabled(false);
    setAiResolveCategoryFields(false);
    
    // Clear images and groups but keep processed data structure
    dispatch({ type: 'SET_FILES_BASE64', payload: [] });
    dispatch({ type: 'SET_RAW_FILES', payload: [] });
    dispatch({ type: 'SET_IMAGE_ROTATIONS', payload: {} });
    dispatch({ type: 'SET_SELECTED_IMAGES', payload: [] });
    
    // Reset image groups to initial state but keep existing processed groups
    const newImageGroups = [...state.imageGroups];
    // Keep processed groups, but add fresh empty group at end
    if (newImageGroups[newImageGroups.length - 1]?.length > 0) {
      newImageGroups.push([]);
    }
    dispatch({ type: 'SET_IMAGE_GROUPS', payload: newImageGroups });
    
  } else {
    // Original behavior for non-batch mode - clear everything
    console.log('🧹 FormSection: Clearing all state in normal mode');
    setSelectedCategory("--");
    setSubcategories(categories["--"] || ["--"]);
    setCategoryFields([]);
    setAutoRotateEnabled(false);
    setAiResolveCategoryFields(false);
    
    dispatch({ type: 'CLEAR_ALL' });
    dispatch({ type: 'CLEAR_PROCESSED_GROUPS' });
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: [] });
  }

  // Clear cache for categories
  cacheService.delete(`categories_all`);
  if (category !== '--' && subCategory !== '--') {
    cacheService.delete(cacheService.getCategoryKey(category, subCategory));
  }
};

  const handleEbayAuthSuccess = () => {
    console.log('eBay authentication successful');
  };

  const handleEbayAuthError = (error) => {
    console.error('eBay authentication error:', error);
    dispatch({ type: 'ADD_ERROR_MESSAGE', payload: `eBay authentication failed: ${error}` });
  };

  const handlePolicyChange = (policyType, policy) => {
    console.log(`Selected ${policyType}:`, policy);
  };


  // Enhanced category fields fetching with caching
  useEffect(() => {
    if (!subCategory || subCategory === "--") {
      setCategoryFields([]);
      dispatch({ type: 'SET_FIELD_SELECTIONS', payload: {} });
      return;
    }

    const fetchCategoryFieldsWithCache = async () => {
      try {
        const cachedFields = cacheService.getCategoryFields(category, subCategory);
        
        if (cachedFields) {
          setCategoryFields(cachedFields);
          
          const initialSelections = {};
          cachedFields.forEach(item => {
            initialSelections[item.FieldLabel] = "";
          });
          dispatch({ type: 'SET_FIELD_SELECTIONS', payload: initialSelections });
          return;
        }
        
        const dynamoQuery = {
          TableName: 'CategoryFields',
          KeyConditionExpression: 'SubCategoryType = :sub',
          ExpressionAttributeValues: {
            ':sub': { S: subCategory },
          },
        };
        
        let cachedDynamoResponse = cacheService.getDynamoDBResponse('CategoryFields', dynamoQuery);
        let response;
        
        if (cachedDynamoResponse) {
          response = cachedDynamoResponse;
        } else {
          const command = new QueryCommand(dynamoQuery);
          response = await client.send(command);
          cacheService.setDynamoDBResponse('CategoryFields', dynamoQuery, response);
        }
        
        const items = response.Items?.map(item => unmarshall(item)) || [];
        
        cacheService.setCategoryFields(category, subCategory, items);
        
        setCategoryFields(items);

        const initialSelections = {};
        items.forEach(item => {
          initialSelections[item.FieldLabel] = "";
        });
        dispatch({ type: 'SET_FIELD_SELECTIONS', payload: initialSelections });
      } catch (error) {
        console.error('Error fetching category fields:', error);
        setCategoryFields([]);
        dispatch({ type: 'SET_FIELD_SELECTIONS', payload: {} });
      }
    };

    fetchCategoryFieldsWithCache();
  }, [category, subCategory, dispatch]);

  // Synchronize selected category with global state
  useEffect(() => {
    if (category !== selectedCategory) {
      setSelectedCategory(category);
      if (categories[category]) {
        setSubcategories(categories[category]);
      }
    }
  }, [category, categories, selectedCategory]);

  // Update cache stats periodically
  useEffect(() => {
    const updateCacheStats = () => {
      if (process.env.NODE_ENV === 'development') {
        setCacheStats(cacheService.getStats());
      }
    };

    updateCacheStats();
    const interval = setInterval(updateCacheStats, 30000);

    return () => clearInterval(interval);
  }, []);

  // Initialize from batch when batch mode is active and categories are loaded
  useEffect(() => {
    if (batchMode && currentBatch && categories && Object.keys(categories).length > 0) {
      // Set category and subcategory from batch
      if (currentBatch.category && currentBatch.category !== '--' && categories[currentBatch.category]) {
        // Only set if different from current to avoid loops
        if (category !== currentBatch.category) {
          setSelectedCategory(currentBatch.category);
          setSubcategories(categories[currentBatch.category]);
          dispatch({ type: 'SET_CATEGORY', payload: currentBatch.category });
        }
        
        if (currentBatch.subCategory && 
            currentBatch.subCategory !== '--' && 
            categories[currentBatch.category].includes(currentBatch.subCategory) &&
            subCategory !== currentBatch.subCategory) {
          dispatch({ type: 'SET_SUBCATEGORY', payload: currentBatch.subCategory });
        }
      }
      
      // Set price from batch if not already set
      if (currentBatch.salePrice && (!price || price === '')) {
        dispatch({ type: 'SET_PRICE', payload: currentBatch.salePrice });
      }
    }
  }, [batchMode, currentBatch, categories, category, subCategory, price, dispatch]);

  const handleSubCategoryChange = (e) => {
    const sub = e.target.value;
    dispatch({ type: 'SET_SUBCATEGORY', payload: sub });
    validateSelection(selectedCategory, sub);
  };

  const validateSelection = (cat, sub) => {
    const errorMsg = "Please select a valid category and subcategory.";
    if (cat === "--" || sub === "--") {
      if (!errorMessages.includes(errorMsg)) {
        dispatch({ type: 'ADD_ERROR_MESSAGE', payload: errorMsg });
      }
    } else {
      dispatch({ type: 'REMOVE_ERROR_MESSAGE', payload: errorMsg });
    }
  };

  const handleRotateImage = async (index, direction) => {
    try {
      dispatch({ type: 'ROTATE_IMAGE', payload: { index, direction } });
      
      const currentRotation = imageRotations[index] || 0;
      const rotationChange = direction === 'right' ? 90 : -90;
      const newRotation = (currentRotation + rotationChange + 360) % 360;
      
      const base64 = filesBase64[index];
      const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      
      if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 format');
      }
      
      const contentType = matches[1];
      const base64Data = matches[2];
      const byteCharacters = atob(base64Data);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      const blob = new Blob(byteArrays, {type: contentType});
      const file = new File([blob], `image_${Date.now()}.${contentType.split('/')[1] || 'jpg'}`, {type: contentType});
      
      const { results } = await processImagesInBatch([file], {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.9,
        toBase64: true,
        manualRotation: rotationChange
      });
      
      if (results && results.length > 0) {
        dispatch({ 
          type: 'UPDATE_FILES_BASE64_AT_INDEX', 
          payload: { index, value: results[0] } 
        });
      }
    } catch (error) {
      console.error("Error rotating image:", error);
    }
  };
  
  // Handle category change
  const handleCategoryChange = (e) => {
    const cat = e.target.value;
    setSelectedCategory(cat);
    if (categories[cat]) {
      setSubcategories(categories[cat]);
    }
    dispatch({ type: 'SET_CATEGORY', payload: cat });
    dispatch({ type: 'SET_SUBCATEGORY', payload: '--' });
    validateSelection(cat, '--');
  };

  const handleImageUploaderProcess = (processedImages, processedRawFiles) => {
    dispatch({ type: 'ADD_FILES_BASE64', payload: processedImages });
    dispatch({ type: 'ADD_RAW_FILES', payload: processedRawFiles });
    dispatch({ type: 'REMOVE_ERROR_MESSAGE', payload: "Please upload at least one image." });
  };

  const handlePriceChange = (e) => dispatch({ type: 'SET_PRICE', payload: e.target.value });
  const handleSkuChange = (e) => dispatch({ type: 'SET_SKU', payload: e.target.value });

  const toggleImageSelection = (idx) => {
    dispatch({ type: 'TOGGLE_IMAGE_SELECTION', payload: idx });
  };

  const uploadGroupedImagesToS3 = async (selectedIndices) => {
    try {
      const selectedRawFiles = selectedIndices.map(i => rawFiles[i]).filter(file => file);
      
      if (!selectedRawFiles.length) {
        return [];
      }
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          isUploading: true, 
          uploadTotal: selectedRawFiles.length,
          uploadCompleted: 0,
          uploadProgress: 0,
          uploadStage: 'Converting and uploading selected images to S3...'
        } 
      });
      
      const convertedFiles = [];
      for (let i = 0; i < selectedRawFiles.length; i++) {
        const file = selectedRawFiles[i];
        
        try {
          if (isHeicFile(file)) {
            const convertedFile = await convertHeicToJpeg(file);
            convertedFiles.push(convertedFile);
          } else {
            convertedFiles.push(file);
          }
          
          dispatch({ 
            type: 'SET_UPLOAD_STATUS', 
            payload: { 
              uploadProgress: Math.round(((i + 1) / selectedRawFiles.length) * 30),
              uploadStage: isHeicFile(file) ? 
                `Converting HEIC files... (${i + 1}/${selectedRawFiles.length})` :
                `Preparing files... (${i + 1}/${selectedRawFiles.length})`
            } 
          });
        } catch (error) {
          console.error(`Error converting file ${file.name}:`, error);
          convertedFiles.push(file);
        }
      }
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: 'Uploading to S3...',
          uploadProgress: 30
        } 
      });
      
      const UPLOAD_BATCH_SIZE = 80;
      const s3Urls = [];
      
      for (let i = 0; i < convertedFiles.length; i += UPLOAD_BATCH_SIZE) {
        const batch = convertedFiles.slice(i, i + UPLOAD_BATCH_SIZE);
        
        const uploadPromises = batch.map(async (file, batchIndex) => {
          try {
            const url = await uploadToS3(file);
            return { success: true, url };
          } catch (error) {
            console.error(`Error uploading file ${i + batchIndex}:`, error);
            return { success: false, error };
          }
        });
        
        const batchResults = await Promise.all(uploadPromises);
        
        batchResults.forEach(result => {
          if (result.success && result.url) {
            s3Urls.push(result.url);
          }
        });
        
        const completedCount = Math.min(i + UPLOAD_BATCH_SIZE, convertedFiles.length);
        const uploadProgress = 30 + Math.round((completedCount / convertedFiles.length) * 70);
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { 
            uploadCompleted: completedCount,
            uploadProgress: uploadProgress
          } 
        });
      }
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadProgress: 100,
          uploadCompleted: convertedFiles.length,
          uploadStage: 'Upload complete!',
          isUploading: false
        } 
      });
      
      setTimeout(() => {
        dispatch({ type: 'RESET_STATUS' });
      }, 1000);
      
      return s3Urls;
    } catch (error) {
      console.error('Error uploading selected images:', error);
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: `Error: ${error.message}`,
          isUploading: false
        } 
      });
      
      setTimeout(() => {
        dispatch({ type: 'RESET_STATUS' });
      }, 3000);
      
      return [];
    }
  };

  const handleGroupSelected = async () => {
    if (!selectedImages.length) return;
    
    try {
      const s3Urls = await uploadGroupedImagesToS3(selectedImages);
      
      let updatedS3Groups = [...(state.s3ImageGroups || [])];
      while (updatedS3Groups.length < state.imageGroups.length) {
        updatedS3Groups.push([]);
      }
      
      const firstEmptyIndex = updatedS3Groups.findIndex(g => g.length === 0);
      let targetIndex = firstEmptyIndex !== -1 ? firstEmptyIndex : updatedS3Groups.length;
      
      if (s3Urls.length > 0) {
        if (targetIndex >= updatedS3Groups.length) {
          updatedS3Groups.push(s3Urls);
        } else {
          updatedS3Groups[targetIndex] = s3Urls;
        }
        
        if (updatedS3Groups[updatedS3Groups.length - 1].length > 0) {
          updatedS3Groups.push([]);
        }
        
        dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: updatedS3Groups });
      }
      
      dispatch({ type: 'GROUP_SELECTED_IMAGES' });
      
    } catch (error) {
      console.error('Error in group selected function:', error);
      dispatch({ type: 'GROUP_SELECTED_IMAGES' });
    }
  };

  const fetchEbayCategoryID = async (category, subCategory) => {
    if (!category || category === "--" || !subCategory || subCategory === "--") {
      return null;
    }
    
    try {
      const cacheKey = `ebay_category_${category}_${subCategory}`;
      const cachedCategoryID = cacheService.get(cacheKey);
      
      if (cachedCategoryID !== null) {
        return cachedCategoryID;
      }
      
      const command = new QueryCommand({
        TableName: 'ListCategory',
        KeyConditionExpression: 'Category = :cat AND SubCategory = :sub',
        ExpressionAttributeValues: {
          ':cat': { S: category },
          ':sub': { S: subCategory },
        },
      });

      const response = await client.send(command);
      
      if (response.Items && response.Items.length > 0) {
        const item = unmarshall(response.Items[0]);
        const categoryID = item.EbayCategoryID || null;
        cacheService.set(cacheKey, categoryID, null, 'ebayCategories');
        return categoryID;
      }
      
      const fallbackCommand = new QueryCommand({
        TableName: 'ListCategory',
        KeyConditionExpression: 'Category = :cat',
        ExpressionAttributeValues: {
          ':cat': { S: category },
        },
        Limit: 1,
      });
      
      const fallbackResponse = await client.send(fallbackCommand);
      
      if (fallbackResponse.Items && fallbackResponse.Items.length > 0) {
        const fallbackItem = unmarshall(fallbackResponse.Items[0]);
        const fallbackCategoryID = fallbackItem.EbayCategoryID || null;
        cacheService.set(cacheKey, fallbackCategoryID, 60 * 60 * 1000, 'ebayCategories');
        return fallbackCategoryID;
      }
      
      cacheService.set(cacheKey, null, 60 * 60 * 1000, 'ebayCategories');
      return null;
    } catch (error) {
      console.error('Error in fetchEbayCategoryID:', error);
      throw error;
    }
  };
  
  const handleGenerateListingWithUpload = async () => {
    try {
      dispatch({ type: 'RESET_STATUS' });
      
      let allRawFiles = [...rawFiles];
      
      if (allRawFiles.length === 0) {
        if (filesBase64.length > 0) {
          const convertedFiles = await Promise.all(filesBase64.map(async (base64, i) => {
            try {
              const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              
              if (!matches || matches.length !== 3) return null;
              
              const contentType = matches[1];
              const base64Data = matches[2];
              const byteCharacters = atob(base64Data);
              const byteArrays = [];
              
              for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                const slice = byteCharacters.slice(offset, offset + 512);
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                  byteNumbers[i] = slice.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
              }
              
              const blob = new Blob(byteArrays, {type: contentType});
              const fileName = `image_${Date.now()}_${i}.${contentType.split('/')[1] || 'jpg'}`;
              return new File([blob], fileName, {type: contentType});
            } catch (error) {
              console.error(`Error converting base64 to file:`, error);
              return null;
            }
          }));
          
          const validFiles = convertedFiles.filter(file => file !== null);
          
          if (validFiles.length > 0) {
            allRawFiles = validFiles;
          } else {
            await onGenerateListing(aiResolveCategoryFields, categoryFields);
            return;
          }
        } else {
          await onGenerateListing(aiResolveCategoryFields, categoryFields);
          return;
        }
      }
      
      const heicFiles = allRawFiles.filter(isHeicFile);
      const hasHeicFiles = heicFiles.length > 0;
      
      const uploadStatusObject = {
        isUploading: true, 
        uploadTotal: allRawFiles.length,
        uploadCompleted: 0,
        uploadProgress: 0,
        uploadStage: hasHeicFiles ? 
          `Converting ${heicFiles.length} HEIC files and uploading to S3...` : 
          'Uploading images to S3...',
        currentFileIndex: 0
      };
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: uploadStatusObject
      });
      
      const convertedFiles = [];
      if (hasHeicFiles) {
        for (let i = 0; i < allRawFiles.length; i++) {
          const file = allRawFiles[i];
          
          try {
            if (isHeicFile(file)) {
              const convertedFile = await convertHeicToJpeg(file);
              convertedFiles.push(convertedFile);
            } else {
              convertedFiles.push(file);
            }
            
            uploadStatusObject.uploadProgress = Math.round(((i + 1) / allRawFiles.length) * 20);
            uploadStatusObject.uploadStage = isHeicFile(file) ? 
              `Converting HEIC files... (${i + 1}/${allRawFiles.length})` :
              `Preparing files... (${i + 1}/${allRawFiles.length})`;
            
            dispatch({ 
              type: 'SET_UPLOAD_STATUS', 
              payload: { ...uploadStatusObject } 
            });
          } catch (error) {
            console.error(`Error converting HEIC file ${file.name}:`, error);
            convertedFiles.push(file);
          }
        }
      } else {
        convertedFiles.push(...allRawFiles);
      }
      
      uploadStatusObject.uploadStage = 'Uploading to S3...';
      uploadStatusObject.uploadProgress = hasHeicFiles ? 20 : 0;
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { ...uploadStatusObject } 
      });
      
      const BATCH_SIZE = 20;
      const s3UrlsList = [];
      const baseProgress = hasHeicFiles ? 20 : 0;
      const uploadProgressRange = 100 - baseProgress;
      
      for (let i = 0; i < convertedFiles.length; i += BATCH_SIZE) {
        const batch = convertedFiles.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map((file, batchIndex) => {
          const fileIndex = i + batchIndex;
          return uploadToS3(file).then(url => ({ url, index: fileIndex }));
        });
        
        const batchResults = await Promise.all(
          batchPromises.map(p => p.catch(error => ({ url: null, error })))
        );
        
        batchResults.forEach(result => {
          if (result.url) {
            s3UrlsList.push({ url: result.url, index: result.index });
          }
        });
        
        const completedCount = Math.min(i + BATCH_SIZE, convertedFiles.length);
        uploadStatusObject.uploadCompleted = completedCount;
        uploadStatusObject.uploadProgress = baseProgress + Math.round((completedCount / convertedFiles.length) * uploadProgressRange);
        uploadStatusObject.currentFileIndex = completedCount;
        
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { ...uploadStatusObject } 
        });
      }
      
   uploadStatusObject.uploadProgress = 100;
uploadStatusObject.uploadCompleted = convertedFiles.length;
uploadStatusObject.uploadStage = 'Upload complete! Organizing images...';

dispatch({ 
  type: 'SET_UPLOAD_STATUS', 
  payload: { ...uploadStatusObject } 
});

// Simplified S3 URL organization
console.log('🔧 Organizing S3 URLs...');
console.log('S3 URLs list:', s3UrlsList);

// Get current image groups structure
const currentImageGroups = [...state.imageGroups];
let updatedS3Groups = [...(state.s3ImageGroups || [])];

// Ensure s3Groups array matches imageGroups length
while (updatedS3Groups.length < currentImageGroups.length) {
  updatedS3Groups.push([]);
}

// Initialize these variables outside the if/else block
let finalImageGroups = [...currentImageGroups];
let finalS3Groups = [...updatedS3Groups];

// If we have batchSize > 0, organize into batches
if (batchSize > 0 && filesBase64.length > 0) {
  console.log('📦 Organizing into batches of', batchSize);
  
  // Find first empty image group to start placing batches
  let targetGroupIndex = currentImageGroups.findIndex(g => !g || g.length === 0);
  if (targetGroupIndex === -1) {
    targetGroupIndex = currentImageGroups.length;
  }
  
  // Create batches from pool images
  const poolGroups = [];
  const poolS3Groups = [];
  
  for (let i = 0; i < filesBase64.length; i += batchSize) {
    const groupImages = filesBase64.slice(i, i + batchSize);
    poolGroups.push(groupImages);
    
    // Get corresponding S3 URLs for this batch
    const groupS3Urls = [];
    for (let j = i; j < Math.min(i + batchSize, filesBase64.length); j++) {
      const s3Item = s3UrlsList.find(item => item.index === j);
      if (s3Item && s3Item.url) {
        groupS3Urls.push(s3Item.url);
      }
    }
    poolS3Groups.push(groupS3Urls);
    
    console.log(`📋 Batch ${poolGroups.length}: ${groupImages.length} images, ${groupS3Urls.length} S3 URLs`);
  }
  
  // Add batches to image groups and S3 groups
  poolGroups.forEach((groupImages, batchIndex) => {
    const insertIndex = targetGroupIndex + batchIndex;
    
    // Insert or replace in image groups
    if (insertIndex < finalImageGroups.length) {
      finalImageGroups[insertIndex] = groupImages;
    } else {
      finalImageGroups.push(groupImages);
    }
    
    // Insert or replace in S3 groups
    while (finalS3Groups.length <= insertIndex) {
      finalS3Groups.push([]);
    }
    finalS3Groups[insertIndex] = poolS3Groups[batchIndex];
    
    console.log(`✅ Placed batch ${batchIndex + 1} at index ${insertIndex}`);
  });
  
  // Ensure there's an empty group at the end
  if (finalImageGroups[finalImageGroups.length - 1]?.length > 0) {
    finalImageGroups.push([]);
    finalS3Groups.push([]);
  }
  
  console.log('📊 Final state update:');
  console.log('Image groups:', finalImageGroups.length);
  console.log('S3 groups:', finalS3Groups.length);
  console.log('S3 URLs in groups:', finalS3Groups.map(g => g.length));
  
} else {
  // No batching - just store all URLs in the first group
  console.log('📁 No batching - storing all URLs in first group');
  
  const allS3Urls = s3UrlsList.map(item => item.url).filter(url => url);
  
  if (finalS3Groups.length === 0) {
    finalS3Groups.push(allS3Urls);
  } else {
    finalS3Groups[0] = allS3Urls;
  }
  
  console.log('✅ Stored', allS3Urls.length, 'S3 URLs in first group');
}

// Update state with final arrays
dispatch({ type: 'SET_IMAGE_GROUPS', payload: finalImageGroups });
dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: finalS3Groups });

// Update group metadata if needed
const updatedMetadata = [...(state.groupMetadata || [])];

// For batching mode, ensure metadata exists for each new group
if (batchSize > 0 && filesBase64.length > 0) {
  const numNewGroups = Math.ceil(filesBase64.length / batchSize);
  const startIndex = updatedMetadata.findIndex(meta => !meta);
  
  for (let i = 0; i < numNewGroups; i++) {
    const metadataIndex = startIndex >= 0 ? startIndex + i : updatedMetadata.length;
    
    while (updatedMetadata.length <= metadataIndex) {
      updatedMetadata.push(null);
    }
    
    if (!updatedMetadata[metadataIndex]) {
      updatedMetadata[metadataIndex] = { 
        price: state.price || '', 
        sku: state.sku || '',
        fieldSelections: { ...state.fieldSelections }
      };
    }
  }
  
  dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
}

// Clear the base64 pool since images are now in groups
dispatch({ type: 'SET_FILES_BASE64', payload: [] });

      try {
        const ebayCategoryID = await fetchEbayCategoryID(selectedCategory, subCategory);
        dispatch({ type: 'SET_CATEGORY_ID', payload: ebayCategoryID });
      } catch (error) {
        console.error('Error fetching eBay category ID:', error);
        dispatch({ type: 'SET_CATEGORY_ID', payload: null });
      }
      
      dispatch({ type: 'SET_RAW_FILES', payload: [] });
      dispatch({ type: 'SET_IMAGE_ROTATIONS', payload: {} });
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: 'Preparing to generate listings...',
          isUploading: false
        } 
      });
      
      await onGenerateListing(aiResolveCategoryFields, categoryFields);
      
    } catch (error) {
      console.error('Error during upload process:', error);
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: `Error: ${error.message}`,
          isUploading: false
        } 
      });
      
      setTimeout(() => {
        dispatch({ type: 'RESET_STATUS' });
      }, 3000);
    }
  };
  
  const uploadToS3 = async (file) => {
  try {
    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
	
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
const fileName = `uploads/${timestamp}_${randomId}_${file.name}`;
    
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: new Uint8Array(arrayBuffer),
      ContentType: file.type,
      ACL: "public-read", // Ensure this is properly public
      // Add cache control for better performance
      CacheControl: "max-age=31536000", // 1 year cache
    };
    
    console.log('📤 Uploading to S3:', fileName);
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    
    const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
    console.log('✅ S3 upload successful:', s3Url);
    return s3Url;
  } catch (error) {
    console.error("❌ Error uploading to S3:", error);
    throw error;
  }
};

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  const hasNewGroupsToProcess = () => {
    const hasUnprocessedGroups = imageGroups.some((group, idx) => 
      group.length > 0 && (!processedGroupIndices || !processedGroupIndices.includes(idx))
    );
    
    const hasUnprocessedPoolImages = filesBase64.length > 0 && batchSize > 0;
    
    return hasUnprocessedGroups || hasUnprocessedPoolImages;
  };

  const shouldShowAiToggle = () => {
    if (categoryFields.length === 0) return false;
    
    const emptyFields = categoryFields.filter(field => {
      const currentValue = fieldSelections[field.FieldLabel];
      return !currentValue || currentValue === "-- Select --" || currentValue.trim() === "";
    });
    
    return emptyFields.length > 0;
  };

  const Spinner = () => (
    <div className="spinner">
      <div className="spinner-circle"></div>
    </div>
  );

  const CacheStatsDisplay = () => {
    if (process.env.NODE_ENV !== 'development' || !cacheStats) {
      return null;
    }

    return (
      <div className="cache-stats" style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        background: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontSize: '12px',
        zIndex: 1000,
        maxWidth: '300px'
      }}>
        <h4 style={{ margin: '0 0 5px 0' }}>Cache Stats</h4>
        <div>Size: {cacheStats.size}/{cacheStats.maxSize}</div>
        <div>Hit Ratio: {cacheStats.hitRatio}</div>
        <div>Memory: {cacheStats.memoryUsage}</div>
        <div>Requests: {cacheStats.totalRequests}</div>
        <div style={{ marginTop: '5px', fontSize: '10px', opacity: 0.7 }}>
          Hits: {cacheStats.hitCount} | Misses: {cacheStats.missCount}
        </div>
      </div>
    );
  };

  return (
    <section className="form-section">
      <CacheStatsDisplay />
      
      {/* Batch Mode Header */}
      {batchMode && currentBatch && (
        <div className="batch-mode-header">
          <h3>Batch: {currentBatch.name}</h3>
          <div className="batch-details">
            <span>Category: {currentBatch.category} / {currentBatch.subCategory}</span>
            <span>Status: {currentBatch.status}</span>
          </div>
        </div>
      )}
      
      <div className="form-group">
        <label>Category</label>
        {categoriesLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Spinner />
            <span>Loading categories from cache...</span>
          </div>
        ) : (
          <select 
            onChange={handleCategoryChange} 
            value={selectedCategory}
            disabled={batchMode && currentBatch && currentBatch.category !== '--'}
          >
            {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        )}
      </div>

      <div className="form-group">
        <label>SubCategory</label>
        <select 
          onChange={handleSubCategoryChange} 
          value={subCategory}
          disabled={batchMode && currentBatch && currentBatch.subCategory !== '--'}
        >
          {subcategories.map((sub, i) => <option key={i} value={sub}>{sub}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Price ($)</label>
        <input 
          type="text" 
          value={price} 
          onChange={handlePriceChange} 
          placeholder={batchMode && currentBatch && currentBatch.salePrice ? 
            `Batch default: ${currentBatch.salePrice}` : "Enter price"} 
          className="form-control" 
        />
      </div>

      <div className="form-group">
        <label>SKU</label>
        <input 
          type="text" 
          value={sku} 
          onChange={handleSkuChange} 
          placeholder={batchMode && currentBatch && currentBatch.sku ? 
            `Batch default: ${currentBatch.sku}` : "Enter SKU"} 
          className="form-control" 
        />
      </div>

      <div className="form-group">
        <label>Category Fields</label>
        <div className="scrollable-fields">
          {categoryFields.map((field, index) => {
            const options = field.CategoryOptions ? field.CategoryOptions.split(';').map(opt => opt.trim()) : [];
            const currentValue = fieldSelections[field.FieldLabel] || "";
            const displayValue = currentValue === "-- Select --" ? "" : currentValue;
            
            return (
              <div key={index} className="field-row">
                <label>{field.FieldLabel || `Field ${index + 1}`}</label>
                {options.length > 0 ? (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={displayValue}
                      onChange={(e) => 
                        dispatch({ 
                          type: 'UPDATE_FIELD_SELECTION', 
                          payload: { 
                            field: field.FieldLabel,
                            value: e.target.value 
                          } 
                        })
                      }
                      placeholder="Enter value or select from dropdown"
                      list={`${field.FieldLabel}-${index}-options`}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '1rem',
                        backgroundColor: '#3b3b3b',
                        color: 'white',
                        backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"12\\" height=\\"12\\" viewBox=\\"0 0 12 12\\"><path fill=\\"white\\" d=\\"M2 4l4 4 4-4z\\"/></svg>")',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 8px center',
                        backgroundSize: '12px',
                        paddingRight: '30px'
                      }}
                    />
                    <datalist id={`${field.FieldLabel}-${index}-options`}>
                      {options.map((opt, idx) => (
                        <option key={idx} value={opt}>{opt}</option>
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={displayValue}
                    onChange={(e) => 
                      dispatch({ 
                        type: 'UPDATE_FIELD_SELECTION', 
                        payload: { 
                          field: field.FieldLabel,
                          value: e.target.value 
                        } 
                      })
                    }
                    placeholder="Enter value"
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '1rem',
                      backgroundColor: '#3b3b3b',
                      color: 'white'
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* eBay Integration - Updated to show in batch mode with conditional messaging */}
      <div className="form-group">
        <label>eBay Integration</label>
        <div className="ebay-integration-section">
          {batchMode ? (
            // In batch mode, show a simplified eBay status
            <div style={{
              background: ebayAuthenticated ? '#e8f5e8' : '#fff3cd',
              border: `1px solid ${ebayAuthenticated ? '#4CAF50' : '#ffc107'}`,
              borderRadius: '8px',
              padding: '12px 16px',
              color: ebayAuthenticated ? '#2e7d32' : '#856404'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.2em' }}>
                  {ebayAuthenticated ? '✅' : '⚠️'}
                </span>
                <strong>
                  {ebayAuthenticated ? 'eBay Account Connected' : 'eBay Integration Available'}
                </strong>
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                {ebayAuthenticated ? (
                  <>
                    Your eBay account is connected. You can create listings directly on eBay after generating them.
                    {selectedPolicies.paymentPolicyId && selectedPolicies.fulfillmentPolicyId && selectedPolicies.returnPolicyId ? (
                      <div style={{ marginTop: '6px', color: '#2e7d32' }}>
                        ✓ Business policies are configured
                      </div>
                    ) : (
                      <div style={{ marginTop: '6px', color: '#f57c00' }}>
                        ⚠️ Some business policies missing - listings will be created as drafts
                      </div>
                    )}
                  </>
                ) : (
                  'Connect your eBay account to create listings directly on eBay. You can still generate and download CSV files without connecting.'
                )}
              </div>
            </div>
          ) : (
            // In normal mode, show full eBay integration
            <>
              {!showEbayAuth ? (
                <button 
                  className="ebay-toggle-button"
                  onClick={() => setShowEbayAuth(true)}
                >
                  {ebayAuthenticated ? '✅ Configure eBay Policies' : '🔗 Connect eBay Account'}
                </button>
              ) : (
                <div className="ebay-auth-expanded">
                  <button 
                    className="ebay-collapse-button"
                    onClick={() => setShowEbayAuth(false)}
                  >
                    ▼ Hide eBay Integration
                  </button>
                  <EbayAuth 
                    onAuthSuccess={handleEbayAuthSuccess}
                    onAuthError={handleEbayAuthError}
                    redirectAfterAuth={window.location.pathname + window.location.search}
                  />
                  {ebayAuthenticated && (
                    <EbayPolicySelector onPolicyChange={handlePolicyChange} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

    <OptimizedImageUploader
        onImagesProcessed={handleImageUploaderProcess}
        autoRotateEnabled={autoRotateEnabled}
      />
      
      {/* Condensed checkbox options group */}
      <div className="checkbox-options-group">
        <div className="auto-rotate-option">
          <input 
            type="checkbox" 
            id="auto-rotate" 
            checked={autoRotateEnabled} 
            onChange={handleAutoRotateToggle} 
          />
          <label htmlFor="auto-rotate">
            Auto-rotate images on upload
          </label>
        </div>

        {shouldShowAiToggle() && (
          <div className="ai-category-fields-option">
            <input 
              type="checkbox" 
              id="ai-resolve-category-fields" 
              checked={aiResolveCategoryFields} 
              onChange={handleAiResolveCategoryFieldsToggle} 
            />
            <div>
              <label htmlFor="ai-resolve-category-fields">
                🤖 Let AI determine empty category fields from images
              </label>
              <div className="field-help-text">
                <small>
                  AI will analyze images to suggest values for unfilled fields. You can review and edit suggestions after generation.
                </small>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Images Per Item</label>
        <select 
          disabled={!filesBase64.length}
          value={batchSize} 
          onChange={e => dispatch({ type: 'SET_BATCH_SIZE', payload: Number(e.target.value) })}
        >
          {!filesBase64.length
            ? <option>0</option>
            : Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                .filter(n => filesBase64.length % n === 0 && n <= 24)
                .map(n => <option key={n} value={n}>{n}</option>)
          }
        </select>
      </div>

      <div className="button-group">
        <button 
          className="primary" 
          disabled={!selectedImages.length} 
          onClick={handleGroupSelected}
        >
          Group Selected
        </button>
        <button 
          className="danger" 
          onClick={handleClearAllLocal}
        >
          {batchMode ? 'Clear Working Images' : 'Clear All'}
        </button>
      </div>

      <div 
        className="generate-area" 
        onMouseEnter={() => !isValidSelection && setShowTooltip(true)} 
        onMouseLeave={() => setShowTooltip(false)}
      >
        <button 
          className="primary large" 
          disabled={!isValidSelection || isLoading || uploadStatus.isUploading || processingStatus.isProcessing || (!isDirty && !hasNewGroupsToProcess())} 
          onClick={handleGenerateListingWithUpload}
        >
          {isLoading || processingStatus.isProcessing ? (
            <span className="loading-button">
              <Spinner /> 
              {processingStatus.isProcessing ? 
                `Processing group ${processingStatus.currentGroup || 0} of ${processingStatus.processTotal || 0}...` : 
                `Generating... (${completedChunks}/${totalChunks})`
              }
            </span>
          ) : uploadStatus.isUploading ? (
            <span className="loading-button">
              <Spinner /> 
              {uploadStatus.uploadStage} 
              {uploadStatus.currentFileIndex ? 
                `(${uploadStatus.currentFileIndex}/${uploadStatus.uploadTotal})` :
                `(${uploadStatus.uploadCompleted}/${uploadStatus.uploadTotal})`
              }
            </span>
          ) : hasNewGroupsToProcess() ? (
            <>
              Generate Listing
              {aiResolveCategoryFields && shouldShowAiToggle() && (
                <span style={{ fontSize: '0.8rem', marginLeft: '5px' }}>🤖</span>
              )}
            </>
          ) : (
            <>
              Generate Listing
              {aiResolveCategoryFields && shouldShowAiToggle() && (
                <span style={{ fontSize: '0.8rem', marginLeft: '5px' }}>🤖</span>
              )}
            </>
          )}
        </button>
        {showTooltip && <span className="tooltip">Please select a valid category and subcategory.</span>}
      </div>

      {errorMessages.length > 0 && (
        <div className="errors">
          {errorMessages.map((msg, i) => <p key={i} className="error-msg">{msg}</p>)}
        </div>
      )}

      {filesBase64.length > 0 && (
        <div className="uploaded-images">
          {filesBase64.map((src, i) => {
            const isSelected = selectedImages.includes(i);
            return (
              <div key={i} className="image-container">
                <img
                  src={src}
                  alt={`upload-${i}`}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("from", "pool");
                    e.dataTransfer.setData("index", i.toString());
                  }}
                  onClick={() => toggleImageSelection(i)}
                  style={{ outline: isSelected ? '3px solid #007bff' : 'none' }}
                />
                <div className="image-controls">
                  <button 
                    className="rotate-button left" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRotateImage(i, 'left');
                    }}
                    title="Rotate Left"
                  >
                    ↺
                  </button>
                  <button 
                    className="rotate-button right" 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRotateImage(i, 'right');
                    }}
                    title="Rotate Right"
                  >
                    ↻
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {process.env.NODE_ENV === 'development' && (
        <div className="form-group" style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5', borderRadius: '5px' }}>
          <label style={{ color: '#666', fontSize: '0.9rem' }}>Cache Management (Dev Only)</label>
          <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
            <button 
              onClick={() => {
                cacheService.clear();
                setCacheStats(cacheService.getStats());
                console.log('Cache cleared');
              }}
              style={{
                padding: '5px 10px',
                fontSize: '0.8rem',
                background: '#ff4444',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Clear Cache
            </button>
            <button 
              onClick={() => {
                cacheService.cleanup();
                setCacheStats(cacheService.getStats());
                console.log('Cache cleaned up');
              }}
              style={{
                padding: '5px 10px',
                fontSize: '0.8rem',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Cleanup Expired
            </button>
            <button 
              onClick={() => {
                const exportData = cacheService.exportCache();
                console.log('Cache export:', exportData);
                localStorage.setItem('listeasier_cache_backup', JSON.stringify(exportData));
                alert(`Cache exported: ${exportData.entries.length} items`);
              }}
              style={{
                padding: '5px 10px',
                fontSize: '0.8rem',
                background: '#2196F3',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Export Cache
            </button>
            <button 
              onClick={() => {
                try {
                  const backup = localStorage.getItem('listeasier_cache_backup');
                  if (backup) {
                    const exportData = JSON.parse(backup);
                    const imported = cacheService.importCache(exportData);
                    setCacheStats(cacheService.getStats());
                    alert(`Cache imported: ${imported} items`);
                  } else {
                    alert('No cache backup found');
                  }
                } catch (error) {
                  alert('Error importing cache: ' + error.message);
                }
              }}
              style={{
                padding: '5px 10px',
                fontSize: '0.8rem',
                background: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Import Cache
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default FormSection;