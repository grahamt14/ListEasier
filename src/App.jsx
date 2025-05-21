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
    processedGroupIndices,
    isLoading,
    completedChunks,
    totalChunks,
    categoryID,
    price,
    sku,
    processingStatus,
    groupMetadata
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
    // Debug output to help diagnose data structure issues
    console.log("Generating CSV with data:", {
      responseData: responseData,
      imageGroups: imageGroups,
      s3ImageGroups: s3ImageGroups,
      groupMetadata: groupMetadata
    });
    
    // Validate that we have processed data
    if (!responseData || responseData.length === 0) {
      console.error("Missing response data");
      alert("Error: No listing data available. Please generate listings first.");
      return null;
    }
    
    // Find valid listings - groups that have been successfully processed
    const validIndices = responseData
      .map((response, index) => ({ response, index }))
      .filter(item => 
        item.response && 
        !item.response.error && 
        imageGroups[item.index] && 
        imageGroups[item.index].length > 0
      );
    
    if (validIndices.length === 0) {
      alert("No valid listings to download!");
      return null;
    }
    
    const header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format
`;

    let csvContent = header;
    let missingImageGroups = [];

    // Process each valid listing with the correct images
    validIndices.forEach(({ response, index }) => {
      const title = response.title ? response.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      const description = response.description ? response.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      
      // Get the S3 image URLs that correspond to this group
      let photoUrls = [];
      
      // Check if we have valid S3 image URLs for this group
      if (s3ImageGroups && 
          s3ImageGroups[index] && 
          Array.isArray(s3ImageGroups[index]) && 
          s3ImageGroups[index].length > 0) {
        
        // Filter to keep only valid URLs
        photoUrls = s3ImageGroups[index].filter(url => 
          url && 
          typeof url === 'string' && 
          (url.includes('amazonaws.com') || url.startsWith('http'))
        );
        
        console.log(`Found ${photoUrls.length} photo URLs for listing ${index}`);
      } else {
        console.warn(`No S3 image group found for listing ${index}, using placeholders`);
      }
      
      // If no valid URLs, use placeholders
      if (photoUrls.length === 0) {
        console.warn(`No valid photo URLs for listing ${index}, using placeholder`);
        missingImageGroups.push(index);
        
        // Create placeholder URLs for each image in the group
        photoUrls = Array.from(
          { length: imageGroups[index].length }, 
          (_, i) => `https://via.placeholder.com/800x600?text=Image+Not+Available+Group+${index+1}+Image+${i+1}`
        );
      }
      
      const formattedUrls = photoUrls.filter(url => url).join('||');
      
      // Get metadata for this group, or fall back to global price/sku
      const metadata = groupMetadata && groupMetadata[index] 
        ? groupMetadata[index] 
        : { price: price, sku: sku };
      
      const groupPrice = metadata.price || price || '9.99';
      const groupSku = metadata.sku || sku || `SKU-${index+1}`;
      
      const line = `Draft,${groupSku},${categoryID},"${title}",,${groupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
      
      csvContent += `${line}\n`;
    });
    
    // Show a single alert for all missing images
    if (missingImageGroups.length > 0) {
      const groupNumbers = missingImageGroups.map(idx => idx + 1).join(", ");
      alert(`Warning: ${missingImageGroups.length} listings are missing valid image URLs (groups: ${groupNumbers}). The CSV may not work correctly on eBay.`);
    }
    
    return csvContent;
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

  const downloadSingleListing = (groupIndex, groupPrice, groupSku) => {
    const listing = responseData[groupIndex];
    if (!listing || listing.error) {
      alert("No valid listing to download!");
      return;
    }
    
    // Get the correct S3 image URLs for this specific group
    let photoUrls = [];
    
    // Check if we have valid S3 image URLs for this group
    if (s3ImageGroups && 
        s3ImageGroups[groupIndex] && 
        Array.isArray(s3ImageGroups[groupIndex]) && 
        s3ImageGroups[groupIndex].length > 0) {
      
      photoUrls = s3ImageGroups[groupIndex].filter(url => 
        url && 
        typeof url === 'string' && 
        (url.includes('amazonaws.com') || url.startsWith('http'))
      );
      
      console.log(`Found ${photoUrls.length} photo URLs for single listing ${groupIndex}:`, photoUrls);
    } else {
      console.warn(`No S3 image group found for listing ${groupIndex}, using placeholders`);
    }
    
    // If no valid URLs found, use placeholders for each image in the group
    if (photoUrls.length === 0) {
      console.warn(`No valid photo URLs for listing ${groupIndex}, using placeholders`);
      alert(`Warning: Listing in Group ${groupIndex+1} has no valid image URLs. The CSV may not work correctly on eBay.`);
      
      // Create placeholder URLs for each image in the group
      photoUrls = Array.from(
        { length: imageGroups[groupIndex].length }, 
        (_, i) => `https://via.placeholder.com/800x600?text=Image+Not+Available+Group+${groupIndex+1}+Image+${i+1}`
      );
    }
    
    const header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format
