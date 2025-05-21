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
  
  // Log s3ImageGroups changes for debugging
  useEffect(() => {
    console.log('[PREVIEW S3 DEBUG] s3ImageGroups in PreviewSection updated:', 
      s3ImageGroups ? {
        length: s3ImageGroups.length,
        groups: s3ImageGroups.map(group => group ? 
          {
            length: group.length,
            firstFewUrls: group.slice(0, 2).map(url => typeof url === 'string' ? url.substring(0, 50) + '...' : 'non-string')
          } : 'null/undefined'
        )
      } : 'null/undefined'
    );
  }, [s3ImageGroups]);
  
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
  // Log all available data for debugging
  console.log("[CSV DEBUG] Generating CSV with:", {
    responseData: responseData.length,
    imageGroups: imageGroups.length,
    s3ImageGroups: s3ImageGroups ? s3ImageGroups.length : 'null/undefined'
  });
  
  // Validate that we have s3ImageGroups data
  if (!s3ImageGroups || !Array.isArray(s3ImageGroups) || s3ImageGroups.length === 0) {
    console.error("[CSV DEBUG] Missing s3ImageGroups data");
    alert("Error: Missing S3 image data. Please reload the page and try again.");
    return null;
  }
  
  // Log s3ImageGroups details
  console.log("[CSV DEBUG] S3 image groups details:", s3ImageGroups.map((group, idx) => ({
    groupIndex: idx,
    length: group ? group.length : 0,
    isEmpty: !group || group.length === 0,
    validUrls: group ? group.filter(url => url && typeof url === 'string' && 
      (url.includes('amazonaws.com') || url.startsWith('http'))).length : 0,
    firstUrl: group && group.length > 0 ? 
      (typeof group[0] === 'string' ? group[0].substring(0, 50) + '...' : 'non-string') : 'none'
  })));
  
  const validResponseIndices = responseData
    .map((response, index) => ({ response, index }))
    .filter(item => 
      item.response && 
      !item.response.error && 
      imageGroups[item.index] && 
      imageGroups[item.index].length > 0
    );
  
  console.log("[CSV DEBUG] Valid response indices:", validResponseIndices.map(i => i.index));
  
  if (validResponseIndices.length === 0) {
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

  validResponseIndices.forEach(({ response, index }) => {
    const title = response.title ? response.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
    // Simplified photo URL handling - just use the S3ImageGroups directly without any complex mapping
    // This should work because we now ensure S3ImageGroups matches imageGroups exactly
    let photoUrls = [];
    
    // Log what we're using for this listing
    console.log(`[CSV DEBUG] Processing listing ${index}:`, {
      hasS3Group: s3ImageGroups && index < s3ImageGroups.length,
      s3GroupLength: s3ImageGroups && index < s3ImageGroups.length ? s3ImageGroups[index]?.length : 'N/A',
      imageGroupLength: imageGroups && index < imageGroups.length ? imageGroups[index]?.length : 'N/A'
    });
    
    // Get S3 URLs directly from the corresponding S3ImageGroup
    if (s3ImageGroups && 
        Array.isArray(s3ImageGroups) && 
        index < s3ImageGroups.length && 
        Array.isArray(s3ImageGroups[index]) && 
        s3ImageGroups[index].length > 0) {
      
      // Filter to keep only valid URLs
      photoUrls = s3ImageGroups[index].filter(url => 
        url && 
        typeof url === 'string' && 
        (url.includes('amazonaws.com') || url.startsWith('http'))
      );
      
      console.log(`[CSV DEBUG] Found ${photoUrls.length} photo URLs for listing ${index}`);
      if (photoUrls.length > 0) {
        console.log(`[CSV DEBUG] First URL: ${photoUrls[0].substring(0, 50)}...`);
      }
    } else {
      console.warn(`[CSV DEBUG] No S3 image group found for listing ${index}`);
    }
    
    // If no valid URLs, use a placeholder
    if (photoUrls.length === 0) {
      console.warn(`[CSV DEBUG] No valid photo URLs for listing ${index}, using placeholder`);
      missingImageGroups.push(index);
      photoUrls = ['https://via.placeholder.com/800x600?text=Image+Not+Available'];
    }
    
    const formattedUrls = photoUrls.filter(url => url).join('||');
    const description = response.description ? response.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
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
    console.log("[CSV DEBUG] Starting CSV download process");
    const csvContent = generateCSVContent();
    if (!csvContent) {
      console.log("[CSV DEBUG] CSV generation failed, aborting download");
      return;
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvFileName = `listings_${new Date().toISOString().split('T')[0]}.csv`;
    
    console.log("[CSV DEBUG] Saving CSV file:", csvFileName);
    
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
    console.log("[CSV DEBUG] CSV download complete");
  };

 const downloadSingleListing = (groupIndex, groupPrice, groupSku) => {
  console.log(`[CSV DEBUG] Starting single listing download for group ${groupIndex}`);
  
  const listing = responseData[groupIndex];
  if (!listing || listing.error) {
    console.log(`[CSV DEBUG] No valid listing to download for group ${groupIndex}`);
    alert("No valid listing to download!");
    return;
  }
  
  // Simplified photo URL handling - use S3ImageGroups directly
  let photoUrls = [];
  
  // Look directly in the matching S3ImageGroup for this listing
  if (s3ImageGroups && 
      Array.isArray(s3ImageGroups) && 
      groupIndex < s3ImageGroups.length && 
      Array.isArray(s3ImageGroups[groupIndex])) {
    
    photoUrls = s3ImageGroups[groupIndex].filter(url => 
      url && 
      typeof url === 'string' && 
      (url.includes('amazonaws.com') || url.startsWith('http'))
    );
    
    console.log(`[CSV DEBUG] Found ${photoUrls.length} photo URLs for single listing ${groupIndex}`);
    if (photoUrls.length > 0) {
      console.log(`[CSV DEBUG] First URL: ${photoUrls[0].substring(0, 50)}...`);
    }
  }
  
  // If no valid URLs found, use a placeholder
  if (photoUrls.length === 0) {
    console.warn(`[CSV DEBUG] No valid photo URLs for single listing ${groupIndex}, using placeholder`);
    alert(`Warning: Listing in Group ${groupIndex+1} has no valid image URLs. The CSV may not work correctly on eBay.`);
    photoUrls = ['https://via.placeholder.com/800x600?text=Image+Not+Available'];
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
  
  console.log(`[CSV DEBUG] Saving single listing CSV: ${csvFileName}`);
  
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
  
  console.log(`[CSV DEBUG] Single listing download complete for group ${groupIndex}`);
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
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Debug info toggle button */}
          <button
            onClick={() => document.getElementById('s3-debug-panel').style.display = 
              document.getElementById('s3-debug-panel').style.display === 'none' ? 'block' : 'none'}
            style={{ 
              background: '#333', 
              color: '#fff', 
              padding: '5px 10px', 
              fontSize: '12px', 
              borderRadius: '4px'
            }}
          >
            Toggle Debug
          </button>
          
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
      </div>
      
      {/* Debug panel (hidden by default) */}
      <div id="s3-debug-panel" style={{ 
        display: 'none', 
        fontSize: '11px', 
        backgroundColor: '#f8f8f8', 
        padding: '8px', 
        marginBottom: '15px', 
        border: '1px solid #ddd',
        borderRadius: '4px',
        maxHeight: '150px',
        overflow: 'auto'
      }}>
        <h4 style={{ margin: '0 0 5px 0', fontSize: '12px' }}>S3 Image Groups Debug Info</h4>
        <div>
          <p><strong>s3ImageGroups:</strong> {s3ImageGroups ? `${s3ImageGroups.length} groups` : 'null/undefined'}</p>
          {s3ImageGroups && s3ImageGroups.map((group, idx) => (
            <div key={idx} style={{ marginBottom: '4px', borderBottom: '1px dotted #ccc', paddingBottom: '4px' }}>
              <strong>Group {idx+1}:</strong> {group ? `${group.length} URLs` : 'null/undefined'}
              {group && group.length > 0 && (
                <div style={{ marginLeft: '10px', wordBreak: 'break-all' }}>
                  <span>First URL: </span>
                  {typeof group[0] === 'string' ? 
                    group[0].substring(0, 30) + '...' : 
                    'non-string value'}
                </div>
              )}
            </div>
          ))}
        </div>
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
  const { category, subCategory, fieldSelections, price, sku, s3ImageGroups } = state;

  // Add debug logging for s3ImageGroups
  useEffect(() => {
    console.log('[APP S3 DEBUG] s3ImageGroups in AppContent updated:', 
      s3ImageGroups ? {
        length: s3ImageGroups.length,
        groups: s3ImageGroups.map(group => group ? 
          {
            length: group.length,
            firstUrls: group.slice(0, 2).map(url => typeof url === 'string' ? url.substring(0, 50) + '...' : 'non-string')
          } : 'null/undefined'
        )
      } : 'null/undefined'
    );
  }, [s3ImageGroups]);

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
    console.log('[APP S3 DEBUG] Starting handleGenerateListing');
    console.log('[APP S3 DEBUG] Current s3ImageGroups:', s3ImageGroups);
    
    const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

    if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
      console.log('[APP S3 DEBUG] No groups or images to process, returning');
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
    console.log('[APP S3 DEBUG] Checking s3ImageGroups for download:', s3ImageGroups);
    const s3GroupsForDownload = s3ImageGroups && s3ImageGroups.length > 0 
      ? s3ImageGroups.filter(group => 
          group && group.length > 0 && group.some(url => url && !url.startsWith('data:'))
        ) 
      : [];
    console.log('[APP S3 DEBUG] S3 groups for download:', s3GroupsForDownload.length);
    
    // If there are unprocessed images in the pool, use them based on batchSize
    let newPoolGroupIndices = [];
    if (filesBase64.length > 0 && batchSize > 0) {
      console.log('[APP S3 DEBUG] Processing pool images with batch size:', batchSize);
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
      
      console.log('[APP S3 DEBUG] Updating image groups with pool groups');
      dispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
      
      newGroups = [...newGroupsToProcess, ...poolGroups];
    } else {
      newGroups = [...newGroupsToProcess];
    }

    // If no new groups to process, inform user and return
    if (allGroupsToProcess.length === 0) {
      console.log('[APP S3 DEBUG] No new groups to process, all existing groups have been generated');
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
    
    // Log S3ImageGroups before processing
    console.log('[APP S3 DEBUG] S3ImageGroups before processing API calls:', s3ImageGroups);
    
    // Process each group with the API using promises for better tracking
    const processingPromises = allGroupsToProcess.map((group, arrayIndex) => {
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
      
      // Log which group is being processed
      console.log(`[APP S3 DEBUG] Processing group ${actualIndex+1} (array index ${actualIndex})`);
      
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
          then(res => res.json())
          .then(data => {
            let parsed = data.body;
            if (typeof parsed === "string") parsed = JSON.parse(parsed);

            console.log(`[APP S3 DEBUG] Received API response for group ${actualIndex+1}`);
            
            // Update response data at the correct index
            dispatch({
              type: 'UPDATE_RESPONSE_DATA',
              payload: {
                index: actualIndex,
                value: Array.isArray(parsed) ? parsed[0] : parsed
              }
            });

            // Update processing group
            dispatch({
              type: 'UPDATE_PROCESSING_GROUP',
              payload: {
                index: actualIndex,
                value: false
              }
            });
          })
          .catch(err => {
            // Handle error
            console.error(`[APP S3 DEBUG] Error processing group ${actualIndex+1}:`, err);
            
            dispatch({
              type: 'UPDATE_RESPONSE_DATA',
              payload: {
                index: actualIndex,
                value: { error: "Failed to fetch listing data", raw_content: err.message }
              }
            });

            dispatch({
              type: 'UPDATE_PROCESSING_GROUP',
              payload: {
                index: actualIndex,
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