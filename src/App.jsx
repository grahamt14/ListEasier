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
  const [price, setPrice] = useState('');
  const [sku, setSKU] = useState('');
  const [categoryID, setCategoryID] = useState('');
  
  // Store S3 image URLs separately from base64 images
  const [s3ImageGroups, setS3ImageGroups] = useState([[]]);
  
  const handleCategoryChange = (newCategoryID) => {
    setCategoryID(newCategoryID);
    console.log('Updated categoryID in parent:', newCategoryID);
  };

  const handlePriceUpdate = (newPrice) => {
    setPrice(newPrice);
  };
  
  const handleSKUUpdate = (newSKU) => {
    setSKU(newSKU);
  };

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
  
  // Updated function to store S3 URLs properly
  const handleImageGroupsUpdate = (groups) => {
    console.log('Received updated image groups from child:', groups);
    
    // Store both the regular image groups (for display) and S3 URLs separately
    // This ensures we have the correct URLs for the CSV export
    
    // Check if the current imageGroups has an empty group at the end
    const hasEmptyGroupAtEnd = imageGroups.length > 0 && 
                               imageGroups[imageGroups.length - 1].length === 0;
    
    // Create the new image groups, ensuring we have an empty group at the end
    let newGroups;
    if (hasEmptyGroupAtEnd && groups[groups.length - 1].length > 0) {
      // If the incoming groups don't have an empty group at the end but we need one
      newGroups = [...groups, []];
    } else if (!hasEmptyGroupAtEnd && groups[groups.length - 1].length === 0) {
      // If the incoming groups have an empty group at the end but we don't need one
      newGroups = groups.slice(0, -1);
    } else {
      // Otherwise, just use the incoming groups as-is
      newGroups = [...groups];
    }
    
    // Update the state with the new groups for display
    setImageGroups(newGroups);
    
    // Store the S3 URLs separately for download
    // Make sure we're actually storing S3 URLs, not base64 data
    const s3UrlGroups = groups.map(group => {
      return group.map(url => {
        // If this is already an S3 URL, just return it
        if (typeof url === 'string' && !url.startsWith('data:')) {
          return url;
        }
        // Otherwise, we're going to ignore base64 data in s3ImageGroups
        // The actual upload will happen in FormSection component
        return null;
      }).filter(url => url !== null);
    });
    
    // Update the S3 image groups state
    setS3ImageGroups(s3UrlGroups);
  };

  const handleGenerateListing = async () => {
  // 1. Gather all non-empty groups
  const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

  // Skip processing if there are no groups to process
  if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
    console.log("No images to process");
    return;
  }

  // 2. If there are leftover pool images, batch them too
  console.log(`filesBase64.length ${filesBase64.length}`);
  let allGroupsToProcess = [...nonEmptyGroups];
  let newGroups = [];
  
  // Important: Check if we have s3ImageGroups that actually contain S3 URLs
  const s3GroupsForDownload = s3ImageGroups.filter(group => 
    group.length > 0 && group.some(url => url && !url.startsWith('data:'))
  );
  
  if (filesBase64.length > 0 && batchSize > 0) {
    // Create new groups from the pool images
    const poolGroups = [];
    for (let i = 0; i < filesBase64.length; i += batchSize) {
      poolGroups.push(filesBase64.slice(i, i + batchSize));
    }
    
    // Add pool groups to processing list
    allGroupsToProcess = [...nonEmptyGroups, ...poolGroups];
    
    // Update imageGroups to include these new groups from the pool
    // BUT don't include the existing nonEmptyGroups again (this was causing duplication)
    setImageGroups(prev => {
      // Start with a fresh array, only keeping the empty group at the end if it exists
      const lastEmptyGroup = prev[prev.length - 1]?.length === 0 ? [prev[prev.length - 1]] : [[]];
      return [...nonEmptyGroups, ...poolGroups, ...lastEmptyGroup];
    });
    
    // Store these groups for the download function to use later
    newGroups = [...nonEmptyGroups, ...poolGroups];
  } else {
    newGroups = [...nonEmptyGroups];
  }

  // 3. Initialize UI state
  setTotalChunks(allGroupsToProcess.length);
  setCompletedChunks(0);
  setResponseData(Array(allGroupsToProcess.length).fill(null));
  setIsDirty(false);
  setIsLoading(true);
  setProcessingGroups(Array(allGroupsToProcess.length).fill(true));

  // 4. Prepare selected category options JSON
  const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku);
  console.log("Selected category options:", selectedCategoryOptions);

  // 5. Fire off each fetch separately and update state upon completion
  allGroupsToProcess.forEach((group, idx) => {
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
            console.log(`Completed ${done} of ${allGroupsToProcess.length} chunks`);
            if (done === allGroupsToProcess.length) {
              setIsLoading(false);
            }
            return done;
          });
        }, 0);
      });
  });
  
  return Promise.resolve(); // Make sure this returns a Promise
};

  const handleClearAll = () => {
    setFilesBase64([]);
    setCategory(undefined);
    setsubCategory(undefined);
    setErrorMessages([]);
    setBatchSize(0);
    setSelectedImages([]);
    setImageGroups([[]]);
    setS3ImageGroups([[]]);  // Clear the S3 URLs too
    setResponseData([]);
    setIsLoading(false);
    setIsDirty(true);
    setProcessingGroups([]);
  };

