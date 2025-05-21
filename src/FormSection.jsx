// FormSection.jsx (Updated with Context and Debugging Logs)
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
    groupMetadata,
    s3ImageGroups
  } = state;
  
  // Add debug logging for s3ImageGroups whenever it changes
  useEffect(() => {
    console.log('[S3 DEBUG] s3ImageGroups updated:', 
      s3ImageGroups ? {
        length: s3ImageGroups.length,
        groups: s3ImageGroups.map(group => group ? 
          {
            length: group.length,
            urls: group.slice(0, 2).map(url => typeof url === 'string' ? url.substring(0, 50) + '...' : 'non-string')
          } : 'null/undefined'
        )
      } : 'null/undefined'
    );
  }, [s3ImageGroups]);
  
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
    console.log('[S3 DEBUG] Adding processed images to state:', processedImages.length);
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

  // Group selected images
  const handleGroupSelected = () => {
    dispatch({ type: 'GROUP_SELECTED_IMAGES' });
  };

  // Fetch eBay category ID
  const fetchEbayCategoryID = async (selectedCategory, subCategory) => {
    try {
      const command = new GetCommand({
        TableName: 'ListCategory',
        Key: {
          Category: selectedCategory,
          SubCategory: subCategory,
        },
      });

      const response = await docClient.send(command);
      return response.Item?.EbayCategoryID || null;
    } catch (err) {
      console.error('Error fetching EbayCategoryID:', err);
      return null;
    }
  };
  