`;

    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    const formattedUrls = photoUrls.filter(url => url).join('||');
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
    // Ensure we have valid price and SKU values
    const finalGroupPrice = groupPrice || price || '9.99';
    const finalGroupSku = groupSku || sku || `SKU-${groupIndex+1}`;
    
    const line = `Draft,${finalGroupSku},${categoryID},"${title}",,${finalGroupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
    
    const csvContent = header + line + '\n';
    
    // Create and download the CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvFileName = `listing_group_${groupIndex+1}_${new Date().toISOString().split('T')[0]}.csv`;
    
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
        {imageGroups.map((group, gi) => {
          // Skip empty groups
          if (group.length === 0) return null;
          
          // Determine the class based on processing state
          let groupClass = "";
          if (processingGroups[gi]) {
            groupClass = "processing";
          } else if (processedGroupIndices && processedGroupIndices.includes(gi)) {
            groupClass = "processed";
          } else if (group.length > 0 && !responseData[gi]) {
            groupClass = "new";
          }
          
          // Get group metadata
          const metadata = groupMetadata && groupMetadata[gi] 
            ? groupMetadata[gi] 
            : { price: price, sku: sku };
          
          // Group-specific price and SKU or fall back to global settings
          const groupPrice = metadata.price || price;
          const groupSku = metadata.sku || sku;
          
          return (
            <div
              key={gi}
              className={`group-card ${groupClass}`}
              onDrop={e => handleGroupDrop(e, gi)}
              onDragOver={e => e.preventDefault()}
            >
              {/* Add group metadata info */}
              <div className="group-metadata">
                <span className="group-number">Group {gi + 1}</span>
                <div className="metadata-details">
                  <span className="metadata-item">Price: ${groupPrice}</span>
                  <span className="metadata-item">SKU: {groupSku}</span>
                </div>
              </div>
              
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
                    {responseData[gi] && !responseData[gi].error && (
                      <button 
                        className="download-single-button"
                        onClick={() => downloadSingleListing(gi, groupPrice, groupSku)}
                      >
                        Download This Listing
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
  const { imageGroups, filesBase64, batchSize, processedGroupIndices } = state;
  const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

  if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
    return;
  }

  // Only process groups that haven't been processed yet
  const newGroupsToProcess = nonEmptyGroups.filter((group, idx) => {
    const originalIndex = imageGroups.findIndex(g => g === group);
    return !processedGroupIndices || !processedGroupIndices.includes(originalIndex);
  });
  
  // Get indices of new groups to be processed
  const newGroupIndices = newGroupsToProcess.map(group => {
    return imageGroups.findIndex(g => g === group);
  });
  
  let allGroupsToProcess = [...newGroupsToProcess];
  let newGroups = [];
  
  // Get S3 groups for download
  const s3GroupsForDownload = state.s3ImageGroups.filter(group => 
    group.length > 0 && group.some(url => url && !url.startsWith('data:'))
  );
  
  // If there are unprocessed images in the pool, use them based on batchSize
  let newPoolGroupIndices = [];
  if (filesBase64.length > 0 && batchSize > 0) {
    const poolGroups = [];
    for (let i = 0; i < filesBase64.length; i += batchSize) {
      poolGroups.push(filesBase64.slice(i, i + batchSize));
    }
    
    allGroupsToProcess = [...newGroupsToProcess, ...poolGroups];
    
    // Update image groups in state
    let updatedGroups = [...imageGroups];
    
    // Calculate the indices for the new pool groups
    const firstEmptyGroupIndex = updatedGroups.findIndex(g => g.length === 0);
    let insertIndex = firstEmptyGroupIndex !== -1 ? firstEmptyGroupIndex : updatedGroups.length;
    
    // Add the pool groups to the image groups and track their metadata
    const updatedMetadata = [...state.groupMetadata || []];
    
    poolGroups.forEach(group => {
      updatedGroups.splice(insertIndex, 0, group);
      newPoolGroupIndices.push(insertIndex);
      
      // Add metadata for the new group using current price and SKU
      while (updatedMetadata.length <= insertIndex) {
        updatedMetadata.push(null);
      }
      updatedMetadata[insertIndex] = { price: state.price, sku: state.sku };
      
      insertIndex++;
    });
    
    // Update the metadata in state
    dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
    
    // Ensure there's an empty group at the end
    if (updatedGroups[updatedGroups.length - 1]?.length !== 0) {
      updatedGroups.push([]);
    }
    
    dispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
    
    newGroups = [...newGroupsToProcess, ...poolGroups];
  } else {
    newGroups = [...newGroupsToProcess];
  }

  // If no new groups to process, inform user and return
  if (allGroupsToProcess.length === 0) {
    alert("No new images to process. All existing groups have already been generated.");
    return;
  }

  // Update state for processing - Only count the new groups
  dispatch({ type: 'SET_PROCESSING_STATUS', payload: { 
    isProcessing: true,
    processTotal: allGroupsToProcess.length,
    processCompleted: 0
  }});
  
  // Legacy state updates
  dispatch({ type: 'SET_TOTAL_CHUNKS', payload: allGroupsToProcess.length });
  dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: 0 });
  
  // Only initialize response data for new groups, keep existing responses
  const updatedResponseData = [...state.responseData];
  const updatedProcessingGroups = [...state.processingGroups];
  
  // Set initial state for new groups
  [...newGroupIndices, ...newPoolGroupIndices].forEach(index => {
    // Extend arrays if needed
    while (updatedResponseData.length <= index) {
      updatedResponseData.push(null);
    }
    
    while (updatedProcessingGroups.length <= index) {
      updatedProcessingGroups.push(false);
    }
    
    // Set initial values for new groups
    updatedResponseData[index] = null;
    updatedProcessingGroups[index] = true;
  });
  
  dispatch({ type: 'SET_RESPONSE_DATA', payload: updatedResponseData });
  dispatch({ type: 'SET_IS_DIRTY', payload: false });
  dispatch({ type: 'SET_PROCESSING_GROUPS', payload: updatedProcessingGroups });

  const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku);

  // Track indices of groups being processed
  const processedIndices = [];
  
  // Track completed count for progress updates
  let completedCount = 0;
  
  // Process each group with the API using sequential processing for better tracking
  for (let arrayIndex = 0; arrayIndex < allGroupsToProcess.length; arrayIndex++) {
    const group = allGroupsToProcess[arrayIndex];
    
    // Get the actual index in the imageGroups array
    let actualIndex;
    if (arrayIndex < newGroupIndices.length) {
      // This is a group from imageGroups
      actualIndex = newGroupIndices[arrayIndex];
    } else {
      // This is a pool group
      const poolArrayIndex = arrayIndex - newGroupIndices.length;
      actualIndex = newPoolGroupIndices[poolArrayIndex];
    }
    
    processedIndices.push(actualIndex);
    
    try {
      const response = await fetch(
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
      );
      
      const data = await response.json();
      let parsed = data.body;
      if (typeof parsed === "string") parsed = JSON.parse(parsed);

      // Update response data at the correct index
      dispatch({
        type: 'UPDATE_RESPONSE_DATA',
        payload: {
          index: actualIndex,
          value: Array.isArray(parsed) ? parsed[0] : parsed
        }
      });
    } catch (err) {
      // Handle error
      dispatch({
        type: 'UPDATE_RESPONSE_DATA',
        payload: {
          index: actualIndex,
          value: { error: "Failed to fetch listing data", raw_content: err.message }
        }
      });
    } finally {
      // Update processing group status
      dispatch({
        type: 'UPDATE_PROCESSING_GROUP',
        payload: {
          index: actualIndex,
          value: false
        }
      });
      
      // Increment completion count
      completedCount++;
      
      // Update progress for each individual group completion
      dispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: { 
          processCompleted: completedCount
        } 
      });
      
      dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: completedCount });
    }
  }
  
  // Mark processed groups as completed
  dispatch({ type: 'MARK_GROUPS_AS_PROCESSED', payload: processedIndices });
  
  // Clear the image pool
  if (filesBase64.length > 0) {
    dispatch({ type: 'SET_FILES_BASE64', payload: [] });
  }
  
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