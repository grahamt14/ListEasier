// FormSection.jsx - Enhanced with Caching and Performance Improvements
import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';

// Import caching service
import { cacheService } from './CacheService';

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
  // Include ALL field selections, even those with default values
  Object.entries(fieldSelections).forEach(([label, value]) => {
    // Store all fields, including those with default values
    output[label] = value || "-- Select --";
  });
  if (price) output["price"] = price;
  if (sku) output["sku"] = sku;
  
  // Add eBay policy information if available
  if (ebayPolicies) {
    if (ebayPolicies.paymentPolicyId) output["ebayPaymentPolicyId"] = ebayPolicies.paymentPolicyId;
    if (ebayPolicies.fulfillmentPolicyId) output["ebayFulfillmentPolicyId"] = ebayPolicies.fulfillmentPolicyId;
    if (ebayPolicies.returnPolicyId) output["ebayReturnPolicyId"] = ebayPolicies.returnPolicyId;
  }
  
  return output;
};

function FormSection({ onGenerateListing, onCategoryFieldsChange }) {
  // Get state from context
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
  
  // Get eBay auth state
  const { isAuthenticated: ebayAuthenticated, selectedPolicies } = useEbayAuth();
  
  // Local state for UI
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [categories, setCategories] = useState({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  const [showEbayAuth, setShowEbayAuth] = useState(false);

  // Cache performance tracking
  const [cacheStats, setCacheStats] = useState(null);

  // Pass categoryFields to parent when they change
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

  // Clear all form data
  const handleClearAllLocal = () => {
    setSelectedCategory("--");
    setSubcategories(categories["--"] || ["--"]);
    setCategoryFields([]);
    setAutoRotateEnabled(false);
    
    // Reset global state and clear processed groups tracking
    dispatch({ type: 'CLEAR_ALL' });
    dispatch({ type: 'CLEAR_PROCESSED_GROUPS' });
    
    // Also clear group metadata
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: [] });

    // Clear relevant cache entries for this user session
    cacheService.delete(`categories_all`);
    if (category !== '--' && subCategory !== '--') {
      cacheService.delete(cacheService.getCategoryKey(category, subCategory));
    }
  };

  // Handle eBay authentication success
  const handleEbayAuthSuccess = () => {
    console.log('eBay authentication successful');
    // Could show a success message or update UI
  };

  // Handle eBay authentication error
  const handleEbayAuthError = (error) => {
    console.error('eBay authentication error:', error);
    dispatch({ type: 'ADD_ERROR_MESSAGE', payload: `eBay authentication failed: ${error}` });
  };

  // Handle policy selection changes
  const handlePolicyChange = (policyType, policy) => {
    console.log(`Selected ${policyType}:`, policy);
    // You could store this in app state if needed
  };

  // Enhanced categories fetching with caching
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setCategoriesLoading(true);
        
        // Check cache first
        const cacheKey = 'categories_all';
        const cachedCategories = cacheService.get(cacheKey);
        
        if (cachedCategories) {
          console.log('Using cached categories');
          setCategories(cachedCategories);
          setCategoriesLoading(false);
          return;
        }

        console.log('Fetching categories from DynamoDB');
        const scanCommand = new ScanCommand({
          TableName: 'ListCategory',
        });

        const response = await docClient.send(scanCommand);
        const categoryData = {};
        response.Items.forEach(item => {
          const category = item.Category;
          const subcategory = item.SubCategory;
          if (!categoryData[category]) {
            categoryData[category] = [];
          }
          categoryData[category].push(subcategory);
        });
        categoryData['--'] = ['--'];
        
        // Cache the results for 24 hours
        cacheService.set(cacheKey, categoryData, null, 'categories');
        
        setCategories(categoryData);
      } catch (err) {
        console.error('Error fetching categories:', err);
        // Try to use any cached data on error
        const fallbackData = cacheService.get('categories_all');
        if (fallbackData) {
          setCategories(fallbackData);
        }
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, []);

  // Enhanced category fields fetching with caching
  useEffect(() => {
    if (!subCategory || subCategory === "--") {
      setCategoryFields([]);
      dispatch({ type: 'SET_FIELD_SELECTIONS', payload: {} });
      return;
    }

    const fetchCategoryFieldsWithCache = async () => {
      try {
        // Check cache first
        const cachedFields = cacheService.getCategoryFields(category, subCategory);
        
        if (cachedFields) {
          console.log('Using cached category fields for', category, subCategory);
          setCategoryFields(cachedFields);
          
          const initialSelections = {};
          cachedFields.forEach(item => {
            initialSelections[item.FieldLabel] = "";
          });
          dispatch({ type: 'SET_FIELD_SELECTIONS', payload: initialSelections });
          return;
        }

        console.log('Fetching category fields from DynamoDB for', category, subCategory);
        
        // Try DynamoDB response cache first
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
          console.log('Using cached DynamoDB response');
          response = cachedDynamoResponse;
        } else {
          const command = new QueryCommand(dynamoQuery);
          response = await client.send(command);
          
          // Cache the DynamoDB response
          cacheService.setDynamoDBResponse('CategoryFields', dynamoQuery, response);
        }
        
        const items = response.Items?.map(item => unmarshall(item)) || [];
        
        // Cache the processed category fields
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

  // Synchronize with parent component
  useEffect(() => {
    if (rawFiles.length > 0 && filesBase64.length === 0) {
      dispatch({ type: 'SET_RAW_FILES', payload: [] });
    }
  }, [filesBase64, rawFiles.length, dispatch]);

  // Update cache stats periodically
  useEffect(() => {
    const updateCacheStats = () => {
      if (process.env.NODE_ENV === 'development') {
        setCacheStats(cacheService.getStats());
      }
    };

    updateCacheStats();
    const interval = setInterval(updateCacheStats, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Category change handler
  const handleCategoryChange = (e) => {
    const cat = e.target.value;
    setSelectedCategory(cat);
    setSubcategories(categories[cat] || ['--']);
    const defaultSub = categories[cat]?.[0] || '--';
    
    dispatch({ type: 'SET_CATEGORY', payload: cat });
    dispatch({ type: 'SET_SUBCATEGORY', payload: defaultSub });
    
    validateSelection(cat, defaultSub);
  };

  // Subcategory change handler
  const handleSubCategoryChange = (e) => {
    const sub = e.target.value;
    dispatch({ type: 'SET_SUBCATEGORY', payload: sub });
    validateSelection(selectedCategory, sub);
  };

  // Validate category and subcategory selection
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

  // Enhanced image rotation with HEIC support
  const handleRotateImage = async (index, direction) => {
    try {
      dispatch({ type: 'ROTATE_IMAGE', payload: { index, direction } });
      
      // Get current rotation or default to 0
      const currentRotation = imageRotations[index] || 0;
      
      // Calculate new rotation (90 clockwise or -90 counterclockwise)
      const rotationChange = direction === 'right' ? 90 : -90;
      const newRotation = (currentRotation + rotationChange + 360) % 360;
      
      // Create a file from the base64 string for more efficient processing
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
      
      // Process the image using optimized batch processor (just one image)
      const { results } = await processImagesInBatch([file], {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.9, // Higher quality for rotations
        toBase64: true,
        manualRotation: rotationChange // Pass the rotation angle
      });
      
      if (results && results.length > 0) {
        // Update image in filesBase64 array
        dispatch({ 
          type: 'UPDATE_FILES_BASE64_AT_INDEX', 
          payload: { index, value: results[0] } 
        });
      }
    } catch (error) {
      console.error("Error rotating image:", error);
    }
  };

  // Use the optimized image uploader instead of direct handlers
  const handleImageUploaderProcess = (processedImages, processedRawFiles) => {
    dispatch({ type: 'ADD_FILES_BASE64', payload: processedImages });
    dispatch({ type: 'ADD_RAW_FILES', payload: processedRawFiles });
    dispatch({ type: 'REMOVE_ERROR_MESSAGE', payload: "Please upload at least one image." });
  };

  const handlePriceChange = (e) => dispatch({ type: 'SET_PRICE', payload: e.target.value });
  const handleSkuChange = (e) => dispatch({ type: 'SET_SKU', payload: e.target.value });

  // Toggle image selection
  const toggleImageSelection = (idx) => {
    dispatch({ type: 'TOGGLE_IMAGE_SELECTION', payload: idx });
  };

const uploadGroupedImagesToS3 = async (selectedIndices) => {
  try {
    // Get the selected images from the pool
    const selectedRawFiles = selectedIndices.map(i => rawFiles[i]).filter(file => file);
    
    if (!selectedRawFiles.length) {
      console.log("No raw files to upload");
      return [];
    }
    
    // Update upload status
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
    
    // Convert HEIC files first if needed
    const convertedFiles = [];
    for (let i = 0; i < selectedRawFiles.length; i++) {
      const file = selectedRawFiles[i];
      
      try {
        if (isHeicFile(file)) {
          console.log(`Converting HEIC file for upload: ${file.name}`);
          const convertedFile = await convertHeicToJpeg(file);
          convertedFiles.push(convertedFile);
        } else {
          convertedFiles.push(file);
        }
        
        // Update progress for conversion
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { 
            uploadProgress: Math.round(((i + 1) / selectedRawFiles.length) * 30), // 30% for conversion
            uploadStage: isHeicFile(file) ? 
              `Converting HEIC files... (${i + 1}/${selectedRawFiles.length})` :
              `Preparing files... (${i + 1}/${selectedRawFiles.length})`
          } 
        });
      } catch (error) {
        console.error(`Error converting file ${file.name}:`, error);
        // Use original file if conversion fails
        convertedFiles.push(file);
      }
    }
    
    // Update status for S3 upload
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadStage: 'Uploading to S3...',
        uploadProgress: 30
      } 
    });
    
    // Use Promise.all to upload files in parallel but in batches
    // Increased batch size for faster processing
    const UPLOAD_BATCH_SIZE = 80; // Increased to 20 concurrent uploads
    const s3Urls = [];
    
    for (let i = 0; i < convertedFiles.length; i += UPLOAD_BATCH_SIZE) {
      const batch = convertedFiles.slice(i, i + UPLOAD_BATCH_SIZE);
      
      // Upload current batch in parallel
      const uploadPromises = batch.map(async (file, batchIndex) => {
        try {
          const url = await uploadToS3(file);
          return { success: true, url };
        } catch (error) {
          console.error(`Error uploading file ${i + batchIndex}:`, error);
          // Return null on error but don't fail the whole batch
          return { success: false, error };
        }
      });
      
      // Wait for all uploads in this batch to complete
      const batchResults = await Promise.all(uploadPromises);
      
      // Add successful URLs to the result list
      batchResults.forEach(result => {
        if (result.success && result.url) {
          s3Urls.push(result.url);
        }
      });
      
      // Update progress (30% conversion + 70% upload)
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
    
    // Upload complete
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadProgress: 100,
        uploadCompleted: convertedFiles.length,
        uploadStage: 'Upload complete!',
        isUploading: false
      } 
    });
    
    // Reset status after a moment
    setTimeout(() => {
      dispatch({ type: 'RESET_STATUS' });
    }, 1000);
    
    return s3Urls;
  } catch (error) {
    console.error('Error uploading selected images:', error);
    
    // Show error in upload status
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadStage: `Error: ${error.message}`,
        isUploading: false
      } 
    });
    
    // Reset status after a delay
    setTimeout(() => {
      dispatch({ type: 'RESET_STATUS' });
    }, 3000);
    
    return [];
  }
};

