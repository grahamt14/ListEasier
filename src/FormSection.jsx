import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
//import Tesseract from 'tesseract.js'; // Import Tesseract directly
//import * as Tesseract from 'tesseract.js';

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
  
  const fileInputRef = useRef(null);

  // AWS Configuration
  const REGION = "us-east-2";
  const BUCKET_NAME = "listeasier";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const client = new DynamoDBClient({
    region: REGION,
    credentials: {
      accessKeyId: 'AKIA5QMLZNPJMZIFQFFS',
      secretAccessKey: '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',
    },
  });

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

  // Convert image to base64
  const convertToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.floor(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(file.type));
      };
      img.onerror = (err) => reject(err);
      img.src = URL.createObjectURL(file);
    });
  };

// Improved image rotation function that prevents black borders and maintains aspect ratio
const rotateImage = (base64Img, degrees) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Convert degrees to radians for calculations
      const radians = (degrees * Math.PI) / 180;
      
      // Calculate new dimensions to prevent cropping
      // For any rotation angle, we need to find the bounding box dimensions
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      
      // New width and height to contain the entire image after rotation
      const newWidth = Math.round(img.width * cos + img.height * sin);
      const newHeight = Math.round(img.width * sin + img.height * cos);
      
      // Set canvas dimensions to new calculated size
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      // Clear the canvas (important for transparency)
      ctx.fillStyle = "rgba(255, 255, 255, 0)";
      ctx.fillRect(0, 0, newWidth, newHeight);
      
      // Move to center of canvas
      ctx.translate(newWidth / 2, newHeight / 2);
      
      // Rotate the canvas
      ctx.rotate(radians);
      
      // Draw the image at the correct position
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
      
      // Get image type from base64
      const imageType = base64Img.split(';')[0].split(':')[1] || 'image/jpeg';
      
      // Preserve original image quality
      resolve(canvas.toDataURL(imageType, 1.0));
    };
    
    img.onerror = (err) => reject(err);
    img.src = base64Img;
  });
};

  // Handle image rotation
  const handleRotateImage = async (index, direction) => {
    try {
      // Get current rotation or default to 0
      const currentRotation = imageRotations[index] || 0;
      
      // Calculate new rotation (90 clockwise or -90 counterclockwise)
      const rotationChange = direction === 'right' ? 90 : -90;
      const newRotation = (currentRotation + rotationChange + 360) % 360;
      
      // Rotate image
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

// Enhanced Tesseract auto-rotation function with better error handling
const autoRotateWithTesseract = async (base64Img) => {
  // Skip Tesseract if the module is not available
  let Tesseract;
  try {
    const TesseractModule = await import('tesseract.js');
    Tesseract = TesseractModule.default || TesseractModule;
    console.log("Tesseract module loaded successfully");
  } catch (importError) {
    console.error("Tesseract import failed:", importError);
    return base64Img; // Return original image if import fails
  }
  
  try {
    console.log("Starting Tesseract orientation detection...");
    
    // Create worker with safer settings
    const worker = await Tesseract.createWorker({
      logger: m => console.log(`Tesseract [${m.status}]: ${m.progress?.toFixed(2) || 0}`),
    });
    
    // Configure worker specifically for orientation detection only
    await worker.setParameters({
      tessedit_ocr_engine_mode: 1, // LSTM only mode
      tessedit_pageseg_mode: 0,    // OSD only
    });
    
    console.log("Tesseract worker initialized, detecting orientation...");
    
    // Use a longer timeout for Tesseract (10 seconds)
    const recognizePromise = worker.recognize(base64Img);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Tesseract detection timed out")), 10000);
    });
    
    // Race between recognition and timeout
    const result = await Promise.race([recognizePromise, timeoutPromise]);
    
    // Attempt to extract rotation information
    let rotation = 0;
    if (result?.data?.orientation) {
      rotation = result.data.orientation.degrees;
      console.log(`Tesseract detected rotation angle: ${rotation}°`);
    } else if (result?.data?.rotate) {
      rotation = result.data.rotate;
      console.log(`Tesseract detected rotation angle (legacy): ${rotation}°`);
    } else if (result?.data?.osd?.rotate) {
      rotation = result.data.osd.rotate;
      console.log(`Tesseract detected OSD rotation angle: ${rotation}°`);
    } else {
      console.log("No rotation data detected in Tesseract response");
    }
    
    // Always terminate the worker
    await worker.terminate();
    
    // Only rotate if necessary (non-zero rotation detected)
    if (rotation !== 0) {
      console.log(`Applying Tesseract rotation of ${rotation}°`);
      return await rotateImage(base64Img, rotation);
    }
    
    console.log("No rotation needed according to Tesseract");
    return base64Img;
  } catch (error) {
    console.error("Error in Tesseract processing:", error);
    return base64Img; // Return original image if processing fails
  }
};