const downloadListingsAsZip = () => {
  console.log("Starting downloadListingsAsZip function");
  console.log("Initial responseData:", responseData);
  
  // Filter out empty or null responses
  const validResponses = responseData.filter(response =>
    response && !response.error
  );
  
  console.log("Filtered validResponses:", validResponses);
  console.log(`Found ${validResponses.length} valid listings to process`);
  
  if (validResponses.length === 0) {
    console.warn("No valid listings found, showing alert and stopping execution");
    alert("No valid listings to download!");
    return;
  }
  
  console.log("Creating new JSZip instance");
  const zip = new JSZip();
  
  // Debug logs to help understand what data we're working with
  console.log("Valid responses:", validResponses.length);
  console.log("s3ImageGroups data structure:", s3ImageGroups);
  console.log("imageGroups data structure:", imageGroups);
  
  // Log global variables being used
  console.log(`Using categoryID: ${categoryID}`);
  console.log(`Using SKU: ${sku}`);
  console.log(`Using price: ${price}`);
  
  console.log("Beginning to process each listing");
  validResponses.forEach((listing, index) => {
    console.log(`---------- Processing listing ${index + 1} ----------`);
    console.log(`Raw listing data for index ${index}:`, listing);
    
    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    console.log(`Formatted title: "${title}"`);
    
    // Use S3 URLs for the CSV when available
    let photoUrls = [];
    
    console.log(`Attempting to find images for listing ${index}`);
    
    // First check if we have S3 URLs available for this group
    if (s3ImageGroups && Array.isArray(s3ImageGroups) && index < s3ImageGroups.length) {
      console.log(`s3ImageGroups[${index}] exists:`, s3ImageGroups[index]);
      
      if (Array.isArray(s3ImageGroups[index])) {
        const s3Urls = s3ImageGroups[index].filter(url => url && typeof url === 'string' && !url.startsWith('data:'));
        photoUrls = s3Urls;
        
        console.log(`Found ${s3Urls.length} valid S3 URLs for index ${index}`);
        console.log(`S3 URLs for listing ${index}:`, s3Urls);
        
        // If we found base64 images in s3ImageGroups (which shouldn't happen), log a warning
        const base64ImagesCount = s3ImageGroups[index].filter(url => url && url.startsWith('data:')).length;
        if (base64ImagesCount > 0) {
          console.warn(`Warning: Found ${base64ImagesCount} base64 images in s3ImageGroups for listing ${index}. These won't be included in the CSV.`);
        }
      } else {
        console.warn(`s3ImageGroups[${index}] is not an array:`, s3ImageGroups[index]);
      }
    } else {
      console.log(`No s3ImageGroups available for index ${index}`);
    }
    
    // If we didn't get valid URLs from s3ImageGroups, check imageGroups as a fallback
    if (photoUrls.length === 0) {
      console.log(`No S3 URLs found, attempting to use imageGroups for listing ${index}`);
      
      if (imageGroups && Array.isArray(imageGroups) && index < imageGroups.length) {
        console.log(`imageGroups[${index}] exists:`, imageGroups[index]);
        
        if (Array.isArray(imageGroups[index])) {
          // Only use URLs that are not base64 data
          const standardUrls = imageGroups[index].filter(url => url && typeof url === 'string' && !url.startsWith('data:'));
          photoUrls = standardUrls;
          
          console.log(`Found ${standardUrls.length} valid standard URLs for index ${index}`);
          
          if (standardUrls.length > 0) {
            console.log(`Using imageGroups URLs for index ${index}:`, standardUrls);
          } else {
            const base64ImagesCount = imageGroups[index].filter(url => url && url.startsWith('data:')).length;
            if (base64ImagesCount > 0) {
              console.warn(`Warning: Only found ${base64ImagesCount} base64 images for listing ${index}. These won't work in eBay listings.`);
            } else {
              console.warn(`No valid images found for listing ${index} in either s3ImageGroups or imageGroups`);
            }
          }
        } else {
          console.warn(`imageGroups[${index}] is not an array:`, imageGroups[index]);
        }
      } else {
        console.log(`No imageGroups available for index ${index}`);
      }
    }
    
    // Log summary of image findings
    console.log(`Final photoUrls count for listing ${index}: ${photoUrls.length}`);
    if (photoUrls.length === 0) {
      console.warn(`Warning: No valid image URLs found for listing ${index}. CSV will have empty photo URLs.`);
    }
    
    // Filter out any empty strings or undefined values and join with the delimiter
    const formattedUrls = photoUrls.filter(url => url).join('||');
    console.log(`Formatted image URLs string length: ${formattedUrls.length} characters`);
    
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    console.log(`Formatted description (first 50 chars): "${description.substring(0, 50)}${description.length > 50 ? '...' : ''}"`);
    
    const header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format
`;
    const line = `Draft,${sku},${categoryID},${title},,${price},1,${formattedUrls},3000,"${description}",FixedPrice`;
    console.log(`CSV line generated (first 100 chars): "${line.substring(0, 100)}${line.length > 100 ? '...' : ''}"`);
    
    const fileName = `listing_${index + 1}${title ? '_' + title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 30) : ''}.csv`;
    console.log(`Creating file in zip: ${fileName}`);
    
    zip.file(fileName, `${header}${line}`);
  });
  
  console.log("All listings processed, generating zip file");
  
  // Generate the zip file and trigger download
  zip.generateAsync({ type: "blob" })
    .then(content => {
      console.log(`Zip file created successfully. Size: ${Math.round(content.size / 1024)} KB`);
      const zipFileName = `listings_${new Date().toISOString().split('T')[0]}.zip`;
      console.log(`Triggering download with filename: ${zipFileName}`);
      saveAs(content, zipFileName);
      console.log("Download initiated");
    })
    .catch(err => {
      console.error("Error creating zip file:", err);
      console.error("Stack trace:", err.stack);
      alert("Failed to create download. Please try again.");
    })
    .finally(() => {
      console.log("downloadListingsAsZip function completed");
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