// Replace the handleGroupSelected function with this version
const handleGroupSelected = async () => {
  if (!selectedImages.length) return;
  
  try {
    // Upload the selected images to S3 first
    const s3Urls = await uploadGroupedImagesToS3(selectedImages);
    console.log(`Uploaded ${s3Urls.length} images to S3 for grouping`);
    
    // Get the current S3 image groups
    let updatedS3Groups = [...(state.s3ImageGroups || [])];
    while (updatedS3Groups.length < state.imageGroups.length) {
      updatedS3Groups.push([]);
    }
    
    // Find the first empty group or add a new one
    const firstEmptyIndex = updatedS3Groups.findIndex(g => g.length === 0);
    let targetIndex = firstEmptyIndex !== -1 ? firstEmptyIndex : updatedS3Groups.length;
    
    // Set the S3 URLs to be added to the right group
    if (s3Urls.length > 0) {
      // If we need to add a new group
      if (targetIndex >= updatedS3Groups.length) {
        updatedS3Groups.push(s3Urls);
      } else {
        // Update existing empty group
        updatedS3Groups[targetIndex] = s3Urls;
      }
      
      // Ensure there's an empty group at the end
      if (updatedS3Groups[updatedS3Groups.length - 1].length > 0) {
        updatedS3Groups.push([]);
      }
      
      // Update the S3 image groups in state
      dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: updatedS3Groups });
    }
    
    // Now perform the standard grouping action
    dispatch({ type: 'GROUP_SELECTED_IMAGES' });
    
  } catch (error) {
    console.error('Error in group selected function:', error);
    
    // Still perform the grouping even if S3 upload fails
    dispatch({ type: 'GROUP_SELECTED_IMAGES' });
  }
};