// Improved heuristic-based orientation detection
const detectRotationWithHeuristics = async (base64Img) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        console.log("Running heuristic orientation detection...");
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions to match image
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw the image on the canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data for analysis
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Analyze quarters of the image for more robust detection
        const topQuarter = analyzeImageSection(data, canvas.width, 0, Math.floor(canvas.height * 0.25), canvas.width);
        const bottomQuarter = analyzeImageSection(data, canvas.width, Math.floor(canvas.height * 0.75), canvas.height, canvas.width);
        const leftQuarter = analyzeImageSectionVertical(data, canvas.width, 0, Math.floor(canvas.width * 0.25), canvas.height);
        const rightQuarter = analyzeImageSectionVertical(data, canvas.width, Math.floor(canvas.width * 0.75), canvas.width, canvas.height);
        
        console.log("Heuristic brightness analysis:", {
          topQuarter,
          bottomQuarter,
          leftQuarter,
          rightQuarter
        });
        
        // Check for possible rotations based on brightness distribution
        if (bottomQuarter > topQuarter * 1.5) {
          console.log("Heuristic suggests image is upside down, rotating 180°");
          rotateImage(base64Img, 180).then(resolve).catch(() => resolve(base64Img));
        } else if (leftQuarter > rightQuarter * 1.5) {
          console.log("Heuristic suggests image is rotated 90° right, rotating left");
          rotateImage(base64Img, 270).then(resolve).catch(() => resolve(base64Img));
        } else if (rightQuarter > leftQuarter * 1.5) {
          console.log("Heuristic suggests image is rotated 90° left, rotating right");
          rotateImage(base64Img, 90).then(resolve).catch(() => resolve(base64Img));
        } else {
          console.log("No clear rotation detected using heuristics");
          resolve(base64Img);
        }
      } catch (err) {
        console.error("Error in heuristic analysis:", err);
        resolve(base64Img); // Return original image on error
      }
    };
    
    img.onerror = () => {
      console.error("Failed to load image for heuristic analysis");
      resolve(base64Img); // Return original image on error
    };
    
    img.src = base64Img;
  });
};

// Enhanced image section analysis for horizontal sections
const analyzeImageSection = (data, width, startY, endY, sectionWidth) => {
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < sectionWidth; x++) {
      const idx = (y * width + x) * 4;
      // Calculate perceived brightness using weighted formula
      const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      totalBrightness += brightness;
      pixelCount++;
    }
  }
  
  return pixelCount > 0 ? totalBrightness / pixelCount : 0;
};

// New function to analyze vertical sections
const analyzeImageSectionVertical = (data, width, startX, endX, sectionHeight) => {
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let x = startX; x < endX; x++) {
    for (let y = 0; y < sectionHeight; y++) {
      const idx = (y * width + x) * 4;
      // Calculate perceived brightness using weighted formula
      const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      totalBrightness += brightness;
      pixelCount++;
    }
  }
  
  return pixelCount > 0 ? totalBrightness / pixelCount : 0;
};