// Handle generate listing with upload
const handleGenerateListingWithUpload = async () => {
  try {
    console.log('[S3 DEBUG] Starting handleGenerateListingWithUpload');
    console.log('[S3 DEBUG] Initial s3ImageGroups:', s3ImageGroups);
    
    // Reset status indicators
    dispatch({ type: 'RESET_STATUS' });
    
    // Collect all raw files that need uploading
    let allRawFiles = [...rawFiles];
    console.log('[S3 DEBUG] Raw files to upload:', allRawFiles.length);
    
    // If no files to upload, just generate listings
    if (allRawFiles.length === 0) {
      console.log('[S3 DEBUG] No raw files to upload');
      
      if (filesBase64.length > 0) {
        console.log('[S3 DEBUG] Converting base64 images to files for upload');
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
          console.log('[S3 DEBUG] Using converted files for upload:', validFiles.length);
          allRawFiles = validFiles;
        } else {
          console.log('[S3 DEBUG] No valid files for upload, continuing to generate listings');
          await onGenerateListing();
          return;
        }
      } else {
        console.log('[S3 DEBUG] No files to upload, proceeding to generate listings');
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
      console.log(`[S3 DEBUG] Uploading batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(allRawFiles.length/BATCH_SIZE)}, size: ${batch.length}`);
      
      // Upload batch in parallel
      const batchResults = await Promise.all(
        batch.map(file => uploadToS3(file).catch(error => {
          console.error(`Error uploading file:`, error);
          return null; // Return null for failed uploads
        }))
      );
      
      // Filter out failed uploads and add to results
      const validUrls = batchResults.filter(url => url !== null);
      s3UrlsList.push(...validUrls);
      
      console.log(`[S3 DEBUG] Batch ${Math.floor(i/BATCH_SIZE) + 1} complete. Valid URLs: ${validUrls.length}/${batch.length}`);
      
      // Update progress through global state
      const currentProcessed = Math.min(i + BATCH_SIZE, allRawFiles.length);
      const progress = Math.round((currentProcessed / allRawFiles.length) * 100);
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadCompleted: currentProcessed,
          uploadProgress: progress
        } 
      });
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

    // Log all the S3 URLs we received
    console.log("[S3 DEBUG] All uploaded S3 URLs:", s3UrlsList.length, s3UrlsList.slice(0, 3));

    // Step 1: Understand what we have:
    console.log("[S3 DEBUG] Files uploaded:", rawFiles.length);
    console.log("[S3 DEBUG] Base64 files:", filesBase64.length);
    console.log("[S3 DEBUG] S3 URLs generated:", s3UrlsList.length);
    console.log("[S3 DEBUG] Current image groups:", imageGroups.map((g, i) => ({ index: i, length: g.length })));
    console.log("[S3 DEBUG] Current S3 image groups:", s3ImageGroups ? s3ImageGroups.map((g, i) => ({ index: i, length: g ? g.length : 0 })) : 'null/undefined');

    // Step 2: Figure out which images are already in groups and which are in the pool
    const imagesInGroups = imageGroups.reduce((total, group) => total + group.filter(img => img).length, 0);
    console.log(`[S3 DEBUG] Images in groups: ${imagesInGroups}, Images in pool: ${filesBase64.length}`);

    // Step 3: Build brand new S3 image groups in the correct order
    const newS3ImageGroups = [];
    let s3UrlIndex = 0; // Keep track of which S3 URLs we've used

    // First, process any existing groups
    imageGroups.forEach((group, groupIndex) => {
      if (group.length === 0) {
        // Keep empty groups empty
        newS3ImageGroups.push([]);
        console.log(`[S3 DEBUG] Group ${groupIndex}: empty group, keeping empty`);
      } else {
        // Create a new S3 URL array for this group
        const groupS3Urls = [];
        
        // For each image in this group
        for (let imgIndex = 0; imgIndex < group.length; imgIndex++) {
          // If we've used all available S3 URLs, use a placeholder
          if (s3UrlIndex >= s3UrlsList.length) {
            groupS3Urls.push(`https://via.placeholder.com/800x600?text=Missing+Image+${groupIndex}-${imgIndex}`);
            console.warn(`[S3 DEBUG] Not enough S3 URLs for group ${groupIndex}, image ${imgIndex}`);
            continue;
          }
          
          // Otherwise, use the next S3 URL in sequence
          groupS3Urls.push(s3UrlsList[s3UrlIndex]);
          console.log(`[S3 DEBUG] Group ${groupIndex}, image ${imgIndex}: using S3 URL at index ${s3UrlIndex}: ${s3UrlsList[s3UrlIndex].substring(0, 50)}...`);
          s3UrlIndex++;
        }
        
        newS3ImageGroups.push(groupS3Urls);
        console.log(`[S3 DEBUG] Group ${groupIndex}: added ${groupS3Urls.length} S3 URLs`);
      }
    });

    // If we have any remaining S3 URLs and images in the pool, create new groups
    if (s3UrlIndex < s3UrlsList.length && batchSize > 0) {
      const remainingUrls = s3UrlsList.slice(s3UrlIndex);
      console.log(`[S3 DEBUG] Creating new groups from ${remainingUrls.length} remaining S3 URLs with batch size ${batchSize}`);
      
      // Create batches of the specified size
      for (let i = 0; i < remainingUrls.length; i += batchSize) {
        const groupUrls = remainingUrls.slice(i, i + batchSize);
        if (groupUrls.length > 0) {
          newS3ImageGroups.push(groupUrls);
          console.log(`[S3 DEBUG] Created new group with ${groupUrls.length} S3 URLs`);
        }
      }
    }

    // Ensure we have an empty group at the end for future uploads
    if (newS3ImageGroups.length === 0 || newS3ImageGroups[newS3ImageGroups.length - 1].length > 0) {
      newS3ImageGroups.push([]);
      console.log(`[S3 DEBUG] Added empty group at the end`);
    }

    // Log the new groups we're creating
    console.log("[S3 DEBUG] New S3 image groups:", newS3ImageGroups.map((g, i) => ({ index: i, length: g.length })));

    // Create matching imageGroups that exactly mirror the S3ImageGroups
    const newImageGroups = newS3ImageGroups.map(group => [...group]);
    console.log("[S3 DEBUG] New image groups:", newImageGroups.map((g, i) => ({ index: i, length: g.length })));

    // Update state with the new groups
    console.log('[S3 DEBUG] Dispatching SET_IMAGE_GROUPS');
    dispatch({ type: 'SET_IMAGE_GROUPS', payload: newImageGroups });
    
    console.log('[S3 DEBUG] Dispatching SET_S3_IMAGE_GROUPS');
    dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: newS3ImageGroups });
    
    console.log('[S3 DEBUG] Clearing filesBase64');
    dispatch({ type: 'SET_FILES_BASE64', payload: [] });

    // Update group metadata if needed
    const updatedMetadata = [];
    newS3ImageGroups.forEach((group, index) => {
      if (group.length > 0) {
        // If we have existing metadata for this group index, keep it
        if (groupMetadata && groupMetadata[index]) {
          updatedMetadata[index] = groupMetadata[index];
        } 
        // Otherwise create new metadata with default price/sku
        else {
          updatedMetadata[index] = { price: price || '', sku: sku || '' };
        }
      } else {
        // Keep empty groups as null
        updatedMetadata[index] = null;
      }
    });

    // Update metadata state
    console.log('[S3 DEBUG] Updating group metadata');
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });

    // Use Promise for fetching eBay category ID instead of await
    return fetchEbayCategoryID(selectedCategory, subCategory)
      .then(ebayCategoryID => {
        console.log('[S3 DEBUG] Retrieved eBay category ID:', ebayCategoryID);
        dispatch({ type: 'SET_CATEGORY_ID', payload: ebayCategoryID });
        
        // Clear raw files state
        console.log('[S3 DEBUG] Clearing raw files');
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
        console.log('[S3 DEBUG] Calling onGenerateListing');
        return onGenerateListing();
      })
      .catch(error => {
        console.error('[S3 DEBUG] Error fetching eBay category ID:', error);
        
        // Still continue with the rest of the process
        dispatch({ type: 'SET_CATEGORY_ID', payload: null });
        dispatch({ type: 'SET_RAW_FILES', payload: [] });
        dispatch({ type: 'SET_IMAGE_ROTATIONS', payload: {} });
        
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { 
            uploadStage: 'Preparing to generate listings...',
            isUploading: false
          } 
        });
        
        console.log('[S3 DEBUG] Calling onGenerateListing (after error)');
        return onGenerateListing();
      });
    
  } catch (error) {
    console.error('[S3 DEBUG] Error during upload process:', error);
    
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
            console.log(`[S3 DEBUG] Successfully uploaded file ${file.name} to ${s3Url.substring(0, 50)}...`);
            resolve(s3Url);
          } catch (uploadError) {
            console.error("[S3 DEBUG] Upload error:", uploadError);
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
        <label>Update Group Price/SKU</label>
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
            <label>Group Price ($)</label>
            <input 
              type="text" 
              value={groupPrice} 
              onChange={(e) => setGroupPrice(e.target.value)}
              placeholder="Enter price for this group" 
            />
          </div>
          
          <div className="field-row">
            <label>Group SKU</label>
            <input 
              type="text" 
              value={groupSku} 
              onChange={(e) => setGroupSku(e.target.value)}
              placeholder="Enter SKU for this group" 
            />
          </div>
          
          <button 
            className="primary small"
            onClick={handleUpdateGroupMetadata}
          >
            Update Group Data
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
              <Spinner /> Generating... ({completedChunks}/{totalChunks})
            </span>
          ) : uploadStatus.isUploading ? (
            <span className="loading-button">
              <Spinner /> {uploadStatus.uploadStage} ({uploadStatus.uploadCompleted}/{uploadStatus.uploadTotal})
            </span>
          ) : hasNewGroupsToProcess() ? 'Generate New Listings' : 'Generate Listing'}
        </button>
        {showTooltip && <span className="tooltip">Please select a valid category and subcategory.</span>}
      </div>

      <div className="debug-info" style={{ fontSize: '10px', color: '#666', marginTop: '20px', padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}>
        <p>S3 Groups Count: {s3ImageGroups ? s3ImageGroups.length : 'null'}</p>
        <div style={{ maxHeight: '100px', overflow: 'auto' }}>
          {s3ImageGroups ? s3ImageGroups.map((group, idx) => (
            <div key={idx}>Group {idx+1}: {group ? group.length : 0} URLs</div>
          )) : 'No S3 groups data'}
        </div>
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