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

  // Drag/drop between pool and groups
  const handleGroupDrop = (e, groupIdx, imgIdx = null) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("from");
    const index = e.dataTransfer.getData("index");
    setHoveredGroup(null);

    if (from === "pool") {
      const i = parseInt(index, 10);
      const img = filesBase64[i];
      setFilesBase64(prev => prev.filter((_, j) => j !== i));
      setImageGroups(prev => {
        const cp = [...prev];
        const tgt = [...cp[groupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        cp[groupIdx] = tgt;
        return cp;
      });
    } else {
      const [srcG, srcI] = index.split("-").map(Number);
      if (srcG === groupIdx && srcI === imgIdx) return;
      const img = imageGroups[srcG][srcI];
      setImageGroups(prev => {
        const cp = [...prev];
        cp[srcG] = cp[srcG].filter((_, j) => j !== srcI);
        const tgt = [...cp[groupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        cp[groupIdx] = tgt;
        return cp;
      });
    }
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
          </select>
        </label>

        {/* Upload area */}
        <div onDrop={handleDrop} onDragOver={handleDragOver} onClick={triggerFileInput}
             style={{ border: '2px dashed #aaa', padding: '2rem', textAlign: 'center', backgroundColor: '#6a6a6a', borderRadius: '8px', cursor: 'pointer', marginBottom: '1rem' }}>
          <p>Click or drag images to upload</p>
          <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>

        {/* Batch size */}
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

      {/* Group Selected button ```
      the images are stretching inside of the image group containers. They should always maintain their height and width. It is ok if there is space between them.
      ``` */}
      <button disabled={!selectedImages.length} onClick={handleGroupSelected} style={{ margin: '1rem 0' }}>
        Group Selected
      </button>

      {/* Pool of images */}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: `repeat(${batchSize||1}, 1fr)`, marginBottom: '2rem' }}>
        {filesBase64.map((src, i) => (
          <img key={i} src={src} draggable onDragStart={e => {
            e.dataTransfer.setData('from','pool');
            e.dataTransfer.setData('index',i);
            const img=new Image();img.src=src;img.onload=()=>e.dataTransfer.setDragImage(img,50,50);
          }} onClick={()=>toggleImageSelection(i)}
               style={{ width: '200px', border: selectedImages.includes(i)?'3px solid #00f':'2px solid transparent', cursor:'grab', transition:'transform 0.2s' }}
               onMouseEnter={e=>e.currentTarget.style.transform='scale(1.05)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
          />
        ))}
      </div>

      {/* Image Groups */}
      <h3>Image Groups</h3>
      {imageGroups.map((group, gi)=> (
        <div key={gi} onDrop={e=>handleGroupDrop(e,gi)} onDragOver={handleDragOver}
             onDragEnter={()=>setHoveredGroup(gi)} onDragLeave={()=>setHoveredGroup(null)}
             style={{ minWidth:'250px', minHeight:'200px', border:hoveredGroup===gi?'2px dashed #00bfff':'1px solid #ccc', padding:'1rem', borderRadius:'8px', marginBottom:'1rem', display:'flex', flexWrap:'wrap', gap:'0.5rem', backgroundColor:'#f5f5f5' }}>
          {group.map((src, xi)=>(
            <img key={xi} src={src} draggable onDragStart={e=>{
              e.dataTransfer.setData('from','group');
              e.dataTransfer.setData('index',`${gi}-${xi}`);
              const img=new Image();img.src=src;img.onload=()=>e.dataTransfer.setDragImage(img,50,50);
            }} onDrop={e=>handleGroupDrop(e,gi,xi)} onDragOver={e=>e.preventDefault()}
                 onClick={()=>{
                   const cp=[...imageGroups];
                   const removed=cp[gi].splice(xi,1)[0];
                   setImageGroups(cp.filter(g=>g.length));
                   setFilesBase64(prev=>[...prev,removed]);
                 }}
                 style={{ width:'100px', height:'auto', cursor:'grab', transition:'transform 0.2s' }}
                 onMouseEnter={e=>e.currentTarget.style.transform='scale(1.05)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}
            />
          ))}
        </div>
      ))}

      {/* Generate Listing */}
      <button onClick={handleGenerateListing} style={{ padding:'1rem 2rem', fontSize:'1rem', backgroundColor:'#007bff', color:'#fff', border:'none', borderRadius:'8px', cursor:'pointer' }}
              onMouseEnter={e=>e.currentTarget.style.backgroundColor='#0056b3'} onMouseLeave={e=>e.currentTarget.style.backgroundColor='#007bff'}>
        Generate Listing
      </button>
    </div>
  );
}

export default App;
