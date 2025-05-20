// FormSection.jsx
import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
// Import the image processing functions from TesseractRotate
import {
  rotateImage,
  autoRotateWithTesseract,
  detectRotationWithHeuristics,
  processImage,
  convertToBase64
} from './TesseractRotate';

export const getSelectedCategoryOptionsJSON = (fieldSelections, price, sku) => {
  const output = {};
  Object.entries(fieldSelections).forEach(([label, value]) => {
    if (value && value !== "-- Select --") output[label] = value;
  });
  if (price) output["price"] = price;
  if (sku) output["sku"] = sku;
  return output;
};

function FormSection({
  filesBase64,
  setFilesBase64,
  category,
  setCategory,
  subCategory,
  setsubCategory,
  errorMessages,
  setErrorMessages,
  batchSize,
  setBatchSize,
  selectedImages,
  setSelectedImages,
  imageGroups,
  setImageGroups,
  isLoading,
  isDirty,
  setIsDirty,
  totalChunks,
  completedChunks,
  handleGenerateListing,
  handleClearAll,
  Spinner,
  price, 
  onPriceChange,
  sku, 
  onSKUChange,
  onImageGroupsChange,
  onCategoryChange,
}) {
  // State declarations
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [localCategoryID, setLocalCategoryID] = useState('');
  const [showTooltip, setShowTooltip] = useState(false);
  const [categories, setCategories] = useState({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [processedFiles, setProcessedFiles] = useState(0);
  const [localImageGroups, setLocalImageGroups] = useState([]);
  const [rawFiles, setRawFiles] = useState([]);
  const [rawImageGroups, setRawImageGroups] = useState([[]]);
  const [fieldSelections, setFieldSelections] = useState({});
  const [imageRotations, setImageRotations] = useState({}); // Track rotation degrees for each image
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(false);
  
  const fileInputRef = useRef(null);

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
    setFieldSelections({});
    setCategoryFields([]);
    setLocalCategoryID('');
    setRawFiles([]);
    setRawImageGroups([[]]);
    setSelectedImages([]);
    setLocalImageGroups([]);
    setImageRotations({});
    
    // Reset parent state
    setFilesBase64([]);
    setCategory("--");
    setsubCategory("--");
    setErrorMessages([]);
    setImageGroups([[]]);
    setBatchSize(0);
    onPriceChange("");
    onSKUChange("");
    onImageGroupsChange([[]], [[]]);
    onCategoryChange("");
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    
    setIsDirty(false);
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
      setFieldSelections({});
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
        setFieldSelections(initialSelections);
      } catch (error) {
        console.error('Error fetching category fields:', error);
        setCategoryFields([]);
        setFieldSelections({});
      }
    };

    fetchCategoryFields();
  }, [subCategory]);

  // Synchronize with parent component
  useEffect(() => {
    if (rawFiles.length > 0 && filesBase64.length === 0) {
      setRawFiles([]);
      setImageRotations({});
    }
  }, [filesBase64]);

  // Category change handler
  const handleCategoryChange = (e) => {
    const cat = e.target.value;
    setSelectedCategory(cat);
    setSubcategories(categories[cat] || ['--']);
    const defaultSub = categories[cat]?.[0] || '--';
    setsubCategory(defaultSub);
    setCategory(cat);
    setIsDirty(true);
    validateSelection(cat, defaultSub);
  };

  // Subcategory change handler
  const handleSubCategoryChange = (e) => {
    const sub = e.target.value;
    setsubCategory(sub);
    setIsDirty(true);
    validateSelection(selectedCategory, sub);
  };

  // Validate category and subcategory selection
  const validateSelection = (cat, sub) => {
    const errorMsg = "Please select a valid category and subcategory.";
    if (cat === "--" || sub === "--") {
      if (!errorMessages.includes(errorMsg)) {
        setErrorMessages(prev => [...prev, errorMsg]);
      }
    } else {
      setErrorMessages(prev => prev.filter(msg => msg !== errorMsg));
    }
  };

  // Handle image rotation
  const handleRotateImage = async (index, direction) => {
    try {
      // Get current rotation or default to 0
      const currentRotation = imageRotations[index] || 0;
      
      // Calculate new rotation (90 clockwise or -90 counterclockwise)
      const rotationChange = direction === 'right' ? 90 : -90;
      const newRotation = (currentRotation + rotationChange + 360) % 360;
      
      // Rotate image using the imported rotateImage function
      const rotatedImage = await rotateImage(filesBase64[index], rotationChange);
      
      // Update image in filesBase64 array
      const updatedImages = [...filesBase64];
      updatedImages[index] = rotatedImage;
      
      // Update rotation tracking
      setImageRotations(prev => ({
        ...prev,
        [index]: newRotation
      }));
      
      // Update state
      setFilesBase64(updatedImages);
      setIsDirty(true);
    } catch (error) {
      console.error("Error rotating image:", error);
    }
  };

  // Updated file change handler with diagnostic logging
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    console.log(`Processing ${files.length} files...`);
    setIsUploading(true);
    setTotalFiles(files.length);
    setProcessedFiles(0);
    setUploadProgress(0);

    const base64List = [];
    const newRawFiles = [];
    const processingErrors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        console.log(`Processing file ${i+1}/${files.length}: ${files[i].name}`);
        
        // Use the imported processImage function with auto-rotation flag
        const base64 = await processImage(files[i], autoRotateEnabled);
        
        base64List.push(base64);
        newRawFiles.push(files[i]);
        
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      } catch (error) {
        console.error(`Error processing file ${files[i].name}:`, error);
        processingErrors.push(`Failed to process ${files[i].name}: ${error.message}`);
      }
    }

    // If we have processing errors, alert the user
    if (processingErrors.length > 0) {
      console.warn(`${processingErrors.length} files failed to process:`, processingErrors);
      // Optionally display these errors to the user
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setRawFiles(prev => [...prev, ...newRawFiles]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
    setIsDirty(true);
    setTimeout(() => setIsUploading(false), 500);
    
    console.log(`Completed processing ${base64List.length} files successfully`);
  };

  // Similarly update the drop handler
  const handleDrop = async (e) => {
    e.preventDefault();
    const imgs = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) return;

    setIsUploading(true);
    setTotalFiles(imgs.length);
    setProcessedFiles(0);
    setUploadProgress(0);

    const base64List = [];
    const newRawFiles = [];

    for (let i = 0; i < imgs.length; i++) {
      try {
        // Use the imported processImage function with auto-rotation flag
        const base64 = await processImage(imgs[i], autoRotateEnabled);
        
        base64List.push(base64);
        newRawFiles.push(imgs[i]);
        
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / imgs.length) * 100));
      } catch (error) {
        console.error("Error processing file:", error);
      }
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setRawFiles(prev => [...prev, ...newRawFiles]);
    setIsDirty(true);
    setTimeout(() => setIsUploading(false), 500);
  };

  const handleDragOver = (e) => e.preventDefault();
  const triggerFileInput = () => fileInputRef.current.click();
  const handlePriceChange = (e) => onPriceChange(e.target.value);
  const handleSkuChange = (e) => onSKUChange(e.target.value);

  // Toggle image selection
  const toggleImageSelection = (idx) => {
    setSelectedImages(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  // Group selected images
  const handleGroupSelected = () => {
    const groupImgs = selectedImages.map(i => filesBase64[i]);
    const groupRawFiles = selectedImages.map(i => rawFiles[i]);
    
    const remainingBase64 = filesBase64.filter((_, i) => !selectedImages.includes(i));
    const remainingRawFiles = rawFiles.filter((_, i) => !selectedImages.includes(i));
    
    // Remove rotations for selected images
    const newRotations = { ...imageRotations };
    selectedImages.forEach(index => {
      delete newRotations[index];
    });
    
    // Reindex remaining rotations
    const finalRotations = {};
    let newIndex = 0;
    filesBase64.forEach((_, oldIndex) => {
      if (!selectedImages.includes(oldIndex)) {
        if (newRotations[oldIndex] !== undefined) {
          finalRotations[newIndex] = newRotations[oldIndex];
        }
        newIndex++;
      }
    });
    setImageRotations(finalRotations);
    
    setImageGroups(prev => {
      let updated = [...prev];
      const firstEmptyIndex = updated.findIndex(g => g.length === 0);
      if (firstEmptyIndex !== -1) {
        updated[firstEmptyIndex] = [...updated[firstEmptyIndex], ...groupImgs];
      } else {
        updated.push(groupImgs);
      }
      if (updated[updated.length - 1].length > 0) {
        updated.push([]);
      }
      return updated;
    });
    
    setRawImageGroups(prev => {
      let updated = [...prev];
      const firstEmptyIndex = updated.findIndex(g => !g || g.length === 0);
      if (firstEmptyIndex !== -1) {
        updated[firstEmptyIndex] = [...(updated[firstEmptyIndex] || []), ...groupRawFiles];
      } else {
        updated.push(groupRawFiles);
      }
      if (updated[updated.length - 1] && updated[updated.length - 1].length > 0) {
        updated.push([]);
      }
      return updated;
    });
    
    setFilesBase64(remainingBase64);
    setRawFiles(remainingRawFiles);
    setSelectedImages([]);
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
  
// Optimized upload to S3 function
const uploadToS3 = async (file) => {
  // Skip FileReader for better performance - use file directly
  try {
    // Generate a more optimized filename with a unique ID to prevent collisions
    const uniqueId = Math.random().toString(36).substring(2, 10);
    const fileName = `${Date.now()}_${uniqueId}_${file.name.replace(/\s+/g, '_')}`;
    
    // For large files, consider using multipart upload
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: fileName,
      Body: file, // AWS SDK can handle File objects directly
      ContentType: file.type,
      ACL: "public-read",
    };
    
    const command = new PutObjectCommand(uploadParams);
    await s3Client.send(command);
    
    // Construct S3 URL
    const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
    return s3Url;
  } catch (error) {
    console.error("Upload error:", error);
    throw error; // Re-throw to be handled by caller
  }
};

// Add a retryable upload function for better reliability
const uploadToS3WithRetry = async (file, maxRetries = 3, delayMs = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadToS3(file);
    } catch (error) {
      console.warn(`Upload attempt ${attempt} failed for ${file.name}:`, error);
      lastError = error;
      
      // Only wait if we're going to retry
      if (attempt < maxRetries) {
        // Exponential backoff with jitter for better retry behavior
        const jitter = Math.random() * 300;
        const backoffTime = delayMs * Math.pow(1.5, attempt - 1) + jitter;
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  
  // If we get here, all retries failed
  throw lastError || new Error('Maximum upload retries reached');
};

// Enhancement: Add a function to handle multi-file uploads with improved batching
const batchUploadToS3 = async (files, concurrentUploads = 4, onProgress) => {
  const results = [];
  let completed = 0;
  const total = files.length;
  
  // Process files in batches to control concurrency
  for (let i = 0; i < total; i += concurrentUploads) {
    const batch = files.slice(i, i + concurrentUploads);
    const batchPromises = batch.map(async (file, batchIndex) => {
      if (!file) return null;
      
      try {
        const url = await uploadToS3WithRetry(file);
        completed++;
        
        // Report progress if callback provided
        if (onProgress && typeof onProgress === 'function') {
          onProgress(completed, total, Math.round((completed / total) * 100));
        }
        
        return url;
      } catch (error) {
        console.error(`Failed to upload ${file.name} after retries:`, error);
        completed++;
        
        // Still report progress even for failures
        if (onProgress && typeof onProgress === 'function') {
          onProgress(completed, total, Math.round((completed / total) * 100));
        }
        
        return null;
      }
    });
    
    // Wait for current batch to complete before starting next batch
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
  }
  
  return results;
};

 // Handle generate listing with upload
const handleGenerateListingWithUpload = async () => {
  try {
    setIsUploading(true);
    
    // 1. Optimize file collection with a single array spread instead of repeated operations
    const allRawFiles = [
      ...rawFiles,
      ...rawImageGroups.flatMap(group => group?.length ? group : [])
    ];
    
    setTotalFiles(allRawFiles.length);
    
    // 2. Handle case with no raw files but base64 images - optimized conversion logic
    let filesToUpload = allRawFiles;
    if (allRawFiles.length === 0 && filesBase64.length > 0) {
      const convertedFiles = await Promise.all(
        filesBase64.map(async (base64, index) => {
          try {
            const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) return null;
            
            const contentType = matches[1];
            const base64Data = matches[2];
            
            // Use more efficient ArrayBuffer approach instead of character-by-character conversion
            const byteString = atob(base64Data);
            const arrayBuffer = new ArrayBuffer(byteString.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            
            for (let i = 0; i < byteString.length; i++) {
              uint8Array[i] = byteString.charCodeAt(i);
            }
            
            const blob = new Blob([uint8Array], {type: contentType});
            const fileExt = contentType.split('/')[1] || 'jpg';
            const fileName = `image_${Date.now()}_${index}.${fileExt}`;
            
            return new File([blob], fileName, {type: contentType});
          } catch (error) {
            console.error(`Error converting base64 to file:`, error);
            return null;
          }
        })
      );
      
      // Filter out nulls from failed conversions
      filesToUpload = convertedFiles.filter(Boolean);
      
      if (filesToUpload.length === 0) {
        setIsUploading(false);
        handleGenerateListing();
        return;
      }
      
      setTotalFiles(filesToUpload.length);
    } else if (allRawFiles.length === 0) {
      // No files to upload, proceed directly
      setIsUploading(false);
      handleGenerateListing();
      return;
    }
    
    // 3. Use the new optimized batch upload function for better performance and reliability
    const s3UrlsList = await batchUploadToS3(
      filesToUpload, 
      4, // Concurrent uploads
      (completed, total, percentage) => {
        setProcessedFiles(completed);
        setUploadProgress(percentage);
      }
    );
    
    // 4. Optimized image group organization
    // Pre-calculate how many URLs we need for each destination
    const mainUrlsNeeded = filesBase64.length;
    const groupUrlsNeeded = imageGroups.reduce((acc, group) => 
      acc + (group?.length || 0), 0);
    
    // Ensure we have enough URLs
    if (s3UrlsList.length < (mainUrlsNeeded + groupUrlsNeeded)) {
      console.warn(`Not enough uploaded URLs (${s3UrlsList.length}) for all images (${mainUrlsNeeded + groupUrlsNeeded})`);
    }
    
    // Distribute URLs efficiently
    let urlIndex = 0;
    
    // For main images
    const mainUrlsToUse = Math.min(mainUrlsNeeded, s3UrlsList.length - urlIndex);
    const newFilesBase64 = s3UrlsList.slice(urlIndex, urlIndex + mainUrlsToUse);
    urlIndex += mainUrlsToUse;
    
    // Create groups for main images if needed
    const finalImageGroups = [];
    const finalS3ImageGroups = [];
    
    // Add main image groups based on batchSize
    if (newFilesBase64.length > 0 && batchSize > 0) {
      for (let i = 0; i < newFilesBase64.length; i += batchSize) {
        const groupUrls = newFilesBase64.slice(i, i + batchSize);
        if (groupUrls.length > 0) {
          finalImageGroups.push(groupUrls);
          finalS3ImageGroups.push(groupUrls);
        }
      }
    }
    
    // Process existing image groups
    imageGroups.forEach((group, index) => {
      if (group?.length > 0) {
        const groupUrlsToUse = Math.min(group.length, s3UrlsList.length - urlIndex);
        if (groupUrlsToUse > 0) {
          const groupUrls = s3UrlsList.slice(urlIndex, urlIndex + groupUrlsToUse);
          finalImageGroups.push(groupUrls);
          finalS3ImageGroups.push(groupUrls);
          urlIndex += groupUrlsToUse;
        } else {
          finalS3ImageGroups.push([]);
        }
      } else if (index === imageGroups.length - 1) {
        // Keep empty group at the end
        finalImageGroups.push([]);
        finalS3ImageGroups.push([]);
      }
    });
    
    // Make sure we have an empty group at the end
    if (finalImageGroups.length === 0 || 
        (finalImageGroups.length > 0 && finalImageGroups[finalImageGroups.length - 1].length > 0)) {
      finalImageGroups.push([]);
      finalS3ImageGroups.push([]);
    }
    
    // 5. Update state and perform followup actions in parallel where possible
    // Fetch eBay category in parallel with state updates to save time
    const ebayCategoryPromise = fetchEbayCategoryID(selectedCategory, subCategory);
    
    // Update parent state with URLs
    onImageGroupsChange(finalImageGroups, finalS3ImageGroups);
    setFilesBase64([]);
    setLocalImageGroups(finalImageGroups);
    
    // Clear raw files state
    setRawFiles([]);
    setRawImageGroups([[]]);
    setImageRotations({});
    
    // Wait for category fetch to complete
    const ebayCategoryID = await ebayCategoryPromise;
    setLocalCategoryID(ebayCategoryID);
    onCategoryChange(ebayCategoryID);
    
    setIsUploading(false);
    
    // Now call handleGenerateListing
    await handleGenerateListing();
    
  } catch (error) {
    console.error('Error during upload process:', error);
    setIsUploading(false);
  }
};

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  const ProgressBar = ({ progress }) => (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="progress-text">{progress}%</div>
    </div>
  );

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
                    setFieldSelections(prev => ({ ...prev, [field.FieldLabel]: e.target.value }))
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

      <div className="upload-area" onDrop={handleDrop} onDragOver={handleDragOver} onClick={triggerFileInput}>
        {isUploading ? (
          <div className="upload-loading">
            <p>Processing images... ({processedFiles}/{totalFiles})</p>
            <ProgressBar progress={uploadProgress} />
          </div>
        ) : (
          <p>Click or drag images to upload</p>
        )}
        <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileChange} hidden />
      </div>
      
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
        <select disabled={!filesBase64.length} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>
          {!filesBase64.length
            ? <option>0</option>
            : Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                .filter(n => filesBase64.length % n === 0 && n <= 24)
                .map(n => <option key={n} value={n}>{n}</option>)
          }
        </select>
      </div>

      <div className="button-group">
        <button className="primary" disabled={!selectedImages.length} onClick={handleGroupSelected}>Group Selected</button>
        <button className="danger" onClick={() => {
          handleClearAllLocal();
          if (handleClearAll) handleClearAll();
        }}>Clear All</button>
      </div>

      <div className="generate-area" onMouseEnter={() => !isValidSelection && setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
        <button className="primary large" disabled={!isValidSelection || isLoading || !isDirty} onClick={handleGenerateListingWithUpload}>
          {isLoading || isUploading ? (
            <span className="loading-button">
              <Spinner /> {isUploading ? `Uploading... (${processedFiles}/${totalFiles})` : `Generating... (${completedChunks}/${totalChunks})`}
            </span>
          ) : 'Generate Listing'}
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