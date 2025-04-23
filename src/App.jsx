import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  // Base64-encoded images pool
  const [filesBase64, setFilesBase64] = useState([]);
  // Category and subcategory selections
  const [category, setCategory] = useState();
  const [subCategory, setsubCategory] = useState();
  const [selectedCategory, setSelectedCategory] = useState("--");
  const [subcategories, setSubcategories] = useState(["--"]);
  // Validation errors
  const [errorMessages, setErrorMessages] = useState([]);
  // Number of images per item (batch size)
  const [batchSize, setBatchSize] = useState(0);
  // Currently selected images in the pool
  const [selectedImages, setSelectedImages] = useState([]);
  // Groups of images; starts with one empty group
  const [imageGroups, setImageGroups] = useState([[]]);
  // API response data
  const [responseData, setResponseData] = useState(null);
  // Hover state for drag styling
  const [hoveredGroup, setHoveredGroup] = useState(null);

  const fileInputRef = useRef(null);

  // Predefined category -> subcategories mapping
  const data = {
    "--": ["--"],
    "Movies & TV": ["Other Formats", "VHS Tapes", "UMDs", "Laserdiscs", "DVDs & Blu-ray Discs"],
    "Books & Magazines": ["Textbooks", "Magazines", "Catalogs", "Books"],
    "Photographic Images": ["Stereoviews & Stereoscopes", "Photographs", "Negatives", "Magic Lantern Slides", "Film Slides"],
    "Music": ["Other Formats", "Vinyl Records", "CDs", "Cassettes"],
    "Video Games": ["None"],
    "Postcards": ["Non-Topographical Postcards", "Topographical Postcards"]
  };

  // Update subcategories when category changes
  const handleCategoryChange = (e) => {
    const category = e.target.value;
    setSelectedCategory(category);
    setSubcategories(data[category]);
    setsubCategory(data[category][0]);
    setCategory(category);

    // Validate
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

  // Handle subcategory selection
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

  // Utility: convert File to Base64
  const convertToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err);
    });
  };

  // Handle file uploads via input
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    const base64List = await Promise.all(files.map(f => convertToBase64(f)));
    setFilesBase64(prev => [...prev, ...base64List]);
    setErrorMessages(prev => prev.filter(msg => msg !== "Please upload at least one image."));
  };

  // Drag-and-drop upload
  const handleDrop = async (e) => {
    e.preventDefault();
    const imgs = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    const base64List = await Promise.all(imgs.map(f => convertToBase64(f)));
    setFilesBase64(prev => [...prev, ...base64List]);
  };

  const handleDragOver = (e) => e.preventDefault();
  const triggerFileInput = () => fileInputRef.current.click();

  // Toggle selection highlight in pool
  const toggleImageSelection = (idx) => {
    setSelectedImages(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  // Compute batch sizes when pool changes
  useEffect(() => {
    if (filesBase64.length === 0) return setBatchSize(0);
    const valid = Array.from({ length: filesBase64.length }, (_, i) => i + 1)
      .filter(n => filesBase64.length % n === 0 && n <= 24);
    setBatchSize(valid[valid.length - 1]);
  }, [filesBase64]);

  // Handle 'Group Selected' click: if first group empty add there, otherwise new group; always keep one empty at end
  const handleGroupSelected = () => {
    const groupImgs = selectedImages.map(i => filesBase64[i]);
    const remaining = filesBase64.filter((_, i) => !selectedImages.includes(i));
    setImageGroups(prev => {
      let updated = [...prev];
      if (updated[0].length === 0) {
        // First group empty: add here
        updated[0] = [...updated[0], ...groupImgs];
      } else {
        // First group has images: create a new group
        updated.push(groupImgs);
      }
      // Ensure a fresh empty group at the end
      if (updated[updated.length - 1].length > 0) {
        updated.push([]);
      }
      return updated;
    });
    setFilesBase64(remaining);
    setSelectedImages([]);
  };

  // Drag/drop between pool and groups: ensures an empty group remains at end after drop
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

      // Ensure exactly one empty group at the end
      if (updated[updated.length - 1].length > 0) {
        updated.push([]);
      }
      // Remove any extra empty groups before the last
      updated = updated.filter((grp, idx) => grp.length > 0 || idx === updated.length - 1);

      return updated;
    });

    setSelectedImages([]);
  };

  // Send listing to API
  const handleGenerateListing = () => {
    fetch(
      "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, subCategory, Base64Key: imageGroups }) }
    )
      .then(res => res.json())
      .then(data => setResponseData(data))
      .catch(err => console.error("Error CALLING API:", err));
  };

  return (
    <div className="centered-container">
      {/* Logo */}
      <img src="/images/ListEasier.jpg" alt="ListEasier" className="logoCSS" />

      {/* Category & Subcategory */}
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
