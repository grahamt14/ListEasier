import { useState, useRef, useEffect } from 'react';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

export const getSelectedCategoryOptionsJSON = (fieldSelections) => {
  const output = {};
  Object.entries(fieldSelections).forEach(([label, value]) => {
    if (value && value !== "-- Select --") {
      output[label] = value;
    }
  });
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
}) {
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [categoryFields, setCategoryFields] = useState([]);
  const [showTooltip, setShowTooltip] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [processedFiles, setProcessedFiles] = useState(0);

  const fileInputRef = useRef(null);

  const [fieldSelections, setFieldSelections] = useState({});

  const data = {
    "--": ["--"],
    "Movies & TV": ["Other Formats", "VHS Tapes", "UMDs", "Laserdiscs", "DVDs & Blu-ray Discs"],
    "Books & Magazines": ["Textbooks", "Magazines", "Catalogs", "Books"],
    "Photographic Images": ["Stereoviews & Stereoscopes", "Photographs", "Negatives", "Magic Lantern Slides", "Film Slides"],
    "Music": ["Other Formats", "Vinyl Records", "CDs", "Cassettes"],
    "Video Games": ["None"],
    "Postcards": ["Non-Topographical Postcards", "Topographical Postcards"]
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

    for (let i = 0; i < files.length; i++) {
      try {
        const base64 = await convertToBase64(files[i]);
        base64List.push(base64);
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
    setIsDirty(true);

    setTimeout(() => {
      setIsUploading(false);
    }, 500);
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

    for (let i = 0; i < imgs.length; i++) {
      try {
        const base64 = await convertToBase64(imgs[i]);
        base64List.push(base64);
        setProcessedFiles(i + 1);
        setUploadProgress(Math.round(((i + 1) / imgs.length) * 100));
      } catch (error) {
        console.error("Error converting file:", error);
      }
    }

    setFilesBase64(prev => [...prev, ...base64List]);
    setIsDirty(true);

    setTimeout(() => {
      setIsUploading(false);
    }, 500);
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

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  const ProgressBar = ({ progress }) => (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="progress-text">{progress}%</div>
    </div>
  );

  const getSelectedCategoryOptionsJSON = () => {
    const output = {};
    Object.entries(fieldSelections).forEach(([label, value]) => {
      if (value && value !== "-- Select --") {
        output[label] = value;
      }
    });
    console.log(output);
    return output;
  };

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
        <label>Category Fields</label>
        <div className="scrollable-fields">
          {categoryFields.length > 0 ? (
            categoryFields.map((field, index) => {
              const options = field.CategoryOptions
                ? field.CategoryOptions.split(';').map(opt => opt.trim())
                : [];
              return (
                <div key={index} className="field-row">
                  <label>{field.FieldLabel || `Field ${index + 1}`}</label>
                  <select
                    className="uniform-select"
                    value={fieldSelections[field.FieldLabel] || ""}
                    onChange={(e) => {
                      const selectedValue = e.target.value;
                      setFieldSelections(prev => ({
                        ...prev,
                        [field.FieldLabel]: selectedValue
                      }));
                    }}
                  >
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

      <div
        className="upload-area"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={triggerFileInput}
      >
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