// Combined image processing function with better error handling and diagnostic logging
const processImage = async (file) => {
  try {
    console.log(`Processing file: ${file.name} (${file.size} bytes, type: ${file.type})`);
    
    // Step 1: Convert to base64
    console.log("Converting to base64...");
    const base64 = await convertToBase64(file);
    console.log("Base64 conversion complete");
    
    // Step 2: Try enhanced heuristic approach first
    console.log("Running heuristic orientation detection...");
    let processedImage = await detectRotationWithHeuristics(base64);
    let rotationApplied = processedImage !== base64;
    console.log(`Heuristic detection ${rotationApplied ? 'applied rotation' : 'detected no rotation'}`);
    
    // Step 3: Determine if we should attempt Tesseract processing
    const fileSize = file.size;
    const fileName = file.name.toLowerCase();
    
    const isLikelyDocument = 
      fileSize < 2000000 && // Smaller files are more likely to be document scans
      (fileName.includes('doc') || 
       fileName.includes('receipt') || 
       fileName.includes('scan') || 
       fileName.includes('text') || 
       fileName.includes('page') ||
       fileName.includes('statement') ||
       fileName.includes('invoice'));
    
    // If it's likely a document and no rotation was applied yet, try Tesseract
    if (isLikelyDocument && !rotationApplied) {
      try {
        console.log("File looks like it might contain text, attempting Tesseract...");
        const tesseractResult = await autoRotateWithTesseract(processedImage);
        
        if (tesseractResult !== processedImage) {
          console.log("Tesseract successfully applied rotation");
          processedImage = tesseractResult;
        } else {
          console.log("Tesseract did not detect any needed rotation");
        }
      } catch (tesseractError) {
        console.error("Tesseract processing error:", tesseractError);
        // Continue with our current image if Tesseract fails
      }
    }
    
    return processedImage;
  } catch (error) {
    console.error(`Error processing file ${file.name}:`, error);
    // Convert to base64 as fallback if processing fails
    try {
      return await convertToBase64(file);
    } catch (fallbackError) {
      console.error("Fallback conversion failed:", fallbackError);
      throw new Error(`Unable to process image: ${fallbackError.message}`);
    }
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
      
      // First convert to base64
      const base64 = await processImage(files[i]);
      
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
      // First convert to base64
      let base64 = await convertToBase64(imgs[i]);
      
      // Update progress to show conversion is complete
      setProcessedFiles(i + 0.5);
      setUploadProgress(Math.round(((i + 0.5) / imgs.length) * 100));
      
      // Then attempt to auto-rotate using Tesseract
      try {
        base64 = await autoRotateWithTesseract(base64);
      } catch (tesseractError) {
        console.error("Tesseract processing error:", tesseractError);
        // Continue with original image if Tesseract fails
      }
      
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

  // Handle generate listing with upload
  const handleGenerateListingWithUpload = async () => {
    try {
      setIsUploading(true);
      
      // Collect all raw files that need uploading
      let allRawFiles = [...rawFiles];
      
      rawImageGroups.forEach(group => {
        if (group && group.length) {
          allRawFiles = [...allRawFiles, ...group];
        }
      });
      
      setTotalFiles(allRawFiles.length);
      
      // Handle case with no raw files but base64 images
      if (allRawFiles.length === 0) {
        if (filesBase64.length > 0) {
          const convertedFiles = [];
          for (let i = 0; i < filesBase64.length; i++) {
            try {
              const base64 = filesBase64[i];
              const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              
              if (!matches || matches.length !== 3) continue;
              
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
              const file = new File([blob], fileName, {type: contentType});
              
              convertedFiles.push(file);
            } catch (error) {
              console.error(`Error converting base64 to file:`, error);
            }
          }
          
          if (convertedFiles.length > 0) {
            allRawFiles = convertedFiles;
            setTotalFiles(convertedFiles.length);
          } else {
            setIsUploading(false);
            handleGenerateListing();
            return;
          }
        } else {
          setIsUploading(false);
          handleGenerateListing();
          return;
        }
      }
      
      // Upload all raw files to S3
      const s3UrlsList = [];
      
      for (let i = 0; i < allRawFiles.length; i++) {
        try {
          if (!allRawFiles[i]) continue;
          
          const s3Url = await uploadToS3(allRawFiles[i]);
          s3UrlsList.push(s3Url);
          
          setProcessedFiles(i + 1);
          setUploadProgress(Math.round(((i + 1) / allRawFiles.length) * 100));
        } catch (error) {
          console.error(`Error uploading file:`, error);
        }
      }
      
      // Replace base64 images with S3 URLs
      let urlIndex = 0;
      
      // Replace main filesBase64 array
      let newFilesBase64 = [];
      let mainUrlsUsed = 0;
      if (filesBase64.length > 0) {
        const availableUrls = s3UrlsList.length - urlIndex;
        const urlsToUse = Math.min(filesBase64.length, availableUrls);
        const mainUrls = s3UrlsList.slice(urlIndex, urlIndex + urlsToUse);
        newFilesBase64 = mainUrls;
        urlIndex += urlsToUse;
        mainUrlsUsed = urlsToUse;
      }
      
      // Create new image groups based on batchSize for the main pool images
      const mainImageGroups = [];
      const mainS3ImageGroups = [];
      if (newFilesBase64.length > 0 && batchSize > 0) {
        for (let i = 0; i < mainUrlsUsed; i += batchSize) {
          const groupUrls = newFilesBase64.slice(i, i + batchSize);
          if (groupUrls.length > 0) {
            mainImageGroups.push(groupUrls);
            mainS3ImageGroups.push(groupUrls);
          }
        }
      }
      
      // Replace image groups with S3 URLs
      const newImageGroups = [];
      const newS3ImageGroups = [];
      if (imageGroups.length > 0) {
        for (let i = 0; i < imageGroups.length; i++) {
          const group = imageGroups[i];
          if (group && group.length > 0) {
            const availableUrls = s3UrlsList.length - urlIndex;
            const urlsToUse = Math.min(group.length, availableUrls);
            if (urlsToUse > 0) {
              const groupUrls = s3UrlsList.slice(urlIndex, urlIndex + urlsToUse);
              newImageGroups.push(groupUrls);
              newS3ImageGroups.push(groupUrls);
              urlIndex += urlsToUse;
            } else {
              newS3ImageGroups.push([]);
            }
          } else if (i === imageGroups.length - 1) {
            newImageGroups.push([]);
            newS3ImageGroups.push([]);
          }
        }
      }
      
      // Combine the main image groups with the existing groups
      const finalImageGroups = [...newImageGroups];
      const finalS3ImageGroups = [...newS3ImageGroups];
      
      // Add the created main image groups if they don't already exist
      if (mainImageGroups.length > 0) {
        mainImageGroups.forEach((group, index) => {
          if (group.length > 0) {
            finalImageGroups.push(group);
            finalS3ImageGroups.push(mainS3ImageGroups[index]);
          }
        });
      }
      
      // Make sure we have an empty group at the end
      if (finalImageGroups.length === 0 || finalImageGroups[finalImageGroups.length - 1].length > 0) {
        finalImageGroups.push([]);
        finalS3ImageGroups.push([]);
      }
      
      // Pass the updated images to parent
      onImageGroupsChange(finalImageGroups, finalS3ImageGroups);
      
      // Update parent state with URLs instead of base64 images
      setFilesBase64([]);
      
      // Fetch the eBay category ID
      const ebayCategoryID = await fetchEbayCategoryID(selectedCategory, subCategory);
      setLocalCategoryID(ebayCategoryID);
      onCategoryChange(ebayCategoryID);
      
      // Update local state after parent state
      setLocalImageGroups(finalImageGroups);
      
      // Clear raw files state
      setRawFiles([]);
      setRawImageGroups([[]]);
      setImageRotations({});
      
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