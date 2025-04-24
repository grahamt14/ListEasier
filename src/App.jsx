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

  const handleCategoryChange = (e) => {
    const category = e.target.value;
    setSelectedCategory(category);
    setSubcategories(data[category]);
    setsubCategory(data[category][0]);
    setCategory(category);

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
    // First create an image from the file
    const img = new Image();
    img.onload = () => {
      // Target dimensions - optimal for ChatGPT Vision
      // GPT-4 Vision can handle up to 20MB total across all images
      // A good balance is around 800px width while maintaining aspect ratio
      const maxWidth = 800;
      let width = img.width;
      let height = img.height;
      
      // Calculate new dimensions while maintaining aspect ratio
      if (width > maxWidth) {
        height = Math.floor(height * (maxWidth / width));
        width = maxWidth;
      }
      
      // Create canvas for resizing
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      
      // Draw resized image to canvas
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      
      const base64String = canvas.toDataURL(file.type)
      resolve(base64String);
    };
    
    img.onerror = (err) => reject(err);
    
    // Create a blob URL from the file for the image source
    img.src = URL.createObjectURL(file);
  });
};

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    const base64List = await Promise.all(files.map(f => convertToBase64(f)));
    setFilesBase64(prev => [...prev, ...base64List]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const imgs = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    const base64List = await Promise.all(imgs.map(f => convertToBase64(f)));
    setFilesBase64(prev => [...prev, ...base64List]);
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
      if (updated[0].length === 0) {
        updated[0] = [...updated[0], ...groupImgs];
      } else if (updated[updated.length - 1].length === 0) {
        updated[updated.length - 1] = [...updated[updated.length - 1], ...groupImgs];
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
      updated = updated.filter((grp, idx) => grp.length > 0 || idx === updated.length - 1);
      return updated;
    });

    setSelectedImages([]);
  };

  const handleGenerateListing = () => {
    // Calculate the final groups to send to the API
    let finalGroups = [];
    
    // First, include all non-empty existing groups
    const existingGroups = imageGroups.filter(group => group.length > 0);
    finalGroups = [...existingGroups];
    
    // Then, add new groups from filesBase64 based on batchSize
    if (filesBase64.length > 0 && batchSize > 0) {
      for (let i = 0; i < filesBase64.length; i += batchSize) {
        const group = filesBase64.slice(i, i + batchSize);
        finalGroups.push(group);
      }
      
      // Also update the UI state to reflect these changes
      setImageGroups(prev => {
        const filteredPrev = prev.filter(group => group.length > 0);
        
        const newGroups = [];
        for (let i = 0; i < filesBase64.length; i += batchSize) {
          const group = filesBase64.slice(i, i + batchSize);
          newGroups.push(group);
        }
        
        return [...filteredPrev, ...newGroups, []];
      });
      
      // Clear the filesBase64 array
      setFilesBase64([]);
    }
    
    // Set loading state
    setIsLoading(true);
    
    // Now make the API call with the finalGroups
    fetch(
      "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
      { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ category, subCategory, Base64Key: finalGroups }) 
      }
    )
      .then(res => res.json())
      .then(data => {
        // Parse the response
        let parsedData;
        try {
          // If the response is a string containing JSON, parse it
          if (typeof data.body === 'string') {
            parsedData = JSON.parse(data.body);
          } else {
            // Otherwise use the data directly
            parsedData = data.body || data;
          }
          setResponseData(parsedData);
        } catch (error) {
          console.error("Error parsing response:", error);
          setResponseData([{ error: "Failed to parse response" }]);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Error CALLING API:", err);
        setIsLoading(false);
      });
  };

  // Function to handle clearing all content
  const handleClearAll = () => {
    // Reset all state to initial values
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
  };

  // Function to render response data for each group
  const renderResponseData = (index) => {
    if (!responseData || responseData.length === 0 || !responseData[index]) {
      return null;
    }
    
    const response = responseData[index];
    
    // Check if response is an error message
    if (response.error) {
      return (
        <div className="response-error">
          <p style={{ color: '#000' }}>Error: {response.error}</p>
          {response.raw_content && <p style={{ color: '#000' }}>Raw content: {response.raw_content}</p>}
        </div>
      );
    }
    
    // Otherwise, render the response properties
    return (
      <div className="response-data">
        <h4 style={{ color: '#000' }}>Generated Listing</h4>
        <div className="response-fields">
          {Object.entries(response).map(([key, value]) => (
            <div key={key} className="response-field">
              <strong style={{ color: '#000' }}>{key.replace(/_/g, ' ').charAt(0).toUpperCase() + key.replace(/_/g, ' ').slice(1)}:</strong> 
              <span style={{ color: '#000' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  return (
    <div className="app-container">
      <header className="header">
        <img src="/images/ListEasier.jpg" alt="ListEasier" className="logo" />
        <h1>ListEasier</h1>
      </header>

      <main className="main-card">
        <section className="form-section">
          {/* Category & Subcategory selectors */}
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

          {/* Upload area */}
          <div className="upload-area" onDrop={handleDrop} onDragOver={handleDragOver} onClick={triggerFileInput}>
            <p>Click or drag images to upload</p>
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileChange} hidden />
          </div>

          {/* Preview uploaded images */}
          {filesBase64.length > 0 && (
            <div className="uploaded-images">
              {filesBase64.map((src, i) => (
                <img key={i} src={src} alt={`upload-${i}`} onClick={() => toggleImageSelection(i)} />
              ))}
            </div>
          )}

          <div className="form-group">
            <label>Images Per Item</label>
            <select disabled={!filesBase64.length} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>
              {!filesBase64.length ? <option>0</option> :
                Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                  .filter(n => filesBase64.length % n === 0 && n <= 24)
                  .map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="button-group">
            <button className="primary" disabled={!selectedImages.length} onClick={handleGroupSelected}>Group Selected</button>
            <button className="danger" onClick={handleClearAll}>Clear All</button>
          </div>

          <div className="generate-area" onMouseEnter={() => !isValidSelection && setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
            <button className="primary large" disabled={!isValidSelection || isLoading} onClick={handleGenerateListing}>
              {isLoading ? 'Generating...' : 'Generate Listing'}
            </button>
            {showTooltip && <span className="tooltip">Please select a valid category and subcategory.</span>}
          </div>
        </section>

        {/* Preview section unchanged... */}
      </main>

      <footer className="footer">
        <p>&copy; 2025 ListEasier</p>
      </footer>
    </div>
  );
}

export default App;