// Enhanced function to fetch eBay category ID with caching
const fetchEbayCategoryID = async (category, subCategory) => {
  if (!category || category === "--" || !subCategory || subCategory === "--") {
    return null;
  }
  
  try {
    // Check cache first
    const cacheKey = `ebay_category_${category}_${subCategory}`;
    const cachedCategoryID = cacheService.get(cacheKey);
    
    if (cachedCategoryID !== null) {
      console.log('Using cached eBay category ID');
      return cachedCategoryID;
    }

    console.log('Fetching eBay category ID from DynamoDB');
    
    // Query the eBay category mapping from DynamoDB
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
      
      // Cache the result for 24 hours
      cacheService.set(cacheKey, categoryID, null, 'ebayCategories');
      
      return categoryID;
    }
    
    // If no direct match, try to get a default category for the main category
    const fallbackCommand = new QueryCommand({
      TableName: 'ListCategory',
      KeyConditionExpression: 'Category = :cat',
      ExpressionAttributeValues: {
        ':cat': { S: category },
      },
      Limit: 1, // Just get the first result
    });
    
    const fallbackResponse = await client.send(fallbackCommand);
    
    if (fallbackResponse.Items && fallbackResponse.Items.length > 0) {
      const fallbackItem = unmarshall(fallbackResponse.Items[0]);
      const fallbackCategoryID = fallbackItem.EbayCategoryID || null;
      
      // Cache the fallback result for a shorter time (1 hour)
      cacheService.set(cacheKey, fallbackCategoryID, 60 * 60 * 1000, 'ebayCategories');
      
      return fallbackCategoryID;
    }
    
    // Cache null result to avoid repeated failed lookups
    cacheService.set(cacheKey, null, 60 * 60 * 1000, 'ebayCategories');
    return null;
  } catch (error) {
    console.error('Error in fetchEbayCategoryID:', error);
    throw error; // Rethrow to be handled by the caller
  }
};
  
