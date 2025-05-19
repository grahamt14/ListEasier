import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

function App() {
  const [fieldSelections, setFieldSelections] = useState({});
  const [filesBase64, setFilesBase64] = useState([]);
  const [category, setCategory] = useState();
  const [subCategory, setsubCategory] = useState();
  const [errorMessages, setErrorMessages] = useState([]);
  const [batchSize, setBatchSize] = useState(0);
  const [selectedImages, setSelectedImages] = useState([]);
  const [imageGroups, setImageGroups] = useState([[]]);
  const [responseData, setResponseData] = useState([]);
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [totalChunks, setTotalChunks] = useState(0);
  const [completedChunks, setCompletedChunks] = useState(0);
  const [processingGroups, setProcessingGroups] = useState([]);
  


  // Effect to log responseData changes for debugging
  useEffect(() => {
    if (responseData.some(item => item !== null)) {
      console.log("Response data updated:", responseData);
    }
  }, [responseData]);

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


    // 4. Prepare selected category options JSON
    const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections);

  // 5. Fire off each fetch separately and update state upon completion
  nonEmptyGroups.forEach((group, idx) => {
    console.log(`Starting API call for group ${idx}`);

    fetch(
      "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subCategory,
          Base64Key: [group],
          SelectedCategoryOptions: selectedCategoryOptions
        })
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
  };

  // Function to download all listings as a zip file
const downloadListingsAsZip = () => {
  // Filter out empty or null responses
  const validResponses = responseData.filter(response =>
    response && !response.error
  );

  if (validResponses.length === 0) {
    alert("No valid listings to download!");
    return;
  }

  const zip = new JSZip();

  validResponses.forEach((listing, index) => {
    const sku = listing.sku || `SKU${index + 1}`;
    const categoryId = listing.categoryId || '';
    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    const price = selectedCategoryOptions[price];
    const photoUrls = Array.isArray(listing.photoUrls) ? listing.photoUrls.join('|') : '';
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';

    const line = `Draft,${sku},${categoryId},"${title}",,${price},1,"${photoUrls}",3000,"${description}",FixedPrice`;

    const fileName = `listing_${index + 1}${title ? '_' + title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30) : ''}.csv`;

    zip.file(fileName, line);
  });

  // Generate the zip file and trigger download
  zip.generateAsync({ type: "blob" })
    .then(content => {
      saveAs(content, `listings_${new Date().toISOString().split('T')[0]}.zip`);
    })
    .catch(err => {
      console.error("Error creating zip file:", err);
      alert("Failed to create download. Please try again.");
    });
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

  // Spinner component
  const Spinner = () => (
    <div className="spinner">
      <div className="spinner-circle"></div>
    </div>
  );

  // Progress bar component
  const ProgressBar = ({ progress }) => (
    <div className="progress-container">
      <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      <div className="progress-text">{progress}%</div>
    </div>
  );

  // Check if there are valid listings to download
  const hasValidListings = responseData.some(item => item && !item.error);

  return (
    <div className="app-container">
      <header className="header">
        <img src="/images/ListEasier.jpg" alt="ListEasier" className="logo" />
        <h1>ListEasier</h1>
      </header>

      <main className="main-card">
        <FormSection 
          filesBase64={filesBase64}
          setFilesBase64={setFilesBase64}
          category={category}
          setCategory={setCategory}
          subCategory={subCategory}
          setsubCategory={setsubCategory}
          errorMessages={errorMessages}
          setErrorMessages={setErrorMessages}
          batchSize={batchSize}
          setBatchSize={setBatchSize}
          selectedImages={selectedImages}
          setSelectedImages={setSelectedImages}
          imageGroups={imageGroups}
          setImageGroups={setImageGroups}
          isLoading={isLoading}
          isDirty={isDirty}
          setIsDirty={setIsDirty}
          totalChunks={totalChunks}
          completedChunks={completedChunks}
          handleGenerateListing={handleGenerateListing}
          handleClearAll={handleClearAll}
          Spinner={Spinner}
          fieldSelections={fieldSelections}  // Pass fieldSelections down
          setFieldSelections={setFieldSelections}  // Pass setter down
        />

        <section className="preview-section">
          <div className="section-header">
            <h2>Image Groups & Listings</h2>
            {hasValidListings && (
              <button 
                className="download-button"
                onClick={downloadListingsAsZip}
                disabled={isLoading}
              >
                Download All Listings
              </button>
            )}
          </div>
          
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
                onDragOver={e => e.preventDefault()}
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
                    <div>
                      {renderResponseData(gi) || <p>No data. Click "Generate Listing".</p>}
                      {responseData[gi] && !responseData[gi].error}
                    </div>
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