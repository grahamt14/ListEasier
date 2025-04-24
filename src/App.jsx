import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [filesBase64, setFilesBase64] = useState([]);
  const [category, setCategory] = useState();
  const [subCategory, setsubCategory] = useState();
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  const [errorMessages, setErrorMessages] = useState([]);
  const [batchSize, setBatchSize] = useState(0);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imageGroups, setImageGroups] = useState([[]]);
  const [responseData, setResponseData] = useState([]);
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [processingGroups, setProcessingGroups] = useState([]);
  
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

  // Effect to log responseData changes for debugging
  useEffect(() => {
    if (responseData.some(item => item !== null)) {
      console.log("Response data updated:", responseData);
    }
  }, [responseData]);

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

  useEffect(() => {
    if (filesBase64.length === 0) return setBatchSize(0);
    const valid = Array.from({ length: filesBase64.length }, (_, i) => i + 1)
      .filter(n => filesBase64.length % n === 0 && n <= 24);
    setBatchSize(valid[valid.length - 1]);
  }, [filesBase64]);

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

  const handleGroupDrop = (e, groupIdx, imgIdx = null) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("from");
    const index = e.dataTransfer.getData("index");
    setHoveredGroup(null);

    setImageGroups(prev => {
      let updated = [...prev];
      if (from === "pool") {
        const i = parseInt(index, 10);
        const img = filesBase64[i];
        setFilesBase64(prevFiles => prevFiles.filter((_, j) => j !== i));
        const tgt = [...updated[groupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        updated[groupIdx] = tgt;
      } else {
        const [srcG, srcI] = index.split("-").map(Number);
        if (!(srcG === groupIdx && srcI === imgIdx)) {
          const img = updated[srcG][srcI];
          updated[srcG] = updated[srcG].filter((_, j) => j !== srcI);
          const tgt = [...updated[groupIdx]];
          imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
          updated[groupIdx] = tgt;
        }
      }
      if (updated[updated.length - 1].length > 0) updated.push([]);
      return updated;
    });

    setSelectedImages([]);
    setIsDirty(true);
  };

  const handleGenerateListing = async () => {
    // 1. Gather all non-empty groups
    const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

    // 2. If there are leftover pool images, batch them too
    if (filesBase64.length > 0 && batchSize > 0) {
      for (let i = 0; i < filesBase64.length; i += batchSize) {
        nonEmptyGroups.push(filesBase64.slice(i, i + batchSize));
      }
    }

    // 3. Initialize UI state
    setTotalChunks(nonEmptyGroups.length);
    setCompletedChunks(0);
    setResponseData(Array(nonEmptyGroups.length).fill(null));
    setImageGroups([...nonEmptyGroups, []]);
    setFilesBase64([]);
    setIsDirty(false);
    setIsLoading(true);
    setProcessingGroups(Array(nonEmptyGroups.length).fill(true));

    // 4. Fire off each fetch separately and update state upon completion
    nonEmptyGroups.forEach((group, idx) => {
      console.log(`Starting API call for group ${idx}`);
      
      fetch(
        "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, subCategory, Base64Key: [group] })
        }
      )
        .then(res => res.json())
        .then(data => {
          console.log(`Group ${idx} API call completed`);
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          // Use setTimeout to force this update to be processed separately
          setTimeout(() => {
            setResponseData(prev => {
              const next = [...prev];
              next[idx] = Array.isArray(parsed) ? parsed[0] : parsed;
              return next;
            });
            
            setProcessingGroups(prev => {
              const next = [...prev];
              next[idx] = false;
              return next;
            });
          }, 0);
        })
        .catch(err => {
          console.error(`Error during fetch for group ${idx}:`, err);
          
          setTimeout(() => {
            setResponseData(prev => {
              const next = [...prev];
              next[idx] = { error: "Failed to fetch listing data", raw_content: err.message };
              return next;
            });
            
            setProcessingGroups(prev => {
              const next = [...prev];
              next[idx] = false;
              return next;
            });
          }, 0);
        })
        .finally(() => {
          setTimeout(() => {
            setCompletedChunks(c => {
              const done = c + 1;
              console.log(`Completed ${done} of ${nonEmptyGroups.length} chunks`);
              if (done === nonEmptyGroups.length) {
                setIsLoading(false);
              }
              return done;
            });
          }, 0);
        });
    });
  };

  const handleClearAll = () => {
    setFilesBase64([]);
    setSelectedCategory("--");
    setSubcategories(["--"]);
    setCategory(undefined);
    setsubCategory(undefined);
    setErrorMessages([]);
    setBatchSize(0);
    setSelectedImages([]);
    setImageGroups([[]]);
    setResponseData([]);
    setIsLoading(false);
    setIsDirty(true);
    setProcessingGroups([]);
    setIsUploading(false);
    setUploadProgress(0);
    setTotalFiles(0);
    setProcessedFiles(0);
  };

  const renderResponseData = (index) => {
    const response = responseData[index];
    if (!response) return null;
    if (response.error) {
      return (
        <div className="response-error">
          <p style={{ color: '#000' }}>Error: {response.error}</p>
          {response.raw_content && <p style={{ color: '#000' }}>Raw content: {response.raw_content}</p>}
        </div>
      );
    }
    return (
      <div className="response-data">
        <h4 style={{ color: '#000' }}>Generated Listing</h4>
        <div className="response-fields">
          {Object.entries(response).map(([key, value]) => (
            <div key={key} className="response-field">
              <strong style={{ color: '#000' }}>
                {key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}:
              </strong>
              <span style={{ color: '#000' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    );
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
    <div className="app-container">
      <header className="header">
        <img src="/images/ListEasier.jpg" alt="ListEasier" className="logo" />
        <h1>ListEasier</h1>
      </header>

      <main className="main-card">
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

          <div className="upload-area" 
               onDrop={handleDrop} 
               onDragOver={handleDragOver} 
               onClick={triggerFileInput}>
            {isUploading ? (
              <div className="upload-loading">
                <Spinner />
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

        <section className="preview-section">
          <h2>Image Groups & Listings</h2>
          {isLoading && (
            <div className="loading-progress">
              <div className="loading-bar-container">
                <div className="loading-bar" style={{ width: `${(completedChunks / totalChunks) * 100}%` }}></div>
              </div>
              <p>Processing {completedChunks} of {totalChunks} listings...</p>
            </div>
          )}
          <div className="groups-container">
            {imageGroups.map((group, gi) => (
              <div
                key={gi}
                className="group-card"
                onDrop={e => handleGroupDrop(e, gi)}
                onDragOver={handleDragOver}
              >
                <div className="thumbs">
                  {group.map((src, xi) => (
                    <img key={xi} src={src} alt={`group-${gi}-img-${xi}`} draggable onDragStart={e => {
                      e.dataTransfer.setData("from", "group");
                      e.dataTransfer.setData("index", `${gi}-${xi}`);
                    }} />
                  ))}
                </div>
                <div className="listing">
                  {processingGroups[gi] ? (
                    <div className="listing-loading">
                      <Spinner />
                      <p>Generating listing for group {gi+1}...</p>
                    </div>
                  ) : (
                    renderResponseData(gi) || <p>No data. Click "Generate Listing".</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>© 2025 ListEasier</p>
      </footer>

    </div>
  );
}

export default App;