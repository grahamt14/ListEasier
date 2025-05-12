import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// CategorySelector is a separate component outside FormSection
function CategorySelector() {
  const [subcategories, setSubcategories] = useState(['SubCategory1', 'SubCategory2']);
  const [subCategory, setSubCategory] = useState('');
  const [categoryFields, setCategoryFields] = useState([]);

  // Initialize DynamoDB client
const client = new DynamoDBClient({
  region: 'us-east-2', // e.g. 'us-east-1'
  credentials: {
    accessKeyId: 'AKIA5QMLZNPJMZIFQFFS',
    secretAccessKey: 'w00ym2XMKKtgq8d0J7lCpNq8Mcu/p9fFzE22mtML',
  },
});

  useEffect(() => {
    const fetchCategoryFields = async () => {
      if (!subCategory) {
        setCategoryFields([]);
        return;
      }

      try {
        const command = new QueryCommand({
          TableName: 'CategoryFields',
          KeyConditionExpression: 'SubCategoryType = :sub',
          ExpressionAttributeValues: {
            ':sub': { S: subCategory },
          },
        });

        const response = await client.send(command);
        const items = response.Items.map((item) => unmarshall(item));
        setCategoryFields(items);
      } catch (error) {
        console.error('Error fetching CategoryFields:', error);
        setCategoryFields([]);
      }
    };

    fetchCategoryFields();
  }, [subCategory]);

  return (
    <div>
      <h2>Select SubCategory</h2>
      <select onChange={(e) => setSubCategory(e.target.value)} value={subCategory}>
        <option value="">-- Select --</option>
        {subcategories.map((sub, i) => (
          <option key={i} value={sub}>{sub}</option>
        ))}
      </select>

      <div style={{ marginTop: '20px' }}>
        {categoryFields.length > 0 ? (
          categoryFields.map((field, index) => {
            const options = field.CategoryOptions
              ? field.CategoryOptions.split(';').map((opt) => opt.trim())
              : [];

            return (
              <div key={index} style={{ marginBottom: '15px' }}>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                  {field.FieldLabel || `Field ${index + 1}`}
                </label>
                <select>
                  <option value="">-- Select --</option>
                  {options.map((opt, idx) => (
                    <option key={idx} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            );
          })
        ) : (
          <p>No category fields available for this subcategory.</p>
        )}
      </div>
    </div>
  );
}

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
  Spinner
}) {
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [showTooltip, setShowTooltip] = useState(false);
  
  // New states for aspect fields
  const [postageCondition, setPostageCondition] = useState("");
  const [era, setEra] = useState("");
  const [originalLicensed, setOriginalLicensed] = useState("");
  const [subject, setSubject] = useState("");
  
  // New states for upload loading
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [processedFiles, setProcessedFiles] = useState(0);

  const fileInputRef = useRef(null);

  const data = {
    "--": ["--"],
    "Movies & TV": ["Other Formats", "VHS Tapes", "UMDs", "Laserdiscs", "DVDs & Blu-ray Discs"],
    "Books & Magazines": ["Textbooks", "Magazines", "Catalogs", "Books"],
    "Photographic Images": ["Stereoviews & Stereoscopes", "Photographs", "Negatives", "Magic Lantern Slides", "Film Slides"],
    "Music": ["Other Formats", "Vinyl Records", "CDs", "Cassettes"],
    "Video Games": ["None"],
    "Postcards": ["Non-Topographical Postcards", "Topographical Postcards"]
  };

  // Aspect data from JSON
  const aspectData = {
    postageCondition: [
      { localizedValue: "Posted" },
      { localizedValue: "Unposted" }
    ],
    era: [
      { localizedValue: "Pre-Postcard (Pre-1870)" },
      { localizedValue: "Pioneer (1870-1898)" },
      { localizedValue: "Private Mailing Card (1898-1901)" },
      { localizedValue: "Undivided Back (1901-1907)" }
    ],
    originalLicensed: [
      { localizedValue: "Licensed Reprint" },
      { localizedValue: "Original" }
    ],
    subject: [
      {
          "localizedValue": "Actors"
        },
        {
          "localizedValue": "Aircraft"
        },
        {
          "localizedValue": "Air Force"
        },
        {
          "localizedValue": "Airline"
        }
    ]
  };

  useEffect(() => {
    if (filesBase64.length === 0) return setBatchSize(0);
    const valid = Array.from({ length: filesBase64.length }, (_, i) => i + 1)
      .filter(n => filesBase64.length % n === 0 && n <= 24);
    setBatchSize(valid[valid.length - 1]);
  }, [filesBase64, setBatchSize]);

  // Show postcard-specific form fields only when Postcards category is selected
  const showPostcardFields = selectedCategory === "Postcards";

  const handleCategoryChange = (e) => {
    const category = e.target.value;
    setSelectedCategory(category);
    setSubcategories(data[category]);
    setsubCategory(data[category][0]);
    setCategory(category);
    setIsDirty(true);

    if (category === "--" || data[category][0] === "--") {
      setErrorMessages(prev =>
        prev.includes("Please select a valid category and subcategory.")
          ? prev
          : [...prev, "Please select a valid category and subcategory."]
      );
    } else {
      setErrorMessages(prev => prev.filter(msg => msg !== "Please select a valid category and subcategory."));
    }
  };

  const handleSubCategoryChange = (e) => {
    const sub = e.target.value;
    setsubCategory(sub);
    setIsDirty(true);
    if (selectedCategory === "--" || sub === "--") {
      setErrorMessages(prev =>
        prev.includes("Please select a valid category and subcategory.")
          ? prev
          : [...prev, "Please select a valid category and subcategory."]
      );
    } else {
      setErrorMessages(prev => prev.filter(msg => msg !== "Please select a valid category and subcategory."));
    }
  };

  const handleAspectChange = (aspect, value) => {
    setIsDirty(true);
    switch(aspect) {
      case "postageCondition":
        setPostageCondition(value);
        break;
      case "era":
        setEra(value);
        break;
      case "originalLicensed":
        setOriginalLicensed(value);
        break;
      case "subject":
        setSubject(value);
        break;
      default:
        break;
    }
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
    
    // Set uploading state and initialize progress
    setIsUploading(true);
    setTotalFiles(files.length);
    setProcessedFiles(0);
    setUploadProgress(0);
    
    const base64List = [];
    
    // Process files sequentially for better progress tracking
    for (let i = 0; i < files.length; i++) {
      try {
        const base64 = await convertToBase64(files[i]);
        base64List.push(base64);
        
        // Update progress
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }
    
    setFilesBase64(prev => [...prev, ...base64List]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
    setIsDirty(true);
    
    // Clear uploading state
    setTimeout(() => {
      setIsUploading(false);
    }, 500); // Small delay to show 100% briefly
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const imgs = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    
    // Set uploading state and initialize progress
    setIsUploading(true);
    setTotalFiles(imgs.length);
    setProcessedFiles(0);
    setUploadProgress(0);
    
    const base64List = [];
    
    // Process files sequentially for better progress tracking
    for (let i = 0; i < imgs.length; i++) {
      try {
        const base64 = await convertToBase64(imgs[i]);
        base64List.push(base64);
        
        // Update progress
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / imgs.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }
    
    setFilesBase64(prev => [...prev, ...base64List]);
    setIsDirty(true);
    
    // Clear uploading state
    setTimeout(() => {
      setIsUploading(false);
    }, 500); // Small delay to show 100% briefly
  };

  const handleDragOver = (e) => e.preventDefault();
  const triggerFileInput = () => fileInputRef.current.click();

  const toggleImageSelection = (idx) => {
    setSelectedImages(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleGroupSelected = () => {
    const groupImgs = selectedImages.map(i => filesBase64[i]);
    const remaining = filesBase64.filter((_, i) => !selectedImages.includes(i));
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
    setFilesBase64(remaining);
    setSelectedImages([]);
  };

  // Progress bar component
  const ProgressBar = ({ progress }) => (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="progress-text">{progress}%</div>
    </div>
  );

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";
  
  


  return (
    <section className="form-section">
      <div className="form-group">
        <label>Category</label>
        <select onChange={handleCategoryChange} value={selectedCategory}>
          {Object.keys(data).map(cat => <option key={cat} value={cat}>{cat}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>SubCategory</label>
        <select onChange={handleSubCategoryChange} value={subCategory}>
          {subcategories.map((sub, i) => <option key={i}>{sub}</option>)}
        </select>
      </div>
	  
	  <div>
      <h2>Select SubCategory</h2>
      <select onChange={handleSubCategoryChange} value={subCategory}>
        <option value="">-- Select --</option>
        {subcategories.map((sub, i) => (
          <option key={i} value={sub}>
            {sub}
          </option>
        ))}
      </select>

      <div style={{ marginTop: '20px' }}>
        {categoryFields.length > 0 ? (
          categoryFields.map((field, index) => {
            const options = field.CategoryOptions
              ? field.CategoryOptions.split(';').map((opt) => opt.trim())
              : [];

            return (
              <div key={index} style={{ marginBottom: '15px' }}>
                <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                  {field.FieldLabel || `Field ${index + 1}`}
                </label>
                <select>
                  <option value="">-- Select --</option>
                  {options.map((opt, idx) => (
                    <option key={idx} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        ) : (
          <p>No category fields available for this subcategory.</p>
        )}
      </div>
    </div>

      {/* Postcard-specific aspect fields - only shown when Postcards is selected */}
      {showPostcardFields && (
        <div className="postcard-attributes">
          <h3>Postcard Details</h3>
          
          <div className="form-group">
            <label>Postage Condition</label>
            <select 
              value={postageCondition} 
              onChange={(e) => handleAspectChange("postageCondition", e.target.value)}
            >
              <option value="">Select Postage Condition</option>
              {aspectData.postageCondition.map((option, i) => (
                <option key={i} value={option.localizedValue}>
                  {option.localizedValue}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Era</label>
            <select 
              value={era} 
              onChange={(e) => handleAspectChange("era", e.target.value)}
            >
              <option value="">Select Era</option>
              {aspectData.era.map((option, i) => (
                <option key={i} value={option.localizedValue}>
                  {option.localizedValue}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Original/Licensed Reprint</label>
            <select 
              value={originalLicensed} 
              onChange={(e) => handleAspectChange("originalLicensed", e.target.value)}
            >
              <option value="">Select Type</option>
              {aspectData.originalLicensed.map((option, i) => (
                <option key={i} value={option.localizedValue}>
                  {option.localizedValue}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Subject</label>
            <select 
              value={subject} 
              onChange={(e) => handleAspectChange("subject", e.target.value)}
            >
              <option value="">Select Subject</option>
              {aspectData.subject.map((option, i) => (
                <option key={i} value={option.localizedValue}>
                  {option.localizedValue}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="upload-area" 
           onDrop={handleDrop} 
           onDragOver={handleDragOver} 
           onClick={triggerFileInput}>
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
        <button className="primary large" disabled={!isValidSelection || isLoading || !isDirty} onClick={handleGenerateListing}>
          {isLoading ? (
            <span className="loading-button">
              <Spinner /> Generating... ({completedChunks}/{totalChunks})
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