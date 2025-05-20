import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AppStateProvider, useAppState } from './StateContext';

// PreviewSection component
function PreviewSection() {
  const { state, dispatch } = useAppState();
  const { 
    imageGroups, 
    s3ImageGroups,
    responseData, 
    processingGroups, 
    isLoading,
    completedChunks,
    totalChunks,
    categoryID,
    price,
    sku,
    processingStatus
  } = state;
  
  // Use new processing status for consistent display
  const { isProcessing, processTotal, processCompleted } = processingStatus || { isProcessing: false, processTotal: 0, processCompleted: 0 };
  const displayIsLoading = isLoading || isProcessing;
  const displayTotalChunks = processTotal || totalChunks;
  const displayCompletedChunks = processCompleted || completedChunks;
  const processProgress = displayTotalChunks > 0 ? Math.round((displayCompletedChunks / displayTotalChunks) * 100) : 0;

  // Handle hover for drop target
  const [hoveredGroup, setHoveredGroup] = useState(null);

  // AWS Configuration
  const REGION = "us-east-2";
  const BUCKET_NAME = "listeasier";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  // Handle group drop
  const handleGroupDrop = (e, groupIdx, imgIdx = null) => {
    e.preventDefault();
    const from = e.dataTransfer.getData("from");
    const index = e.dataTransfer.getData("index");
    setHoveredGroup(null);

    dispatch({
      type: 'HANDLE_GROUP_DROP',
      payload: {
        dropGroupIdx: groupIdx,
        imgIdx,
        from,
        fromIndex: index
      }
    });
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

  // Check if there are valid listings to download
  const hasValidListings = responseData.some(item => item && !item.error);

  return (
    <section className="preview-section">
      <div className="section-header">
        <h2>Image Groups & Listings</h2>
        {hasValidListings && (
          <button 
            className="download-button"
            onClick={downloadListingsAsCsv}
            disabled={displayIsLoading}
          >
            Download All Listings
          </button>
        )}
      </div>
      
      {displayIsLoading && (
        <div className="loading-progress">
          <div className="loading-bar-container">
            <div className="loading-bar" style={{ width: `${processProgress}%` }}></div>
          </div>
          <p>Processing {displayCompletedChunks} of {displayTotalChunks} listings... ({processProgress}%)</p>
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
  );
}

// Main App Component
function AppContent() {
  const { state, dispatch } = useAppState();
  const { category, subCategory, fieldSelections, price, sku } = state;

  // AWS Configuration
  const REGION = "us-east-2";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const client = new DynamoDBClient({
    region: REGION,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId: IDENTITY_POOL_ID,
    }),
  });

 const handleGenerateListing = async () => {
  const { imageGroups, filesBase64, batchSize } = state;
  const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

  if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
    return;
  }

  let allGroupsToProcess = [...nonEmptyGroups];
  let newGroups = [];
  
  // Get S3 groups for download
  const s3GroupsForDownload = state.s3ImageGroups.filter(group => 
    group.length > 0 && group.some(url => url && !url.startsWith('data:'))
  );
  
  // If there are unprocessed images in the pool, use them based on batchSize
  if (filesBase64.length > 0 && batchSize > 0) {
    const poolGroups = [];
    for (let i = 0; i < filesBase64.length; i += batchSize) {
      poolGroups.push(filesBase64.slice(i, i + batchSize));
    }
    
    allGroupsToProcess = [...nonEmptyGroups, ...poolGroups];
    
    // Update image groups in state
    let updatedGroups = [...nonEmptyGroups, ...poolGroups];
    if (updatedGroups[updatedGroups.length - 1]?.length !== 0) {
      updatedGroups.push([]);
    }
    
    dispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
    
    newGroups = [...nonEmptyGroups, ...poolGroups];
  } else {
    newGroups = [...nonEmptyGroups];
  }

  // Update both new and legacy processing states
  dispatch({ 
    type: 'SET_PROCESSING_STATUS', 
    payload: { 
      isProcessing: true,
      processTotal: allGroupsToProcess.length,
      processCompleted: 0
    } 
  });
  
  // Also update legacy state for backward compatibility
  dispatch({ type: 'SET_TOTAL_CHUNKS', payload: allGroupsToProcess.length });
  dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: 0 });
  dispatch({ type: 'SET_RESPONSE_DATA', payload: Array(allGroupsToProcess.length).fill(null) });
  dispatch({ type: 'SET_IS_DIRTY', payload: false });
  dispatch({ type: 'SET_IS_LOADING', payload: true });
  dispatch({ type: 'SET_PROCESSING_GROUPS', payload: Array(allGroupsToProcess.length).fill(true) });

  const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku);

  // Process each group with the API using promises for better tracking
  const processingPromises = allGroupsToProcess.map((group, idx) => {
    return new Promise((resolve) => {
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

          // Update response data
          dispatch({
            type: 'UPDATE_RESPONSE_DATA',
            payload: {
              index: idx,
              value: Array.isArray(parsed) ? parsed[0] : parsed
            }
          });

          // Update processing group
          dispatch({
            type: 'UPDATE_PROCESSING_GROUP',
            payload: {
              index: idx,
              value: false
            }
          });
        })
        .catch(err => {
          // Handle error
          dispatch({
            type: 'UPDATE_RESPONSE_DATA',
            payload: {
              index: idx,
              value: { error: "Failed to fetch listing data", raw_content: err.message }
            }
          });

          dispatch({
            type: 'UPDATE_PROCESSING_GROUP',
            payload: {
              index: idx,
              value: false
            }
          });
        })
        .finally(() => {
          // Increment both new and legacy progress counters
          dispatch({ 
            type: 'SET_PROCESSING_STATUS', 
            payload: { 
              processCompleted: state.processingStatus.processCompleted + 1
            } 
          });
          
          dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: state.completedChunks + 1 });
          
          resolve();
        });
    });
  });
  
  // Wait for all processing to complete
  await Promise.all(processingPromises);
  
  // Reset status indicators
  dispatch({ type: 'RESET_STATUS' });
  dispatch({ type: 'SET_IS_LOADING', payload: false });
};

  return (
    <div className="app-container">
      <header className="header">
        <img src="/images/ListEasier.jpg" alt="ListEasier" className="logo" />
        <h1>ListEasier</h1>
      </header>

      <main className="main-card">
        <FormSection onGenerateListing={handleGenerateListing} />
        <PreviewSection />
      </main>

      <footer className="footer">
        <p>© 2025 ListEasier</p>
      </footer>
    </div>
  );
}

// Main App with Provider
function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}

export default App;