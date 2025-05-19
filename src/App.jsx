import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

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
  const [price, setPrice] = useState('');
  const [sku, setSKU] = useState('');
  const [categoryID, setCategoryID] = useState('');
  const [s3ImageGroups, setS3ImageGroups] = useState([[]]);
  
  const client = new DynamoDBClient({
    region: 'us-east-2',
    credentials: {
      accessKeyId: 'AKIA5QMLZNPJMZIFQFFS',
      secretAccessKey: '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',
    },
  });
  
  const handleCategoryChange = (newCategoryID) => {
    setCategoryID(newCategoryID);
  };

  const handlePriceUpdate = (newPrice) => {
    setPrice(newPrice);
  };
  
  const handleSKUUpdate = (newSKU) => {
    setSKU(newSKU);
  };

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
  
  const handleImageGroupsUpdate = (groups, s3Groups = null) => {
    const hasEmptyGroupAtEnd = imageGroups.length > 0 && 
                               imageGroups[imageGroups.length - 1].length === 0;
    
    let newGroups;
    if (hasEmptyGroupAtEnd && groups[groups.length - 1].length > 0) {
      newGroups = [...groups, []];
    } else if (!hasEmptyGroupAtEnd && groups[groups.length - 1].length === 0) {
      newGroups = groups.slice(0, -1);
    } else {
      newGroups = [...groups];
    }
    
    setImageGroups(newGroups);
    
    if (s3Groups) {
      setS3ImageGroups(s3Groups);
    } else {
      const s3UrlGroups = groups.map(group => {
        return group.map(url => {
          return typeof url === 'string' && !url.startsWith('data:') ? url : null;
        }).filter(url => url !== null);
      });
      
      setS3ImageGroups(s3UrlGroups);
    }
  };

  const handleGenerateListing = async () => {
    const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

    if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
      return;
    }

    let allGroupsToProcess = [...nonEmptyGroups];
    let newGroups = [];
    
    const s3GroupsForDownload = s3ImageGroups.filter(group => 
      group.length > 0 && group.some(url => url && !url.startsWith('data:'))
    );
    
    if (filesBase64.length > 0 && batchSize > 0) {
      const poolGroups = [];
      for (let i = 0; i < filesBase64.length; i += batchSize) {
        poolGroups.push(filesBase64.slice(i, i + batchSize));
      }
      
      allGroupsToProcess = [...nonEmptyGroups, ...poolGroups];
      
      setImageGroups(prev => {
        const lastEmptyGroup = prev[prev.length - 1]?.length === 0 ? [prev[prev.length - 1]] : [[]];
        return [...nonEmptyGroups, ...poolGroups, ...lastEmptyGroup];
      });
      
      newGroups = [...nonEmptyGroups, ...poolGroups];
    } else {
      newGroups = [...nonEmptyGroups];
    }

    setTotalChunks(allGroupsToProcess.length);
    setCompletedChunks(0);
    setResponseData(Array(allGroupsToProcess.length).fill(null));
    setIsDirty(false);
    setIsLoading(true);
    setProcessingGroups(Array(allGroupsToProcess.length).fill(true));

    const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku);

    allGroupsToProcess.forEach((group, idx) => {
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
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);

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
              if (done === allGroupsToProcess.length) {
                setIsLoading(false);
              }
              return done;
            });
          }, 0);
        });
    });
    
    return Promise.resolve();
  };

  const handleClearAll = () => {
    setFilesBase64([]);
    setCategory(undefined);
    setsubCategory(undefined);
    setErrorMessages([]);
    setBatchSize(0);
    setSelectedImages([]);
    setImageGroups([[]]);
    setS3ImageGroups([[]]);
    setResponseData([]);
    setIsLoading(false);
    setIsDirty(true);
    setProcessingGroups([]);
  };

  const generateCSVContent = () => {
    const validResponses = responseData.filter(response => response && !response.error);
    
    if (validResponses.length === 0) {
      alert("No valid listings to download!");
      return null;
    }
    
    let filteredS3ImageGroups = s3ImageGroups.filter(imageGroup => 
      Array.isArray(imageGroup) && imageGroup.length > 0
    );
    
    const header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format
`;

    let csvContent = header;

    validResponses.forEach((listing, index) => {
      const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      
      let photoUrls = [];
      
      // Try to get URLs from S3ImageGroups first
      if (filteredS3ImageGroups && Array.isArray(filteredS3ImageGroups) && index < filteredS3ImageGroups.length) {
        if (Array.isArray(filteredS3ImageGroups[index])) {
          photoUrls = filteredS3ImageGroups[index].filter(url => url && typeof url === 'string' && !url.startsWith('data:'));
        }
      }
      
      // If no S3 URLs found, try imageGroups
      if (photoUrls.length === 0 && imageGroups && Array.isArray(imageGroups) && index < imageGroups.length) {
        if (Array.isArray(imageGroups[index])) {
          photoUrls = imageGroups[index].filter(url => url && typeof url === 'string' && !url.startsWith('data:'));
        }
      }
      
      const formattedUrls = photoUrls.filter(url => url).join('||');
      const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      const line = `Draft,${sku},${categoryID},"${title}",,${price},1,${formattedUrls},3000,"${description}",FixedPrice`;
      
      csvContent += `${line}\n`;
    });
    
    return csvContent;
  };

  const downloadListingsAsZip = () => {
    const csvContent = generateCSVContent();
    if (!csvContent) return;
    
    const zip = new JSZip();
    zip.file("ebay_draft_listings.csv", csvContent);
    
    zip.generateAsync({ type: "blob" })
      .then(content => {
        const zipFileName = `listings_${new Date().toISOString().split('T')[0]}.zip`;
        saveAs(content, zipFileName);
      })
      .catch(err => {
        alert("Failed to create download. Please try again.");
      });
  };

  const downloadListingsAsCsv = () => {
    const csvContent = generateCSVContent();
    if (!csvContent) return;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvFileName = `listings_${new Date().toISOString().split('T')[0]}.csv`;
    
    if (navigator.msSaveBlob) {
      navigator.msSaveBlob(blob, csvFileName);
    } else {
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", csvFileName);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
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
          fieldSelections={fieldSelections}
          setFieldSelections={setFieldSelections}
          price={price} 
          onPriceChange={handlePriceUpdate}
          sku={sku} 
          onSKUChange={handleSKUUpdate}
          onImageGroupsChange={handleImageGroupsUpdate}
          onCategoryChange={handleCategoryChange}
        />

        <section className="preview-section">
          <div className="section-header">
            <h2>Image Groups & Listings</h2>
            {hasValidListings && (
              <button 
                className="download-button"
                onClick={downloadListingsAsCsv}
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