// FormSection.jsx (Updated with Context)
import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { useAppState } from './StateContext';

// Import the optimized image handlers and uploader
import OptimizedImageUploader from './OptimizedImageUploader';
import { processImagesInBatch } from './OptimizedImageHandler';
import './OptimizedUploaderStyles.css';

export const getSelectedCategoryOptionsJSON = (fieldSelections, price, sku) => {
  const output = {};
  Object.entries(fieldSelections).forEach(([label, value]) => {
    if (value && value !== "-- Select --") output[label] = value;
  });
  if (price) output["price"] = price;
  if (sku) output["sku"] = sku;
  return output;
};

function FormSection({ onGenerateListing }) {
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
  
  // Local state for UI
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [categories, setCategories] = useState({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  
  // Group metadata form state
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [groupPrice, setGroupPrice] = useState('');
  const [groupSku, setGroupSku] = useState('');
  
  // Update fields when selected group changes
  useEffect(() => {
    if (groupMetadata && groupMetadata[selectedGroupIndex]) {
      setGroupPrice(groupMetadata[selectedGroupIndex].price || '');
      setGroupSku(groupMetadata[selectedGroupIndex].sku || '');
    } else {
      setGroupPrice('');
      setGroupSku('');
    }
  }, [selectedGroupIndex, groupMetadata]);
  
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
    setSelectedGroupIndex(0);
    setGroupPrice('');
    setGroupSku('');
    
    // Reset global state and clear processed groups tracking
    dispatch({ type: 'CLEAR_ALL' });
    dispatch({ type: 'CLEAR_PROCESSED_GROUPS' });
    
    // Also clear group metadata
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: [] });
  };

  // Handle update group metadata
  const handleUpdateGroupMetadata = () => {
    // Create updated metadata array
    const updatedMetadata = [...(groupMetadata || [])];
    
    // Ensure array is long enough
    while (updatedMetadata.length <= selectedGroupIndex) {
      updatedMetadata.push(null);
    }
    
    // Update metadata for the selected group
    updatedMetadata[selectedGroupIndex] = {
      price: groupPrice,
      sku: groupSku
    };
    
    // Update global state
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
  };

  // Fetch categories on component mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setCategoriesLoading(true);
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
        setCategories(categoryData);
      } catch (err) {
        console.error('Error fetching categories:', err);
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, []);

  // Fetch category fields when subcategory changes
  useEffect(() => {
    if (!subCategory || subCategory === "--") {
      setCategoryFields([]);
      dispatch({ type: 'SET_FIELD_SELECTIONS', payload: {} });
      return;
    }

    const fetchCategoryFields = async () => {
      try {
        const command = new QueryCommand({
          TableName: 'CategoryFields',
          KeyConditionExpression: 'SubCategoryType = :sub',
          ExpressionAttributeValues: {
            ':sub': { S: subCategory },
          },
        });

        const response = await client.send(command);
        const items = response.Items?.map(item => unmarshall(item)) || [];
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

    fetchCategoryFields();
  }, [subCategory, dispatch]);

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

  // Handle image rotation
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
        uploadStage: 'Uploading selected images to S3...'
      } 
    });
    
    // Upload files in parallel
    const s3UrlsPromises = selectedRawFiles.map(async (file, index) => {
      try {
        const result = await uploadToS3(file);
        
        // Update progress for each file
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { 
            uploadCompleted: index + 1,
            uploadProgress: Math.round(((index + 1) / selectedRawFiles.length) * 100)
          } 
        });
        
        return result;
      } catch (error) {
        console.error(`Error uploading file:`, error);
        return null;
      }
    });
    
    const s3Urls = await Promise.all(s3UrlsPromises);
    
    // Upload complete
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadProgress: 100,
        uploadCompleted: selectedRawFiles.length,
        uploadStage: 'Upload complete!',
        isUploading: false
      } 
    });
    
    // Reset status after a moment
    setTimeout(() => {
      dispatch({ type: 'RESET_STATUS' });
    }, 1000);
    
    return s3Urls.filter(url => url !== null);
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