const handleGenerateListingWithUpload = async () => {
  try {
    // Reset status indicators
    dispatch({ type: 'RESET_STATUS' });
    
    // Collect all raw files that need uploading
    let allRawFiles = [...rawFiles];
    
    // If no files to upload, just generate listings
    if (allRawFiles.length === 0) {
      if (filesBase64.length > 0) {
        // Convert base64 images to files if needed
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
          await onGenerateListing();
          return;
        }
      } else {
        await onGenerateListing();
        return;
      }
    }
    
    // Check if any files are HEIC
    const heicFiles = allRawFiles.filter(isHeicFile);
    const hasHeicFiles = heicFiles.length > 0;
    
    // Start uploading - update global state
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
    
    // Step 1: Convert HEIC files first if needed
    const convertedFiles = [];
    if (hasHeicFiles) {
      for (let i = 0; i < allRawFiles.length; i++) {
        const file = allRawFiles[i];
        
        try {
          if (isHeicFile(file)) {
            console.log(`Converting HEIC file: ${file.name}`);
            const convertedFile = await convertHeicToJpeg(file);
            convertedFiles.push(convertedFile);
          } else {
            convertedFiles.push(file);
          }
          
          // Update progress for HEIC conversion (20% of total progress)
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
          // Use original file if conversion fails
          convertedFiles.push(file);
        }
      }
    } else {
      // No HEIC files, use original files
      convertedFiles.push(...allRawFiles);
    }
    
    // Step 2: Upload to S3
    uploadStatusObject.uploadStage = 'Uploading to S3...';
    uploadStatusObject.uploadProgress = hasHeicFiles ? 20 : 0;
    
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { ...uploadStatusObject } 
    });
    
    // Create a batching system for parallel uploads
    const BATCH_SIZE = 20; // Process 20 files at a time
    const s3UrlsList = [];
    const baseProgress = hasHeicFiles ? 20 : 0; // Starting progress after HEIC conversion
    const uploadProgressRange = 100 - baseProgress; // Remaining progress for upload
    
    // Process files in parallel batches
    for (let i = 0; i < convertedFiles.length; i += BATCH_SIZE) {
      const batch = convertedFiles.slice(i, i + BATCH_SIZE);
      
      // Upload batch in parallel
      const batchPromises = batch.map((file, batchIndex) => {
        const fileIndex = i + batchIndex;
        return uploadToS3(file).then(url => ({ url, index: fileIndex }));
      });
      
      // Wait for all uploads in this batch to complete
      const batchResults = await Promise.all(
        batchPromises.map(p => p.catch(error => ({ url: null, error })))
      );
      
      // Add successful URLs to the result list with their indices
      batchResults.forEach(result => {
        if (result.url) {
          s3UrlsList.push({ url: result.url, index: result.index });
        }
      });
      
      // Update progress
      const completedCount = Math.min(i + BATCH_SIZE, convertedFiles.length);
      uploadStatusObject.uploadCompleted = completedCount;
      uploadStatusObject.uploadProgress = baseProgress + Math.round((completedCount / convertedFiles.length) * uploadProgressRange);
      uploadStatusObject.currentFileIndex = completedCount;
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { ...uploadStatusObject } 
      });
    }
    
    // Complete S3 upload process
    uploadStatusObject.uploadProgress = 100;
    uploadStatusObject.uploadCompleted = convertedFiles.length;
    uploadStatusObject.uploadStage = 'Upload complete! Organizing images...';
    
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { ...uploadStatusObject } 
    });

    // Synchronize S3 URLs with image groups
    console.log("Successfully uploaded images to S3:", s3UrlsList.length);
    
    // First, map out which images are already in groups and which are in the pool
    const totalExistingGroupImages = state.imageGroups.reduce((total, group) => 
      total + (group ? group.length : 0), 0);
    const poolImageCount = filesBase64.length;
    
    console.log(`Images in existing groups: ${totalExistingGroupImages}, Images in pool: ${poolImageCount}`);
    
    // Create or update S3 URL groups
    let updatedS3Groups = [...(state.s3ImageGroups || [])];
    
    // Ensure S3 groups array has the same structure as image groups
    while (updatedS3Groups.length < state.imageGroups.length) {
      updatedS3Groups.push([]);
    }
    
    // Process pool images if batch size is set
    if (batchSize > 0 && poolImageCount > 0) {
      // Create batches based on batch size
      const numBatches = Math.ceil(poolImageCount / batchSize);
      console.log(`Creating ${numBatches} batches of S3 URLs (batch size: ${batchSize})`);
      
      // Find first empty group index
      let targetGroupIndex = updatedS3Groups.findIndex(g => !g || g.length === 0);
      if (targetGroupIndex === -1) {
        targetGroupIndex = updatedS3Groups.length;
      }
      
      // Collect the URLs for each batch
      for (let i = 0; i < numBatches; i++) {
        // Calculate the indices for this batch
        const startIndex = i * batchSize;
        const endIndex = Math.min((i + 1) * batchSize, poolImageCount);
        
        // Get S3 URLs for this batch by matching indices
        const batchUrls = s3UrlsList
          .filter(item => item.index >= startIndex && item.index < endIndex)
          .map(item => item.url);
        
        if (batchUrls.length > 0) {
          // Store batch in S3 groups at the appropriate index
          if (targetGroupIndex < updatedS3Groups.length) {
            updatedS3Groups[targetGroupIndex] = batchUrls;
          } else {
            updatedS3Groups.push(batchUrls);
          }
          
          targetGroupIndex++;
        }
      }
    }
    
    // For individual image uploads without batching
    if (batchSize === 0 && poolImageCount > 0) {
      // Store S3 URLs in the first group of s3ImageGroups
      // This allows them to be accessed when using Group Selected
      const poolS3Urls = [];
      
      // Add new S3 URLs to the pool in the correct order
      for (let i = 0; i < poolImageCount; i++) {
        const urlItem = s3UrlsList.find(item => item.index === i);
        if (urlItem) {
          poolS3Urls[i] = urlItem.url;
        }
      }
      
      // Make sure the first group exists
      if (updatedS3Groups.length === 0) {
        updatedS3Groups.push([]);
      }
      
      // Update the first group with the pool's S3 URLs
      updatedS3Groups[0] = poolS3Urls;
    }
    
    // Ensure there's an empty group at the end
    if (updatedS3Groups.length === 0 || 
        (updatedS3Groups[updatedS3Groups.length - 1] && 
         updatedS3Groups[updatedS3Groups.length - 1].length > 0)) {
      updatedS3Groups.push([]);
    }
    
    // Make sure all the indexes align properly
    console.log("Image Groups:", state.imageGroups.map(g => g ? g.length : 0));
    console.log("Updated S3 Groups:", updatedS3Groups.map(g => g ? g.length : 0));
    
    // Update S3 image groups in state
    dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: updatedS3Groups });

    // Log all the S3 URLs we received
    console.log("All uploaded S3 URLs:", s3UrlsList.map(item => item.url));

    // Step 1: Understand what we have:
    console.log("Files uploaded:", rawFiles.length);
    console.log("Base64 files:", filesBase64.length);
    console.log("S3 URLs generated:", s3UrlsList.length);
    console.log("Current image groups:", state.imageGroups.map(g => g.length));
    console.log("Current S3 image groups:", state.s3ImageGroups?.map(g => g?.length || 0) || []);

    // Step 2: Figure out which images are already in groups and which are in the pool
    const imagesInGroups = state.imageGroups.reduce((total, group) => total + group.filter(img => img).length, 0);
    console.log(`Images in groups: ${imagesInGroups}, Images in pool: ${filesBase64.length}`);

    // Step 3: Preserve existing S3 image groups and add new ones
    // Clone the existing S3 image groups from state to avoid direct state mutation
    const newS3ImageGroups = [...(state.s3ImageGroups || []).map(group => [...(group || [])])];
    
    // Create new S3 URL groups for images in the pool
    if (s3UrlsList.length > 0 && batchSize > 0) {
      // Find the first empty group index to start adding new groups
      let insertIndex = newS3ImageGroups.findIndex(g => !g || g.length === 0);
      if (insertIndex === -1) {
        insertIndex = newS3ImageGroups.length;
      }
      
      // Group the URLs by their batch
      const urlsByBatch = {};
      
      s3UrlsList.forEach(item => {
        const batchIndex = Math.floor(item.index / batchSize);
        if (!urlsByBatch[batchIndex]) {
          urlsByBatch[batchIndex] = [];
        }
        urlsByBatch[batchIndex].push(item.url);
      });
      
      // Add each batch of URLs to the S3 groups
      Object.values(urlsByBatch).forEach(batchUrls => {
        if (batchUrls.length > 0) {
          // If we're at an existing empty group, replace it
          if (insertIndex < newS3ImageGroups.length) {
            newS3ImageGroups[insertIndex] = batchUrls;
          } else {
            // Otherwise add a new group
            newS3ImageGroups.push(batchUrls);
          }
          insertIndex++;
        }
      });
    }

    // Ensure we have an empty group at the end for future uploads
    if (newS3ImageGroups.length === 0 || newS3ImageGroups[newS3ImageGroups.length - 1].length > 0) {
      newS3ImageGroups.push([]);
    }

    // Log the new groups we're creating
    console.log("Updated S3 image groups:", newS3ImageGroups.map(g => g?.length || 0));

    // Create matching imageGroups for the newly added S3ImageGroups
    // Preserve the existing image groups and add new ones that match the newly added S3 groups
    const newImageGroups = [...state.imageGroups];
    
    // Replace empty groups or add new ones
    let emptyGroupIndex = newImageGroups.findIndex(g => !g || g.length === 0);
    const newPoolGroups = [];
    
    // Create batches from remaining base64 images
    if (filesBase64.length > 0 && batchSize > 0) {
      for (let i = 0; i < filesBase64.length; i += batchSize) {
        const groupImages = filesBase64.slice(i, i + batchSize);
        if (groupImages.length > 0) {
          newPoolGroups.push(groupImages);
        }
      }
    }
    
    // Add new pool groups to image groups
    newPoolGroups.forEach(group => {
      if (emptyGroupIndex !== -1) {
        newImageGroups[emptyGroupIndex] = group;
        emptyGroupIndex = newImageGroups.findIndex((g, idx) => (idx > emptyGroupIndex) && (!g || g.length === 0));
      } else {
        newImageGroups.push(group);
      }
    });
    
    // Ensure there's an empty group at the end
    if (newImageGroups.length === 0 || newImageGroups[newImageGroups.length - 1].length > 0) {
      newImageGroups.push([]);
    }

    // Update state with the new groups
    dispatch({ type: 'SET_IMAGE_GROUPS', payload: newImageGroups });
    dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: newS3ImageGroups });
    dispatch({ type: 'SET_FILES_BASE64', payload: [] });

    // Update group metadata for newly added groups
    const updatedMetadata = [...(state.groupMetadata || [])];
    
    // Extend metadata array if needed
    while (updatedMetadata.length < newImageGroups.length) {
      updatedMetadata.push(null);
    }
    
    // Add metadata for new groups (including all field selections with default values)
    newImageGroups.forEach((group, index) => {
      if (group && group.length > 0 && (!updatedMetadata[index] || updatedMetadata[index] === null)) {
        // Create new metadata with default price/sku and ALL field selections for new groups
        updatedMetadata[index] = { 
          price: price || '', 
          sku: sku || '',
          // Include ALL current field selections, even those with default values
          fieldSelections: { ...fieldSelections }
        };
      }
    });

    // Update metadata state
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });

    // Fetch the eBay category ID and continue with the process
    try {
      const ebayCategoryID = await fetchEbayCategoryID(selectedCategory, subCategory);
      dispatch({ type: 'SET_CATEGORY_ID', payload: ebayCategoryID });
    } catch (error) {
      console.error('Error fetching eBay category ID:', error);
      dispatch({ type: 'SET_CATEGORY_ID', payload: null });
    }
    
    // Clear raw files state
    dispatch({ type: 'SET_RAW_FILES', payload: [] });
    dispatch({ type: 'SET_IMAGE_ROTATIONS', payload: {} });
    
    // Update status before calling the listing generator
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadStage: 'Preparing to generate listings...',
        isUploading: false
      } 
    });
    
    // Now call handleGenerateListing
    await onGenerateListing();
    
  } catch (error) {
    console.error('Error during upload process:', error);
    
    // Show error in upload status
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadStage: `Error: ${error.message}`,
        isUploading: false
      } 
    });
    
    // Reset status after a delay
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
    
    const fileName = `${Date.now()}_${file.name}`;
    
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: new Uint8Array(arrayBuffer),
      ContentType: file.type,
      ACL: "public-read",
    };
    
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    
    const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
    return s3Url;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw error;
  }
};

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  // Check if there are new groups that need processing
  const hasNewGroupsToProcess = () => {
    // Check for unprocessed image groups
    const hasUnprocessedGroups = imageGroups.some((group, idx) => 
      group.length > 0 && (!processedGroupIndices || !processedGroupIndices.includes(idx))
    );
    
    // Or if there are images in the pool waiting to be processed
    const hasUnprocessedPoolImages = filesBase64.length > 0 && batchSize > 0;
    
    return hasUnprocessedGroups || hasUnprocessedPoolImages;
  };

  // Spinner component
  const Spinner = () => (
    <div className="spinner">
      <div className="spinner-circle"></div>
    </div>
  );

  // Cache stats display (development only)
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
      {/* Cache Stats Display (Development Only) */}
      <CacheStatsDisplay />
      
      <div className="form-group">
        <label>Category</label>
        {categoriesLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Spinner />
            <span>Loading categories from cache...</span>
          </div>
        ) : (
          <select onChange={handleCategoryChange} value={selectedCategory}>
            {Object.keys(categories).map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        )}
      </div>

      <div className="form-group">
        <label>SubCategory</label>
        <select onChange={handleSubCategoryChange} value={subCategory}>
          {subcategories.map((sub, i) => <option key={i} value={sub}>{sub}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Price ($)</label>
        <input type="text" value={price} onChange={handlePriceChange} placeholder="Enter price" className="form-control" />
      </div>

      <div className="form-group">
        <label>SKU</label>
        <input type="text" value={sku} onChange={handleSkuChange} placeholder="Enter SKU" className="form-control" />
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
                  // Use datalist input for fields with options
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
                  // Use regular text input for fields without predefined options
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

      {/* eBay Authentication Section */}
      <div className="form-group">
        <label>eBay Integration</label>
        <div className="ebay-integration-section">
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
              />
              {ebayAuthenticated && (
                <EbayPolicySelector onPolicyChange={handlePolicyChange} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Optimized Image Uploader Component with HEIC Support */}
      <OptimizedImageUploader
        onImagesProcessed={handleImageUploaderProcess}
        autoRotateEnabled={autoRotateEnabled}
      />
      
      <div className="form-group auto-rotate-option">
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
          Clear All
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
          ) : hasNewGroupsToProcess() ? 'Generate Listing' : 'Generate Listing'}
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
                      e.stopPropagation(); // Prevent selection toggle
                      handleRotateImage(i, 'left');
                    }}
                    title="Rotate Left"
                  >
                    ↺
                  </button>
                  <button 
                    className="rotate-button right" 
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent selection toggle
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

      {/* Cache management buttons (development only) */}
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
                // In a real app, you might save this to localStorage or download as file
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