import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AppStateProvider, useAppState } from './StateContext';

// PreviewSection component
function PreviewSection({ categoryFields = [] }) {
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
    groupMetadata,
    fieldSelections  // Add this line to get fieldSelections from state
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

  // Add the updateListingFieldSelection function here
  const updateListingFieldSelection = (listingIndex, fieldLabel, newValue) => {
    // Get the current response data
    const updatedResponseData = [...responseData];
    
    // Make sure the listing exists
    if (!updatedResponseData[listingIndex]) {
      return;
    }
    
    // Update the stored field selections for this specific listing
    const currentListing = { ...updatedResponseData[listingIndex] };
    const currentStoredSelections = { ...currentListing.storedFieldSelections } || {};
    
    // Update the specific field
    currentStoredSelections[fieldLabel] = newValue;
    
    // Update the listing with the new field selections
    currentListing.storedFieldSelections = currentStoredSelections;
    updatedResponseData[listingIndex] = currentListing;
    
    // Update the state
    dispatch({
      type: 'SET_RESPONSE_DATA',
      payload: updatedResponseData
    });
  };

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
    
    // Gather all unique category field labels across all listings
    const allCategoryFieldLabels = new Set();
    validIndices.forEach(({ response }) => {
      if (response.storedFieldSelections) {
        Object.keys(response.storedFieldSelections).forEach(label => {
          // Include all field labels, regardless of their values
          if (label !== 'price' && label !== 'sku') {
            allCategoryFieldLabels.add(label);
          }
        });
      }
    });
    
    // Create header including standard fields and all category fields
    let header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format`;

    // Add category fields to header
    if (allCategoryFieldLabels.size > 0) {
      allCategoryFieldLabels.forEach(field => {
        header += `,${field}`;
      });
    }
    
    header += '\n';

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
      
      // Start with the standard fields
      let line = `Draft,${groupSku},${categoryID},"${title}",,${groupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
      
      // Add category fields to the line using the stored selections for this listing
      if (allCategoryFieldLabels.size > 0) {
        const listingFieldSelections = response.storedFieldSelections || {};
        
        allCategoryFieldLabels.forEach(field => {
          // Include all fields, even those with default values
          const fieldValue = listingFieldSelections[field] || "-- Select --";
          line += `,"${fieldValue.replace(/"/g, '""')}"`;
        });
      }
      
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
    
    // Get the stored field selections for this listing
    const listingFieldSelections = listing.storedFieldSelections || {};
    
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
    
    // Get all field labels from stored selections (including those with default values)
    const selectedFields = Object.keys(listingFieldSelections).filter(label => 
      label !== 'price' && label !== 'sku'
    );
    
    let header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format`;

    // Add category fields to header
    if (selectedFields.length > 0) {
      selectedFields.forEach(field => {
        header += `,${field}`;
      });
    }
    
    header += '\n';

    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    const formattedUrls = photoUrls.filter(url => url).join('||');
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
    // Ensure we have valid price and SKU values
    const finalGroupPrice = groupPrice || price || '9.99';
    const finalGroupSku = groupSku || sku || `SKU-${groupIndex+1}`;
    
    // Start with standard fields
    let line = `Draft,${finalGroupSku},${categoryID},"${title}",,${finalGroupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
    
    // Add category fields to the line (including those with default values)
    if (selectedFields.length > 0) {
      selectedFields.forEach(field => {
        const fieldValue = listingFieldSelections[field] || "-- Select --";
        line += `,"${fieldValue.replace(/"/g, '""')}"`;
      });
    }
    
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
  
  // Get group metadata for this listing
  const metadata = groupMetadata && groupMetadata[index] 
    ? groupMetadata[index] 
    : { price: price || '', sku: sku || '' };
  
  // Group-specific price and SKU or fall back to global settings
  const groupPrice = metadata.price || price || '';
  const groupSku = metadata.sku || sku || '';
  
  // Use stored field selections if available, otherwise fall back to current state
  const listingFieldSelections = response.storedFieldSelections || fieldSelections;
  
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
        {/* Display title and description first */}
        {response.title && (
          <div className="response-field primary-field">
            <strong style={{ color: '#000' }}>Title:</strong>
            <span style={{ color: '#000' }}>{response.title}</span>
          </div>
        )}
        {response.description && (
          <div className="response-field primary-field">
            <strong style={{ color: '#000' }}>Description:</strong>
            <span style={{ color: '#000' }}>{response.description}</span>
          </div>
        )}
        
        {/* Add other response fields excluding title, description and stored fields */}
        {Object.entries(response)
          .filter(([key]) => 
            key !== 'title' && 
            key !== 'description' && 
            key !== 'storedFieldSelections' && 
            !key.startsWith('error') && 
            !key.startsWith('raw_')
          )
          .map(([key, value]) => (
            <div key={key} className="response-field">
              <strong style={{ color: '#000' }}>
                {key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())}:
              </strong>
              <span style={{ color: '#000' }}>{value}</span>
            </div>
        ))}
        
        {/* Add category fields as editable metadata, including price and SKU */}
        <div className="category-fields-metadata">
          <h5 style={{ margin: '10px 0 5px 0', color: '#000' }}>Item Details</h5>
          
          {/* Add price and SKU with the category fields */}
          <div className="response-field listing-metadata">
            <strong style={{ color: '#000' }}>Price:</strong>
            <span style={{ color: '#000' }}>${groupPrice}</span>
          </div>
          <div className="response-field listing-metadata">
            <strong style={{ color: '#000' }}>SKU:</strong>
            <span style={{ color: '#000' }}>{groupSku}</span>
          </div>
          
          {/* Add ALL category fields from the stored selections as editable fields */}
          {Object.entries(listingFieldSelections).map(([label, value]) => {
            // Display ALL fields, including those with default values, but make them editable
            if (label !== 'price' && label !== 'sku') {
              // Get the original field definition to show options
              const fieldDefinition = categoryFields.find(field => field.FieldLabel === label);
              const options = fieldDefinition?.CategoryOptions ? 
                fieldDefinition.CategoryOptions.split(';').map(opt => opt.trim()) : [];
              
              // Display empty string instead of "-- Select --" for default values
              const displayValue = (value === "-- Select --" || !value) ? "" : value;
              
              return (
                <div key={label} className="response-field listing-metadata editable-field">
                  <strong style={{ color: '#000' }}>{label}:</strong>
                  {options.length > 0 ? (
                    // If we have options, show an editable dropdown using datalist
                    <div style={{ position: 'relative', marginLeft: '8px' }}>
                      <input
                        type="text"
                        value={displayValue}
                        onChange={(e) => updateListingFieldSelection(index, label, e.target.value)}
                        placeholder="Enter value or select from dropdown"
                        list={`${label}-${index}-options`}
                        style={{
                          padding: '4px 8px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          backgroundColor: '#fff',
                          color: '#000',
                          fontSize: '0.9rem',
                          minWidth: '200px'
                        }}
                      />
                      <datalist id={`${label}-${index}-options`}>
                        {options.map((opt, idx) => (
                          <option key={idx} value={opt}>{opt}</option>
                        ))}
                      </datalist>
                    </div>
                  ) : (
                    // If no options, show a regular text input
                    <input
                      type="text"
                      value={displayValue}
                      onChange={(e) => updateListingFieldSelection(index, label, e.target.value)}
                      placeholder="Enter value"
                      style={{
                        marginLeft: '8px',
                        padding: '4px 8px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        backgroundColor: '#fff',
                        color: '#000',
                        fontSize: '0.9rem',
                        minWidth: '150px'
                      }}
                    />
                  )}
                </div>
              );
            }
            
            return null;
          })}
        </div>
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
          {processingStatus.isProcessing ? (
            <p>Processing group {processingStatus.currentGroup || 0} of {displayTotalChunks}... ({processProgress}%)</p>
          ) : (
            <p>Processing {displayCompletedChunks} of {displayTotalChunks} listings... ({processProgress}%)</p>
          )}
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
              {/* Just add a simple group number indicator */}
              <div className="group-header">
                <span className="group-number">Group {gi + 1}</span>
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
  
  // Add state for categoryFields
  const [categoryFields, setCategoryFields] = useState([]);

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

  // Modified handleGenerateListing in App.jsx that doesn't depend on S3 URLs being set first
  const handleGenerateListing = async () => {
    try {
       const { imageGroups, filesBase64, batchSize, processedGroupIndices, fieldSelections } = state;
   
      const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

      if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
        return;
      }

      // First disable the button to prevent multiple clicks
      dispatch({ type: 'SET_IS_LOADING', payload: true });

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
      let newPoolGroupIndices = [];
      
      // If there are unprocessed images in the pool, use them based on batchSize
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
          
          // Add metadata for the new group using current price, SKU, and ALL field selections
          while (updatedMetadata.length <= insertIndex) {
            updatedMetadata.push(null);
          }
          updatedMetadata[insertIndex] = { 
            price: state.price, 
            sku: state.sku,
            // Store ALL field selections, including those with default values
            fieldSelections: { ...fieldSelections }
          };
          
          insertIndex++;
        });
        
        // Update the metadata in state
        dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
        
        // Ensure there's an empty group at the end
        if (updatedGroups[updatedGroups.length - 1]?.length !== 0) {
          updatedGroups.push([]);
        }
        
        dispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
      }

      // If no new groups to process, inform user and return
      if (allGroupsToProcess.length === 0) {
        alert("No new images to process. All existing groups have already been generated.");
        dispatch({ type: 'SET_IS_LOADING', payload: false });
        return;
      }

      // Get total number of groups to process
      const totalGroups = allGroupsToProcess.length;
      
      // Create a new object to track processing status to avoid state race conditions
      const processingStatus = {
        isProcessing: true,
        processTotal: totalGroups,
        processCompleted: 0
      };
      
      // Initialize processing status before starting any API calls
      dispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: processingStatus
      });
      
      // Legacy state updates
      dispatch({ type: 'SET_TOTAL_CHUNKS', payload: totalGroups });
      dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: 0 });
      
      // Only initialize response data for new groups, keep existing responses
      const updatedResponseData = [...state.responseData];
      const updatedProcessingGroups = [...state.processingGroups];
      
      // Initialize arrays for all the groups being processed
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

     // Prepare options for API call - include ALL field selections
     const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku);   
     // Save current field selections to use in listings (including all fields with default values)
     const currentFieldSelections = {...fieldSelections};

     // Track indices of groups being processed
     const processedIndices = [];
     
     // Increase batch size but with retry mechanism for failures
     const PROCESSING_BATCH_SIZE = 40; // Increased to 80 concurrent requests
     const MAX_RETRIES = 3; // Allow up to 3 retries for failed requests
     const RETRY_DELAY_MS = 2000; // Wait 1 second between retries
     
     // Function to process a single group with retries
     const processGroupWithRetry = async (group, actualIndex, retryCount = 0) => {
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
         
         if (!response.ok) {
           // If we get a 504 Gateway Timeout and have retries left, retry with backoff
           if (response.status === 504 && retryCount < MAX_RETRIES) {
             console.log(`Gateway timeout for group ${actualIndex}, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
             await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
             return processGroupWithRetry(group, actualIndex, retryCount + 1);
           }
           
           throw new Error(`API error: ${response.status} ${response.statusText}`);
         }
         
         const data = await response.json();
         let parsed = data.body;
         if (typeof parsed === "string") parsed = JSON.parse(parsed);
         
         return { 
           index: actualIndex, 
           result: Array.isArray(parsed) ? parsed[0] : parsed,
           success: true
         };
       } catch (err) {
         // If it's not a gateway timeout or we're out of retries, fail
         console.error(`Error processing group ${actualIndex}:`, err);
         return { 
           index: actualIndex, 
           error: true, 
           result: { 
             error: "Failed to fetch listing data", 
             raw_content: err.message 
           },
           success: false
         };
       }
     };
     
     // Split groups into more manageable chunks for parallel processing
     // Process in batches of PROCESSING_BATCH_SIZE
     const results = [];
     
     for (let batchStart = 0; batchStart < allGroupsToProcess.length; batchStart += PROCESSING_BATCH_SIZE) {
       const currentBatch = allGroupsToProcess.slice(batchStart, batchStart + PROCESSING_BATCH_SIZE);
       const batchIndices = [];
       
       // Map current batch items to their actual indices
       for (let i = 0; i < currentBatch.length; i++) {
         const batchItemIndex = batchStart + i;
         let actualIndex;
         
         if (batchItemIndex < newGroupIndices.length) {
           // This is a group from imageGroups
           actualIndex = newGroupIndices[batchItemIndex];
         } else {
           // This is a pool group
           const poolArrayIndex = batchItemIndex - newGroupIndices.length;
           actualIndex = newPoolGroupIndices[poolArrayIndex];
         }
         
         batchIndices.push(actualIndex);
         processedIndices.push(actualIndex);
       }
       
       // Update status to show which batch is being processed
       processingStatus.currentGroup = batchStart + 1; // Show the first group in the batch
       dispatch({ 
         type: 'SET_PROCESSING_STATUS', 
         payload: { ...processingStatus }
       });
       
       // Process batch in parallel with retries
       const batchPromises = currentBatch.map((group, idx) => 
         processGroupWithRetry(group, batchIndices[idx])
       );
       
       // Wait for all promises in this batch
       const batchResults = await Promise.all(batchPromises);
       results.push(...batchResults);
       
       // Update completed count
       const completedCount = Math.min(batchStart + PROCESSING_BATCH_SIZE, allGroupsToProcess.length);
       processingStatus.processCompleted = completedCount;
       dispatch({ 
         type: 'SET_PROCESSING_STATUS', 
         payload: { ...processingStatus }
       });
       
       // Update UI with the results so far
       batchResults.forEach(({ index, result }) => {
         // Update response data with ALL field selections (including default values)
         dispatch({
           type: 'UPDATE_RESPONSE_DATA',
           payload: { 
             index, 
             value: {
               ...result,
               // Store ALL the field selections with the response (including defaults)
               storedFieldSelections: currentFieldSelections
             }
           }
         });
         
         // Mark processing as complete for this group
         dispatch({
           type: 'UPDATE_PROCESSING_GROUP',
           payload: { index, value: false }
         });
       });
       
       // Introduce a small delay between batches to avoid overwhelming the server
       if (batchStart + PROCESSING_BATCH_SIZE < allGroupsToProcess.length) {
         // Very small delay just to let the event loop breathe
         await new Promise(resolve => setTimeout(resolve, 100));
       }
     }
     
     // All processing complete - update the final status
     processingStatus.processCompleted = totalGroups;
     processingStatus.currentGroup = totalGroups;
     
     // Final status update
     dispatch({ 
       type: 'SET_PROCESSING_STATUS', 
       payload: processingStatus
     });
     
     // Update legacy counter
     dispatch({ type: 'SET_COMPLETED_CHUNKS', payload: totalGroups });
     
     // Mark all processed groups as completed to prevent reprocessing
     dispatch({ type: 'MARK_GROUPS_AS_PROCESSED', payload: processedIndices });
     
     // Clear the image pool
     if (filesBase64.length > 0) {
       dispatch({ type: 'SET_FILES_BASE64', payload: [] });
     }
     
     // Short delay before resetting status to allow UI to show 100% completion
     setTimeout(() => {
       // Reset all status indicators
       dispatch({ type: 'RESET_STATUS' });
       dispatch({ type: 'SET_IS_LOADING', payload: false });
     }, 500);
     
     // Return success for Promise.allSettled
     return true;
     
   } catch (error) {
     // Handle any unexpected errors
     console.error("Error in generate listing process:", error);
     
     // Show error message
     alert(`An error occurred: ${error.message}`);
     
     // Reset status on error
     dispatch({ type: 'RESET_STATUS' });
     dispatch({ type: 'SET_IS_LOADING', payload: false });
     
     // Re-throw for Promise.allSettled
     throw error;
   }
 };

 return (
   <div className="app-container">
     <header className="header">
       <img src="/images/ListEasier.jpg" alt="ListEasier" className="logo" />
       <h1>ListEasier</h1>
     </header>

     <main className="main-card">
       <FormSection 
         onGenerateListing={handleGenerateListing} 
         onCategoryFieldsChange={setCategoryFields}
       />
       <PreviewSection categoryFields={categoryFields} />
     </main>

     <footer className="footer">
       <p>© 2025 ListEasier</p>
     </footer>
   </div>
 );
}

// Main App with Provider - THIS IS THE MISSING PART!
function App() {
 return (
   <AppStateProvider>
     <AppContent />
   </AppStateProvider>
 );
}

export default App;