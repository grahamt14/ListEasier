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
      setErrorMessages(prev =>
        prev.filter(msg => msg !== "Please select a valid category and subcategory.")
      );
    }
  };

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
      setErrorMessages(prev =>
        prev.filter(msg => msg !== "Please select a valid category and subcategory.")
      );
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

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files);
    const base64List = await Promise.all(files.map(file => convertToBase64(file)));
    setFilesBase64(prev => [...prev, ...base64List]);

    setErrorMessages(prev =>
      prev.filter(msg => msg !== "Please upload at least one image.")
    );
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith("image/")
    );
    const base64List = await Promise.all(droppedFiles.map(file => convertToBase64(file)));
    setFilesBase64(prev => [...prev, ...base64List]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const toggleImageSelection = (index) => {
    setSelectedImages((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index]
    );
  };

  useEffect(() => {
    if (filesBase64.length === 0) {
      setBatchSize(0);
      return;
    }

    const validBatchSizes = Array.from({ length: filesBase64.length }, (_, i) => i + 1)
      .filter(num => filesBase64.length % num === 0 && num <= 24);

    setBatchSize(validBatchSizes[validBatchSizes.length - 1]);
  }, [filesBase64]);

  useEffect(() => {
    if (imageGroups[imageGroups.length - 1]?.length > 0) {
      setImageGroups(prev => [...prev, []]);
    }
  }, [imageGroups]);

  const handleGroupDrop = (e, targetGroupIndex, targetImageIndex = null) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("from");
    const index = e.dataTransfer.getData("index");

    if (from === "pool") {
      const imageIndex = parseInt(index, 10);
      const draggedImage = filesBase64[imageIndex];

      setFilesBase64(prev => prev.filter((_, i) => i !== imageIndex));

      setImageGroups(prev => {
        const updated = [...prev];
        const group = [...updated[targetGroupIndex]];
        if (targetImageIndex === null) {
          group.push(draggedImage);
        } else {
          group.splice(targetImageIndex, 0, draggedImage);
        }
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

        // Insert into new group
        const targetGroup = [...updated[targetGroupIndex]];
        if (targetImageIndex === null) {
          targetGroup.push(draggedImage);
        } else {
          targetGroup.splice(targetImageIndex, 0, draggedImage);
        }

        updated[targetGroupIndex] = targetGroup;
        return updated;
      });
    }
  };

  return (
    <>
      <div className="centered-container">
			<div>
				<img src="/images/ListEasier.jpg" alt="Logo" /></div>
			<div className="card">
			<label>Category:
            <select onChange={handleCategoryChange} value={selectedCategory}>
              {Object.keys(data).map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>

          <label>SubCategory:
            <select onChange={handleSubCategoryChange} value={subCategory}>
              {subcategories.map((subcategory, index) => (
                <option key={index} value={subcategory}>{subcategory}</option>
              ))}
            </select>
          </label>

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={triggerFileInput}
            style={{
              border: '2px dashed #aaa',
              padding: '2rem',
              textAlign: 'center',
              backgroundColor: '#6a6a6a',
              borderRadius: '8px',
              cursor: 'pointer',
              marginBottom: '1rem'
            }}
          >
            <p>Click or drag images to upload</p>
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileChange}
              ref={fileInputRef}
              style={{ display: 'none' }}
            />
          </div>

          <label>Images Per Item:
            <select
              disabled={filesBase64.length === 0}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
            >
              {filesBase64.length === 0 ? (
                <option value="0">0</option>
              ) : (
                Array.from({ length: filesBase64.length }, (_, i) => i + 1)
                  .filter(num => filesBase64.length % num === 0 && num <= 24)
                  .map(num => (
                    <option key={num} value={num}>{num}</option>
                  ))
              )}
            </select>
          </label>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            disabled={selectedImages.length === 0}
            onClick={() => {
              const newGroup = selectedImages.map(i => filesBase64[i]);
              const remaining = filesBase64.filter((_, i) => !selectedImages.includes(i));
              setImageGroups(prev => [...prev, newGroup]);
              setFilesBase64(remaining);
              setSelectedImages([]);
            }}
          >
            Group Selected
          </button>
        </div>

        {/* Image Pool */}
        <div style={{
          display: 'grid',
          gap: '1rem',
          marginTop: '1rem',
          gridTemplateColumns: `repeat(${batchSize || 1}, 1fr)`
        }}>
          {filesBase64.map((src, index) => (
            <img
              key={index}
              src={src}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("from", "pool");
                e.dataTransfer.setData("index", index.toString());
              }}
              onClick={() => toggleImageSelection(index)}
              style={{
                width: '200px',
                border: selectedImages.includes(index) ? '3px solid #00f' : '2px solid transparent',
                cursor: 'move',
                transform: 'scale(1)',
                transition: 'transform 0.2s ease-in-out'
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05) rotateZ(1deg)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
            />
          ))}
        </div>

        {/* Grouped Images */}
        <div style={{ marginTop: '2rem' }}>
          <h3>Image Groups</h3>
          {imageGroups.map((group, groupIndex) => (
            <div
              key={groupIndex}
              onDragOver={handleDragOver}
              onDrop={(e) => handleGroupDrop(e, groupIndex)}
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1rem',
                border: '1px solid #ccc',
                padding: '0.5rem',
                borderRadius: '8px',
                flexWrap: 'wrap',
                backgroundColor: '#f5f5f5'
              }}
            >
              {group.map((src, idx) => (
                <img
                  key={idx}
                  src={src}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("from", "group");
                    e.dataTransfer.setData("index", `${groupIndex}-${idx}`);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                  }}
                  onDrop={(e) => handleGroupDrop(e, groupIndex, idx)}
                  onClick={() => {
                    const updated = [...imageGroups];
                    const removed = updated[groupIndex].splice(idx, 1)[0];
                    setImageGroups(updated.filter(g => g.length > 0));
                    setFilesBase64(prev => [...prev, removed]);
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05) rotateZ(1deg)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  style={{
                    width: '100px',
                    border: '2px solid red',
                    cursor: 'move',
                    transition: 'transform 0.2s ease-in-out'
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default App;
