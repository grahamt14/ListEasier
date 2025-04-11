import { useState } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';
import './App.css';

function App() {
  const [responseData, setResponseData] = useState(null);
  const [filesBase64, setFilesBase64] = useState([]);
  const [category, setCategory] = useState();
  const [subCategory, setsubCategory] = useState();

  // Data representing the categories and their associated subcategories
  const data = {
    "Movies & TV": ["Other Formats", "VHS Tapes", "UMDs", "Laserdiscs", "DVDs & Blu-ray Discs"],
    "Books & Magazines": ["Textbooks", "Magazines", "Catalogs", "Books"],
    "Photographic Images": ["Stereoviews & Stereoscopes", "Photographs", "Negatives", "Magic Lantern Slides", "Film Slides"],
    "Music": ["Other Formats", "Vinyl Records", "CDs", "Cassettes"],
    "Video Games": ["None"],
    "Postcards": ["Non-Topographical Postcards", "Topographical Postcards"]
  };

  const [selectedCategory, setSelectedCategory] = useState("Movies & TV");
  const [subcategories, setSubcategories] = useState(data["Movies & TV"]);

  const handleCategoryChange = (e) => {
    const category = e.target.value;
    setSelectedCategory(category);
    setSubcategories(data[category]);
    setCategory(category); // optional: sets for POST data
  };

  const handleSubCategoryChange = (e) => {
    setsubCategory(e.target.value);
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
    setFilesBase64(base64List);
  };

  const handleClick = () => {
    const count = filesBase64.length;
    const postData = {
      Base64Key: { filesBase64 },
      imageCount: { count },
      category: { category },
      subCategory: { subCategory }
    };

    fetch("https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(postData)
    })
      .then((response) => response.json())
      .then((data) => {
        setResponseData(data);
        console.log(data);
      })
      .catch((error) => console.error("Error CALLING API:", error));
  };

  return (
    <>
      <div>
        <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAA" alt="ListEasier Image" className="logoCSS" />
      </div>

      <div className="card">

        {/* Category and Subcategory Dropdowns */}
        <div>
          <select onChange={handleCategoryChange} value={selectedCategory}>
            {Object.keys(data).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>

          <select onChange={handleSubCategoryChange}>
            {subcategories.map((subcategory, index) => (
              <option key={index} value={subcategory}>
                {subcategory}
              </option>
            ))}
          </select>
        </div>

        {/* File Upload and Generate Button */}
        <div>
          <input type="file" multiple accept="image/*" onChange={handleFileChange} />

          <button onClick={handleClick}>
            Generate Listing
          </button>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            {filesBase64.map((src, index) => (
              <img key={index} src={src} alt={`preview ${index}`} style={{ width: 200 }} />
            ))}
          </div>
        </div>

        {/* Display Response JSON */}
        <br />
        {<pre>{JSON.stringify(responseData, null, 2)}</pre>}
      </div>
    </>
  );
}

export default App;
