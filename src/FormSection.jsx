import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

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
  const [categoryFields, setCategoryFields] = useState([]);
  const [showTooltip, setShowTooltip] = useState(false);

  // Postcard-specific aspect states
  const [postageCondition, setPostageCondition] = useState("");
  const [era, setEra] = useState("");
  const [originalLicensed, setOriginalLicensed] = useState("");
  const [subject, setSubject] = useState("");

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

  const aspectData = {
    postageCondition: [{ localizedValue: "Posted" }, { localizedValue: "Unposted" }],
    era: [
      { localizedValue: "Pre-Postcard (Pre-1870)" },
      { localizedValue: "Pioneer (1870-1898)" },
      { localizedValue: "Private Mailing Card (1898-1901)" },
      { localizedValue: "Undivided Back (1901-1907)" }
    ],
    originalLicensed: [{ localizedValue: "Licensed Reprint" }, { localizedValue: "Original" }],
    subject: [
      { localizedValue: "Actors" },
      { localizedValue: "Aircraft" },
      { localizedValue: "Air Force" },
      { localizedValue: "Airline" }
    ]
  };

  const client = new DynamoDBClient({
    region: 'us-east-2',
    credentials: {
      accessKeyId: 'AKIA5QMLZNPJMZIFQFFS',
      secretAccessKey: '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',
    },
  });

  useEffect(() => {
    if (!subCategory || subCategory === "--") {
      setCategoryFields([]);
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
      } catch (error) {
        console.error('Error fetching category fields:', error);
        setCategoryFields([]);
      }
    };

    fetchCategoryFields();
  }, [subCategory]);

  const handleCategoryChange = (e) => {
    const cat = e.target.value;
    setSelectedCategory(cat);
    setSubcategories(data[cat]);
    setsubCategory(data[cat][0]);
    setCategory(cat);
    setIsDirty(true);
    validateSelection(cat, data[cat][0]);
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

  const handleAspectChange = (aspect, value) => {
    setIsDirty(true);
    switch (aspect) {
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

  const ProgressBar = ({ progress }) => (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="progress-text">{progress}%</div>
    </div>
  );

  // --- Rest of your file upload, image selection, grouping logic remains unchanged (you already did that correctly).

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
          {subcategories.map((sub, i) => <option key={i} value={sub}>{sub}</option>)}
        </select>
      </div>

      <div className="form-group">
        {categoryFields.length > 0 ? (
          categoryFields.map((field, index) => {
            const options = field.CategoryOptions
              ? field.CategoryOptions.split(';').map(opt => opt.trim())
              : [];

            return (
              <div key={index}>
                <label>{field.FieldLabel || `Field ${index + 1}`}</label>
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
