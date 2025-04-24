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
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
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
          <p>Error: {response.error}</p>
          {response.raw_content && <p>Raw content: {response.raw_content}</p>}
        </div>
      );
    }
    
    // Otherwise, render the response properties
    return (
      <div className="response-data">
        <h4>Generated Listing</h4>
        <div className="response-fields">
          {Object.entries(response).map(([key, value]) => (
            <div key={key} className="response-field">
              <strong>{key.replace(/_/g, ' ').charAt(0).toUpperCase() + key.replace(/_/g, ' ').slice(1)}:</strong> {value}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const isValidSelection = selectedCategory !== "--" && subCategory !== "--";

  return (
    <div className="centered-container">
      <img src="/images/ListEasier.jpg" alt="ListEasier" className="logoCSS" />

      <div className="card">
        <label>
          Category:
          <select onChange={handleCategoryChange} value={selectedCategory}>
            {Object.keys(data).map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </label>
        <label>
          SubCategory:
          <select onChange={handleSubCategoryChange} value={subCategory}>
            {subcategories.map((sub, i) => <option key={i}>{sub}</option>)}
          </select>
        </label>

        <div onDrop={handleDrop} onDragOver={handleDragOver} onClick={triggerFileInput}
             style={{ border: '2px dashed #aaa', padding: '2rem', textAlign: 'center', backgroundColor: '#6a6a6a', borderRadius: '8px', cursor: 'pointer', marginBottom: '1rem' }}>
          <p>Click or drag images to upload</p>
          <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>

        <label>
          Images Per Item:
          <select disabled={!filesBase64.length} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>
            {!filesBase64.length ? <option>0</option> :
              Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                .filter(n => filesBase64.length % n === 0 && n <= 24)
                .map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <button disabled={!selectedImages.length} onClick={handleGroupSelected} style={{ margin: '1rem 0' }}>
        Group Selected
      </button>
      <div style={{ position: 'relative', display: 'inline-block' }}
           onMouseEnter={() => !isValidSelection && setShowTooltip(true)}
           onMouseLeave={() => setShowTooltip(false)}>
        <button
          disabled={!isValidSelection || isLoading}
          onClick={handleGenerateListing}
          style={{
            padding: '1rem 2rem',
            fontSize: '1rem',
            backgroundColor: isValidSelection && !isLoading ? '#007bff' : '#ccc',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: isValidSelection && !isLoading ? 'pointer' : 'not-allowed'
          }}>
          {isLoading ? 'Generating...' : 'Generate Listing'}
        </button>
        {showTooltip && (
          <div style={{
            position: 'absolute',
            top: '-2rem',
            left: '0',
            backgroundColor: '#333',
            color: '#fff',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            fontSize: '0.875rem'
          }}>
            Please select a valid category and subcategory.
          </div>
        )}
      </div>
      <h3>Uploaded Images</h3>
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: `repeat(${batchSize || 1}, 1fr)`, marginBottom: '2rem' }}>
        {filesBase64.map((src, i) => (
          <img key={i} src={src} draggable onDragStart={e => {
            e.dataTransfer.setData('from', 'pool');
            e.dataTransfer.setData('index', i);
            const img = new Image(); img.src = src; img.onload = () => e.dataTransfer.setDragImage(img, 50, 50);
          }} onClick={() => toggleImageSelection(i)}
            style={{ width: '200px', border: selectedImages.includes(i) ? '3px solid #00f' : '2px solid transparent', cursor: 'grab', transition: 'transform 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}/>
        ))}
      </div>

      <h3>Image Groups & Generated Listings</h3>
      {imageGroups.filter(group => group.length > 0).map((group, gi) => (
        <div key={gi} className="image-group-container" style={{ marginBottom: '2rem' }}>
          <div 
            onDrop={e => handleGroupDrop(e, gi)} 
            onDragOver={handleDragOver}
            onDragEnter={() => setHoveredGroup(gi)} 
            onDragLeave={() => setHoveredGroup(null)}
            style={{ 
              minWidth: '250px', 
              height: 'auto', 
              border: hoveredGroup === gi ? '2px dashed #00bfff' : '1px solid #ccc', 
              padding: '1rem', 
              borderRadius: '8px', 
              marginBottom: '1rem', 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '0.5rem', 
              backgroundColor: '#f5f5f5' 
            }}
          >
            {group.map((src, xi) => (
              <img 
                key={xi} 
                src={src} 
                draggable 
                onDragStart={e => {
                  e.dataTransfer.setData('from', 'group');
                  e.dataTransfer.setData('index', `${gi}-${xi}`);
                  const img = new Image(); 
                  img.src = src; 
                  img.onload = () => e.dataTransfer.setDragImage(img, 50, 50);
                }} 
                onDrop={e => handleGroupDrop(e, gi, xi)} 
                onDragOver={e => e.preventDefault()}
                onClick={() => {
                  const cp = [...imageGroups];
                  const removed = cp[gi].splice(xi, 1)[0];
                  setImageGroups(cp.filter(g => g.length || g === cp[cp.length - 1]));
                  setFilesBase64(prev => [...prev, removed]);
                }}
                style={{ 
                  width: '100px', 
                  height: 'auto', 
                  cursor: 'grab', 
                  transition: 'transform 0.2s' 
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'} 
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              />
            ))}
          </div>
          
          {/* Display Response Data for this group */}
          <div style={{ 
            padding: '1rem', 
            border: '1px solid #ddd', 
            borderRadius: '8px',
            backgroundColor: '#f9f9f9',
            marginTop: '0.5rem'
          }}>
            {isLoading ? (
              <p>Generating listing...</p>
            ) : responseData && responseData.length > gi ? (
              renderResponseData(gi)
            ) : (
              <p>No listing data available. Click "Generate Listing" to create one.</p>
            )}
          </div>
        </div>
      ))}
      
      {/* Empty drop area for new groups */}
      {imageGroups.length > 0 && imageGroups[imageGroups.length - 1].length === 0 && (
        <div 
          onDrop={e => handleGroupDrop(e, imageGroups.length - 1)} 
          onDragOver={handleDragOver}
          onDragEnter={() => setHoveredGroup(imageGroups.length - 1)} 
          onDragLeave={() => setHoveredGroup(null)}
          style={{ 
            minWidth: '250px', 
            minHeight: '100px',
            border: hoveredGroup === imageGroups.length - 1 ? '2px dashed #00bfff' : '1px dashed #ccc', 
            padding: '1rem', 
            borderRadius: '8px', 
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#f5f5f5'
          }}
        >
          <p style={{ color: '#777' }}>Drag images here to create a new group</p>
        </div>
      )}
    </div>
  );
}

export default App;