import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { GetCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import piexif from "piexifjs";
import EXIF from 'exif-js';

export const getSelectedCategoryOptionsJSON = (fieldSelections, price, sku) => {
  const output = {};
  Object.entries(fieldSelections).forEach(([label, value]) => {
    if (value && value !== "-- Select --") {
      output[label] = value;
    }
  });
  if (price) output["price"] = price;
  if (sku) output["sku"] = sku;

  console.log(output);
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
  
  // Store the raw files instead of immediately uploading them
  const [rawFiles, setRawFiles] = useState([]);

  // Add a state to track raw files in image groups
  const [rawImageGroups, setRawImageGroups] = useState([[]]);

  const fileInputRef = useRef(null);

  const [fieldSelections, setFieldSelections] = useState({});

  const client = new DynamoDBClient({
    region: 'us-east-2',
    credentials: {
      accessKeyId: 'AKIA5QMLZNPJMZIFQFFS',
      secretAccessKey: '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',
    },
  });

  const docClient = DynamoDBDocumentClient.from(client);
  
  // AWS config
  const REGION = "us-east-2"; // Update your region
  const BUCKET_NAME = "listeasier"; // Update your bucket name
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908"; // Update your Identity Pool ID

const s3Client = new S3Client({
  region: REGION,
  credentials: fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID,
  }),
  // Use standard endpoint URL format rather than path-style
  endpoint: `https://s3.${REGION}.amazonaws.com`,
  forcePathStyle: false,
});

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
          const categoryID = item.EbayCategoryID;
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

  const handleSubCategoryChange = (e) => {
    const sub = e.target.value;
    setsubCategory(sub);
    setIsDirty(true);
    validateSelection(selectedCategory, sub);
  };

  const validateSelection = (cat, sub) => {
    if (cat === "--" || sub === "--") {
      if (!errorMessages.includes("Please select a valid category and subcategory.")) {
        setErrorMessages(prev => [...prev, "Please select a valid category and subcategory."]);
      }
    } else {
      setErrorMessages(prev => prev.filter(msg => msg !== "Please select a valid category and subcategory."));
    }
  };

