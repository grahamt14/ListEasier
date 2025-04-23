import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  // State for storing base64-encoded files
  const [filesBase64, setFilesBase64] = useState([]);
  // Category and subcategory selections
  const [category, setCategory] = useState();
  const [subCategory, setsubCategory] = useState();
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  // Error messages for validation
  const [errorMessages, setErrorMessages] = useState([]);
  // Images per batch size
  const [batchSize, setBatchSize] = useState(0);
  // Tracks selected images in the pool
  const [selectedImages, setSelectedImages] = useState([]);
  // Image groups container (initially one group)
  const [imageGroups, setImageGroups] = useState([[]]);
  // Response from API
  const [responseData, setResponseData] = useState(null);
  // For drag hover styling
  const [hoveredGroup, setHoveredGroup] = useState(null);

  const fileInputRef = useRef(null);

  // Category -> subcategory mapping
  const data = {
    "--": ["--"],
    "Movies & TV": ["Other Formats", "VHS Tapes", "UMDs", "Laserdiscs", "DVDs & Blu-ray Discs"],
    "Books & Magazines": ["Textbooks", "Magazines", "Catalogs", "Books"],
    "Photographic Images": ["Stereoviews & Stereoscopes", "Photographs", "Negatives", "Magic Lantern Slides", "Film Slides"],
    "Music": ["Other Formats", "Vinyl Records", "CDs", "Cassettes"],
    "Video Games": ["None"],
    "Postcards": ["Non-Topographical Postcards", "Topographical Postcards"]
  };

  // Handle category change and validation
  const handleCategoryChange = (e) => {
    const category = e.target.value;
    setSelectedCategory(category);
    setSubcategories(data[category]);
    setsubCategory(data[category][0]);
    setCategory(category);

    // Validation
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

  // Handle subcategory change and validation
  const handleSubCategoryChange = (e) => {
    const subCategory = e.target.value;
    setsubCategory(subCategory);

    if (selectedCategory === "--" || subCategory === "--") {
      setErrorMessages(prev =>
        prev.includes("Please select a valid category and subcategory.")
          ? prev
          : [...prev, "Please select a valid category and subcategory."]
      );
    } else {
      setErrorMessages(prev => prev.filter(msg => msg !== "Please select a valid category and subcategory."));
    }
  };

  // Convert file to Base64 string
  const convertToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
    });
  };

  // Handle file input selection
  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files);
    const base64List = await Promise.all(files.map(file => convertToBase64(file)));
    setFilesBase64(prev => [...prev, ...base64List]);

    // Remove file-upload error if present
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
  };

  // Handle drag-and-drop into pool
  const handleDrop = async (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith("image/"));
    const base64List = await Promise.all(droppedFiles.map(file => convertToBase64(file)));
    setFilesBase64(prev => [...prev, ...base64List]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Open file picker
  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  // Toggle selection border on pool images
  const toggleImageSelection = (index) => {
    setSelectedImages(prev =>
      prev.includes(index)
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  // Compute valid batch sizes when pool changes
  useEffect(() => {
    if (filesBase64.length === 0) {
      setBatchSize(0);
      return;
    }
    const validBatchSizes = Array.from({ length: filesBase64.length }, (_, i) => i + 1)
      .filter(num => filesBase64.length % num === 0 && num <= 24);
    setBatchSize(validBatchSizes[validBatchSizes.length - 1]);
  }, [filesBase64]);

  // Handle grouping of selected images into the FIRST existing group
  const handleGroupSelected = () => {
    const newGroup = selectedImages.map(i => filesBase64[i]);
    const remaining = filesBase64.filter((_, i) => !selectedImages.includes(i));
    // Add selected images to the first group instead of creating new
    setImageGroups(prev => {
      const updated = [...prev];
      updated[0] = [...updated[0], ...newGroup];
      return updated;
    });
    setFilesBase64(remaining);
    setSelectedImages([]);
  };

  // Handle drag-and-drop between pool and groups
  const handleGroupDrop = (e, targetGroupIndex, targetImageIndex = null) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("from");
    const index = e.dataTransfer.getData("index");

    setHoveredGroup(null);

    if (from === "pool") {
      const imageIndex = parseInt(index, 10);
      const draggedImage = filesBase64[imageIndex];

      setFilesBase64(prev => prev.filter((_, i) => i !== imageIndex));
      setImageGroups(prev => {
        const updated = [...prev];
        const group = [...updated[targetGroupIndex]];
        if (targetImageIndex === null) group.push(draggedImage);
        else group.splice(targetImageIndex, 0, draggedImage);
        updated[targetGroupIndex] = group;
        return updated;
      });
    } else if (from === "group") {
      const [sourceGroupIndex, imageIdx] = index.split("-").map(Number);
      if (sourceGroupIndex === targetGroupIndex && imageIdx === targetImageIndex) return;

      const draggedImage = imageGroups[sourceGroupIndex][imageIdx];
      setImageGroups(prev => {
        const updated = [...prev];
        // Remove from old group
        updated[sourceGroupIndex] = [...updated[sourceGroupIndex]];
        updated[sourceGroupIndex].splice(imageIdx, 1);
        // Insert into target group
        const targetGroup = [...updated[targetGroupIndex]];
        if (targetImageIndex === null) targetGroup.push(draggedImage);
        else targetGroup.splice(targetImageIndex, 0, draggedImage);
        updated[targetGroupIndex] = targetGroup;
        return updated;
      });
    }
  };

  // Send data to API
  const handleGenerateListing = () => {
    const postData = { category, subCategory, Base64Key: imageGroups };
    fetch("https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postData),
    })
      .then(response => response.json())
      .then(data => setResponseData(data))
      .catch(error => console.error("Error CALLING API:", error));
  };

  return (
    <div className="centered-container">
      {/* Logo */}
      <div><img src="/images/ListEasier.jpg" alt="ListEasier" className="logoCSS" /></div>

      {/* Selection Card */}
      <div className="card">
        <label>
          Category:
          <select onChange={handleCategoryChange} value={selectedCategory}>
            {Object.keys(data).map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </label>

        <label>
          SubCategory:
          <select onChange={handleSubCategoryChange} value={subCategory}>
            {subcategories.map((sub, idx) => (
              <option key={idx} value={sub}>{sub}</option>
            ))}
          </select>
        </label>

        {/* Drag-and-drop or click upload area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={triggerFileInput}
          style={{ border: '2px dashed #aaa', padding: '2rem', textAlign: 'center', backgroundColor: '#6a6a6a', borderRadius: '8px', cursor: 'pointer', marginBottom: '1rem' }}
        >
          <p>Click or drag images to upload</p>
          <input type="file" multiple accept="image/*" onChange={handleFileChange} ref={fileInputRef} style={{ display: 'none' }} />
        </div>

        {/* Batch size selector */}
        <label>
          Images Per Item:
          <select disabled={filesBase64.length === 0} value={batchSize} onChange={e => setBatchSize(Number(e.target.value))}>
            {filesBase64.length === 0 ? <option value="0">0</option> :
              Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                .filter(num => filesBase64.length % num === 0 && num <= 24)
                .map(num => <option key={num} value={num}>{num}</option>)
            }
          </select>
        </label>
      </div>

      {/* Group Selected Button */}
      <div style={{ marginTop: '1rem' }}>
        <button disabled={selectedImages.length === 0} onClick={handleGroupSelected}>
          Group Selected
        </button>
      </div>

      {/* Pool Display */}
      <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem', gridTemplateColumns: `repeat(${batchSize || 1}, 1fr)` }}>
        {filesBase64.map((src, index) => (
          <img
            key={index}
            src={src}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData("from", "pool");
              e.dataTransfer.setData("index", index.toString());
              const img = new Image(); img.src = src;
              img.onload = () => e.dataTransfer.setDragImage(img, 50, 50);
            }}
            onClick={() => toggleImageSelection(index)}
            style={{ width: '200px', border: selectedImages.includes(index) ? '3px solid #00f' : '2px solid transparent', cursor: 'grab', transform: 'scale(1)', transition: 'transform 0.2s ease-in-out' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05) rotateZ(1deg)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          />
        ))}
      </div>

      {/* Image Groups Section */}
      <div style={{ marginTop: '2rem' }}>
        <h3>Image Groups</h3>
        {imageGroups.map((group, groupIndex) => (
          <div
            key={groupIndex}
            onDragOver={handleDragOver}
            onDrop={e => handleGroupDrop(e, groupIndex)}
            onDragEnter={() => setHoveredGroup(groupIndex)}
            onDragLeave={() => setHoveredGroup(null)}
            style={{ minWidth: '200px', minHeight: '150px', display: 'flex', gap: '0.5rem', marginBottom: '1rem', border: hoveredGroup === groupIndex ? '2px dashed #00bfff' : '1px solid #ccc', padding: '1rem', borderRadius: '8px', flexWrap: 'wrap', backgroundColor: '#f5f5f5' }}
          >
            {group.map((src, idx) => (
              <img
                key={idx}
                src={src}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData("from", "group");
                  e.dataTransfer.setData("index", `${groupIndex}-${idx}`);
                  const img = new Image(); img.src = src;
                  img.onload = () => e.dataTransfer.setDragImage(img, 50, 50);
                }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleGroupDrop(e, groupIndex, idx)}
                onClick={() => {
                  const updated = [...imageGroups];
                  const removed = updated[groupIndex].splice(idx, 1)[0];
                  setImageGroups(updated.filter(g => g.length > 0));
                  setFilesBase64(prev => [...prev, removed]);
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05) rotateZ(1deg)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                style={{ width: '100px', border: '2px solid red', cursor: 'grab', transition: 'transform 0.2s ease-in-out' }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Generate Listing Button */}
      <div style={{ marginTop: '2rem' }}>
        <button onClick={handleGenerateListing} style={{ padding: '1rem 2rem', fontSize: '1rem', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.3s ease' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#0056b3'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = '#007bff'}
        >
          Generate Listing
        </button>
      </div>
    </div>
  );
}

export default App;