// Function to fetch eBay category ID 
const fetchEbayCategoryID = async (category, subCategory) => {
  if (!category || category === "--" || !subCategory || subCategory === "--") {
    return null;
  }
  
  try {
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
      return item.EbayCategoryID || null;
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
      return fallbackItem.EbayCategoryID || null;
    }
    
    // Fallback to a generic category if all else fails
    return ""; // This is a generic eBay category ID (you can change this to whatever is appropriate)
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
    
    // Start uploading - update global state
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        isUploading: true, 
        uploadTotal: allRawFiles.length,
        uploadCompleted: 0,
        uploadProgress: 0,
        uploadStage: 'Uploading images to S3...'
      } 
    });
    
    // Create a batching system for uploads to improve performance
    const BATCH_SIZE = 5; // Upload 5 files in parallel
    const s3UrlsList = [];
    
    // Process files in batches
    for (let i = 0; i < allRawFiles.length; i += BATCH_SIZE) {
      const batch = allRawFiles.slice(i, i + BATCH_SIZE);
      
      // Upload batch in parallel with individual progress updates
      const batchResults = await Promise.all(
        batch.map(async (file, batchIndex) => {
          try {
            const result = await uploadToS3(file);
            
            // Update progress incrementally for each file
            const currentProcessed = i + batchIndex + 1;
            const progress = Math.round((currentProcessed / allRawFiles.length) * 100);
            
            // Update progress after each individual file instead of after batch
            dispatch({ 
              type: 'SET_UPLOAD_STATUS', 
              payload: { 
                uploadCompleted: currentProcessed,
                uploadProgress: progress
              } 
            });
            
            return result;
          } catch (error) {
            console.error(`Error uploading file:`, error);
            return null; // Return null for failed uploads
          }
        })
      );
      
      // Filter out failed uploads and add to results
      const validUrls = batchResults.filter(url => url !== null);
      s3UrlsList.push(...validUrls);
    }
    
    // Complete S3 upload process
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        uploadProgress: 100,
        uploadCompleted: allRawFiles.length,
        uploadStage: 'Upload complete! Organizing images...'
      } 
    });

    // Synchronize S3 URLs with image groups - NEWLY ADDED CODE
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
      
      // Distribute S3 URLs into batches
      let s3UrlIndex = 0;
      for (let i = 0; i < numBatches && s3UrlIndex < s3UrlsList.length; i++) {
        // Take up to batchSize URLs for this batch
        const batchUrls = s3UrlsList.slice(s3UrlIndex, s3UrlIndex + batchSize);
        s3UrlIndex += batchSize;
        
        // Store batch in S3 groups at the appropriate index
        if (targetGroupIndex < updatedS3Groups.length) {
          updatedS3Groups[targetGroupIndex] = batchUrls;
        } else {
          updatedS3Groups.push(batchUrls);
        }
        
        targetGroupIndex++;
      }
    }
    
    // For individual image uploads without batching
    if (batchSize === 0 && poolImageCount > 0 && s3UrlsList.length > 0) {
      // Store S3 URLs in the first group of s3ImageGroups
      // This allows them to be accessed when using Group Selected
      const poolS3Urls = [...(updatedS3Groups[0] || [])];
      
      // Add new S3 URLs to the pool
      for (let i = 0; i < Math.min(poolImageCount, s3UrlsList.length); i++) {
        poolS3Urls[i] = s3UrlsList[i];
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
    // END OF NEWLY ADDED CODE

    // Log all the S3 URLs we received
    console.log("All uploaded S3 URLs:", s3UrlsList);

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
    let s3UrlIndex = 0; // Keep track of which S3 URLs we've used

    // Create new S3 URL groups for images in the pool
    if (s3UrlIndex < s3UrlsList.length && batchSize > 0) {
      const remainingUrls = s3UrlsList.slice(s3UrlIndex);
      console.log(`Creating new groups from ${remainingUrls.length} remaining S3 URLs`);
      
      // Find the first empty group index to start adding new groups
      let insertIndex = newS3ImageGroups.findIndex(g => !g || g.length === 0);
      if (insertIndex === -1) {
        insertIndex = newS3ImageGroups.length;
      }
      
      // Create batches of the specified size
      for (let i = 0; i < remainingUrls.length; i += batchSize) {
        const groupUrls = remainingUrls.slice(i, i + batchSize);
        if (groupUrls.length > 0) {
          // If we're at an existing empty group, replace it
          if (insertIndex < newS3ImageGroups.length) {
            newS3ImageGroups[insertIndex] = groupUrls;
          } else {
            // Otherwise add a new group
            newS3ImageGroups.push(groupUrls);
          }
          insertIndex++;
        }
      }
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
    
    // Add metadata for new groups
    newImageGroups.forEach((group, index) => {
      if (group && group.length > 0 && (!updatedMetadata[index] || updatedMetadata[index] === null)) {
        // Create new metadata with default price/sku for new groups
        updatedMetadata[index] = { price: price || '', sku: sku || '' };
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
  
  // Upload file to S3
  const uploadToS3 = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const fileName = `${Date.now()}_${file.name}`;
          const arrayBuffer = reader.result;

          const uploadParams = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: new Uint8Array(arrayBuffer),
            ContentType: file.type,
            ACL: "public-read",
          };

          try {
            const command = new PutObjectCommand(uploadParams);
            await s3Client.send(command);

            const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
            resolve(s3Url);
          } catch (uploadError) {
            console.error("Upload error:", uploadError);
            reject(uploadError);
          }
        } catch (err) {
          reject("Error uploading: " + err.message);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
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
  
  // Group selector component for metadata editing
  const renderGroupSelector = () => {
    // Only render if there are non-empty groups
    const nonEmptyGroups = imageGroups.filter(g => g.length > 0);
    if (nonEmptyGroups.length === 0) {
      return null;
    }
    
    return (
      <div className="form-group">
        <label>Update Listing Price/SKU</label>
        <div className="group-metadata-form">
          <select 
            value={selectedGroupIndex}
            onChange={(e) => setSelectedGroupIndex(Number(e.target.value))}
          >
            {imageGroups.map((group, index) => 
              group.length > 0 ? (
                <option key={index} value={index}>
                  Group {index + 1} ({group.length} images)
                </option>
              ) : null
            )}
          </select>
          
          <div className="field-row">
            <label>Listing Price ($)</label>
            <input 
              type="text" 
              value={groupPrice} 
              onChange={(e) => setGroupPrice(e.target.value)}
              placeholder="Enter price for this listing" 
            />
          </div>
          
          <div className="field-row">
            <label>Listing SKU</label>
            <input 
              type="text" 
              value={groupSku} 
              onChange={(e) => setGroupSku(e.target.value)}
              placeholder="Enter SKU for this listing" 
            />
          </div>
          
          <button 
            className="primary small"
            onClick={handleUpdateGroupMetadata}
          >
            Update Listing Data
          </button>
        </div>
      </div>
    );
  };
  
  

  return (
    <section className="form-section">
      <div className="form-group">
        <label>Category</label>
        {categoriesLoading ? (
          <div>Loading categories...</div>
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
      
      {/* Add the group selector component */}
      {renderGroupSelector()}

      <div className="form-group">
        <label>Category Fields</label>
        <div className="scrollable-fields">
          {categoryFields.map((field, index) => {
            const options = field.CategoryOptions ? field.CategoryOptions.split(';').map(opt => opt.trim()) : [];
            return (
              <div key={index} className="field-row">
                <label>{field.FieldLabel || `Field ${index + 1}`}</label>
                <select
                  className="uniform-select"
                  value={fieldSelections[field.FieldLabel] || ""}
                  onChange={(e) => 
                    dispatch({ 
                      type: 'UPDATE_FIELD_SELECTION', 
                      payload: { 
                        field: field.FieldLabel,
                        value: e.target.value 
                      } 
                    })
                  }
                >
                  <option value="">-- Select --</option>
                  {options.map((opt, idx) => (
                    <option key={idx} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optimized Image Uploader Component */}
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
      <Spinner /> {uploadStatus.uploadStage} ({uploadStatus.uploadCompleted}/{uploadStatus.uploadTotal})
    </span>
  ) : hasNewGroupsToProcess() ? 'Generate New Listings' : 'Generate Listing'}
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
    </section>
  );
}

export default FormSection;