const uploadToS3 = async (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async () => {
      try {
        // Generate a unique file name
        const fileName = `${Date.now()}_${file.name}`;
        
        // Convert the file to ArrayBuffer instead of using the File object directly
        const arrayBuffer = reader.result;
        
        const uploadParams = {
          Bucket: BUCKET_NAME,
          Key: fileName,
          Body: new Uint8Array(arrayBuffer),  // Convert to Uint8Array which AWS SDK can handle
          ContentType: file.type,
          ACL: "public-read",
        };


        console.log("Preparing to upload:", fileName);
        
        try {
          const command = new PutObjectCommand(uploadParams);
          await s3Client.send(command);
          
          const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${fileName}`;
          console.log("Upload success:", s3Url);
          resolve(s3Url);
        } catch (uploadError) {
          console.error("Upload error:", uploadError);
          console.error("Error details:", JSON.stringify(uploadError, Object.getOwnPropertyNames(uploadError)));
          reject(uploadError);
        }
      } catch (err) {
        console.error("Error in upload process:", err);
        reject("Error uploading: " + err.message);
      }
    };

    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      reject(err);
    };
    
    // Read the file as ArrayBuffer instead of just a small slice
    reader.readAsArrayBuffer(file);
  });
};


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

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setIsUploading(true);
    setTotalFiles(files.length);
    setProcessedFiles(0);
    setUploadProgress(0);

    const base64List = [];
    const newRawFiles = [];

    for (let i = 0; i < files.length; i++) {
      try {
        // Convert to base64 for preview
        const base64 = await convertToBase64(files[i]);
        base64List.push(base64);
        
        // Store the raw file for later upload
        newRawFiles.push(files[i]);
        
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setRawFiles(prev => [...prev, ...newRawFiles]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
    setIsDirty(true);
    setTimeout(() => setIsUploading(false), 500);
  };

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
        // Convert to base64 for preview
        const base64 = await convertToBase64(imgs[i]);
        base64List.push(base64);
        
        // Store the raw file for later upload
        newRawFiles.push(imgs[i]);
        
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / imgs.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setRawFiles(prev => [...prev, ...newRawFiles]);
    setIsDirty(true);
    setTimeout(() => setIsUploading(false), 500);
  };

  const handleDragOver = (e) => e.preventDefault();
  const triggerFileInput = () => fileInputRef.current.click();

  const handlePriceChange = (e) => {
    onPriceChange(e.target.value); // Send the new value up to the parent
  };

  const handleSkuChange = (e) => {
    onSKUChange(e.target.value); // Send the new value up to the parent
  };

  const toggleImageSelection = (idx) => {
    setSelectedImages(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  // Modified to keep track of raw files in groups
  const handleGroupSelected = () => {
    // Get selected base64 images and raw files
    const groupImgs = selectedImages.map(i => filesBase64[i]);
    const groupRawFiles = selectedImages.map(i => rawFiles[i]);
    
    // Remove selected images from main arrays
    const remainingBase64 = filesBase64.filter((_, i) => !selectedImages.includes(i));
    const remainingRawFiles = rawFiles.filter((_, i) => !selectedImages.includes(i));
    
    // Update image groups - now tracking both base64 and raw files
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
    
    // Update raw file groups in parallel
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
    
    // Update the main file arrays
    setFilesBase64(remainingBase64);
    setRawFiles(remainingRawFiles);
    setSelectedImages([]);
  };

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

    if (response.Item) {
      return response.Item.EbayCategoryID;
    } else {
      console.warn('No matching category found in ListCategory table.');
      return null;
    }
  } catch (err) {
    console.error('Error fetching EbayCategoryID:', err);
    return null;
  }
};

  // Modified to upload all files (ungrouped and grouped)
  const handleGenerateListingWithUpload = async () => {
    console.log('🚀 Starting handleGenerateListingWithUpload');
    console.log(`Initial state - rawFiles: ${rawFiles.length}, filesBase64: ${filesBase64.length}`);
    console.log(`Image groups: ${imageGroups.length}, Raw image groups: ${rawImageGroups.length}`);
    
    try {
      console.log('Setting isUploading to true');
      setIsUploading(true);
      
      // Collect ALL raw files that need uploading
      let allRawFiles = [...rawFiles];
      
      // Add raw files from image groups
      rawImageGroups.forEach(group => {
        if (group && group.length) {
          allRawFiles = [...allRawFiles, ...group];
        }
      });
      
      console.log(`Total files to upload: ${allRawFiles.length}`);
      setTotalFiles(allRawFiles.length);
      
      if (allRawFiles.length === 0) {
        console.log('⚠️ No raw files to upload');
        setIsUploading(false);
        handleGenerateListing();
        return;
      }
      
      // Upload all raw files to S3
      const s3UrlsList = [];
      
      console.log('Beginning file upload loop');
      for (let i = 0; i < allRawFiles.length; i++) {
        try {
          if (!allRawFiles[i]) {
            console.log(`Skipping undefined file at index ${i}`);
            continue;
          }
          
          console.log(`Processing file ${i + 1}/${allRawFiles.length}: ${allRawFiles[i].name || 'unnamed file'}`);
          console.log(`File type: ${allRawFiles[i].type}, size: ${allRawFiles[i].size} bytes`);
          
          console.log(`Uploading file ${i + 1} to S3...`);
          const s3Url = await uploadToS3(allRawFiles[i]);
          console.log(`Upload successful, received S3 URL: ${s3Url}`);
          
          s3UrlsList.push(s3Url);
          console.log(`Added S3 URL to list, current count: ${s3UrlsList.length}`);
          
          setProcessedFiles(i + 1);
          const progressPercent = Math.round(((i + 1) / allRawFiles.length) * 100);
          console.log(`Setting upload progress to ${progressPercent}%`);
          setUploadProgress(progressPercent);
        } catch (error) {
          console.error(`❌ Error uploading file ${i + 1}:`, error);
          console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
        }
      }
      
      console.log(`Upload complete. Total S3 URLs: ${s3UrlsList.length}`);
      
      // Replace base64 images with S3 URLs
      // First determine how many URLs go to the main array vs. groups
      let urlIndex = 0;
      
      // Replace main filesBase64 array
      if (filesBase64.length > 0) {
        const mainUrls = s3UrlsList.slice(urlIndex, urlIndex + filesBase64.length);
        console.log(`Replacing ${filesBase64.length} main images with S3 URLs`);
        setFilesBase64(mainUrls);
        urlIndex += filesBase64.length;
      }
      
      // Replace image groups with S3 URLs
      if (imageGroups.length > 0) {
        const newImageGroups = [...imageGroups];
        
        for (let i = 0; i < newImageGroups.length; i++) {
          const group = newImageGroups[i];
          if (group && group.length > 0) {
            const groupUrls = s3UrlsList.slice(urlIndex, urlIndex + group.length);
            console.log(`Replacing group ${i} with ${groupUrls.length} S3 URLs`);
            newImageGroups[i] = groupUrls;
            urlIndex += group.length;
          }
        }
        
        setImageGroups(newImageGroups);
		 setLocalImageGroups(newImageGroups);
    onImageGroupsChange(newImageGroups); // Pass to parent
	
  const ebayCategoryID = await fetchEbayCategoryID(selectedCategory, subCategory);
	
            console.log(ebayCategoryID);
	  setLocalCategoryID(ebayCategoryID);
    onCategoryChange(ebayCategoryID); // Send to parent
      }
      
      console.log('Upload process complete, setting isUploading to false');
      setIsUploading(false);
      
      console.log('Calling handleGenerateListing');
      handleGenerateListing();
      
    } catch (error) {
      console.error('❌ Fatal error during upload process:', error);
      console.error('Error stack:', error.stack);
      console.error('Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      console.log('Setting isUploading to false due to error');
      setIsUploading(false);
    }
    
    console.log('🏁 Exiting handleGenerateListingWithUpload');
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
        <button className="danger" onClick={handleClearAll}>Clear All</button>
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
              <img
                key={i}
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
            );
          })}
        </div>
      )}
    </section>
  );
}

export default FormSection;