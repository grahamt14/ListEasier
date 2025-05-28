import { useState, useEffect } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';
import EbayAuth from './EbayAuth';
import EbayPolicySelector from './EbayPolicySelector';

function BatchPreviewSection({ onShowListingManager, currentBatch, onCsvDownload, onEbayListingsCreated }) {
  const { state, dispatch } = useAppState();
  const [showListingManager, setShowListingManager] = useState(false);
  const [showEbaySection, setShowEbaySection] = useState(false);
  const { 
    isAuthenticated: ebayAuthenticated, 
    selectedPolicies, 
    ebayService 
  } = useEbayAuth();
  
  // Updated function to check if eBay listings can be created
  const canCreateEbayListings = () => {
    const hasValidListings = responseData.some(item => item && !item.error);
    const hasImages = imageGroups.some(group => group && group.length > 0);
    
    // In batch mode, we don't require categoryID since it can be set differently
    if (currentBatch) {
      return ebayAuthenticated && hasValidListings && hasImages;
    }
    
    // In non-batch mode, require categoryID
    return ebayAuthenticated && hasValidListings && hasImages && state.categoryID;
  };
  
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
    fieldSelections
  } = state;
  
  const marketplaceDetails = ebayService?.getMarketplaceDetails?.() || { siteId: 0, currency: 'USD', globalId: 'EBAY-US' };
  
  const { isProcessing, processTotal, processCompleted } = processingStatus || { isProcessing: false, processTotal: 0, processCompleted: 0 };
  const displayIsLoading = isLoading || isProcessing;
  const displayTotalChunks = processTotal || totalChunks;
  const displayCompletedChunks = processCompleted || completedChunks;
  const processProgress = displayTotalChunks > 0 ? Math.round((displayCompletedChunks / displayTotalChunks) * 100) : 0;

  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });

  const handleImageHover = (src, event) => {
    if (viewMode === 'row') {
      const rect = event.target.getBoundingClientRect();
      setPreviewPosition({
        x: rect.right + 10,
        y: rect.top
      });
      setPreviewImage(src);
    }
  };

  const handleImageLeave = () => {
    setPreviewImage(null);
  };

  const handleEbayAuthSuccess = () => {
    console.log('eBay authentication successful');
  };

  const handleEbayAuthError = (error) => {
    console.error('eBay authentication error:', error);
  };

  const handlePolicyChange = (policyType, policy) => {
    console.log(`Selected ${policyType}:`, policy);
  };

  const updateListingFieldSelection = (listingIndex, fieldLabel, newValue) => {
    const updatedResponseData = [...responseData];
    
    if (!updatedResponseData[listingIndex]) {
      return;
    }
    
    const currentListing = { ...updatedResponseData[listingIndex] };
    const currentStoredSelections = { ...currentListing.storedFieldSelections } || {};
    
    currentStoredSelections[fieldLabel] = newValue;
    
    currentListing.storedFieldSelections = currentStoredSelections;
    updatedResponseData[listingIndex] = currentListing;
    
    dispatch({
      type: 'SET_RESPONSE_DATA',
      payload: updatedResponseData
    });
  };

  const updateListingContent = (listingIndex, field, newValue) => {
    const updatedResponseData = [...responseData];
    
    if (!updatedResponseData[listingIndex]) {
      return;
    }
    
    const currentListing = { ...updatedResponseData[listingIndex] };
    currentListing[field] = newValue;
    updatedResponseData[listingIndex] = currentListing;
    
    dispatch({
      type: 'SET_RESPONSE_DATA',
      payload: updatedResponseData
    });
  };

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
    if (!responseData || responseData.length === 0) {
      alert("Error: No listing data available. Please generate listings first.");
      return null;
    }
    
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
    
    const allCategoryFieldLabels = new Set();
    validIndices.forEach(({ response }) => {
      if (response.storedFieldSelections) {
        Object.keys(response.storedFieldSelections).forEach(label => {
          if (label !== 'price' && label !== 'sku') {
            allCategoryFieldLabels.add(label);
          }
        });
      }
    });
    
    let header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format`;

    if (allCategoryFieldLabels.size > 0) {
      allCategoryFieldLabels.forEach(field => {
        header += `,${field}`;
      });
    }

    // Only add eBay policy columns if policies are selected (not in batch mode)
    if (!currentBatch && selectedPolicies.paymentPolicyId) {
      header += ',Payment policy name';
    }
    if (!currentBatch && selectedPolicies.fulfillmentPolicyId) {
      header += ',Shipping policy name';
    }
    if (!currentBatch && selectedPolicies.returnPolicyId) {
      header += ',Return policy name';
    }
    
    header += '\n';

    let csvContent = header;
    let missingImageGroups = [];

    validIndices.forEach(({ response, index }) => {
      const title = response.title ? response.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      const description = response.description ? response.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
      
      let photoUrls = [];
      
      if (s3ImageGroups && 
          s3ImageGroups[index] && 
          Array.isArray(s3ImageGroups[index]) && 
          s3ImageGroups[index].length > 0) {
        
        photoUrls = s3ImageGroups[index].filter(url => 
          url && 
          typeof url === 'string' && 
          (url.includes('amazonaws.com') || url.startsWith('http'))
        );
      } else {
        missingImageGroups.push(index);
        photoUrls = Array.from(
          { length: imageGroups[index].length }, 
          (_, i) => `https://via.placeholder.com/800x600?text=Image+Not+Available+Group+${index+1}+Image+${i+1}`
        );
      }
      
      const formattedUrls = photoUrls.filter(url => url).join('||');
      
      const metadata = groupMetadata && groupMetadata[index] 
        ? groupMetadata[index] 
        : { price: price, sku: sku };
      
      const groupPrice = metadata.price || price || '9.99';
      const groupSku = metadata.sku || sku || `SKU-${index+1}`;
      
      let line = `Draft,${groupSku},${categoryID},"${title}",,${groupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
      
      if (allCategoryFieldLabels.size > 0) {
        const listingFieldSelections = response.storedFieldSelections || {};
        
        allCategoryFieldLabels.forEach(field => {
          const fieldValue = listingFieldSelections[field] || "-- Select --";
          line += `,"${fieldValue.replace(/"/g, '""')}"`;
        });
      }

      // Only add eBay policy IDs if not in batch mode
      if (!currentBatch && selectedPolicies.paymentPolicyId) {
        line += `,"${selectedPolicies.paymentPolicyId}"`;
      }
      if (!currentBatch && selectedPolicies.fulfillmentPolicyId) {
        line += `,"${selectedPolicies.fulfillmentPolicyId}"`;
      }
      if (!currentBatch && selectedPolicies.returnPolicyId) {
        line += `,"${selectedPolicies.returnPolicyId}"`;
      }
      
      csvContent += `${line}\n`;
    });
    
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
    const csvFileName = `${currentBatch ? `${currentBatch.name}_` : ''}listings_${new Date().toISOString().split('T')[0]}.csv`;
    
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

    // Track CSV download for batch status - call the callback from BatchEditor
    if (onCsvDownload) {
      onCsvDownload();
    }
  };

  const downloadSingleListing = (groupIndex) => {
    const listing = responseData[groupIndex];
    if (!listing || listing.error) {
      alert("No valid listing to download!");
      return;
    }
    
    const listingFieldSelections = listing.storedFieldSelections || {};
    
    const metadata = groupMetadata && groupMetadata[groupIndex] 
      ? groupMetadata[groupIndex] 
      : { price: price || '', sku: sku || '' };
    
    const groupPrice = metadata.price || price || '9.99';
    const groupSku = metadata.sku || sku || `SKU-${groupIndex+1}`;
    
    let photoUrls = [];
    
    if (s3ImageGroups && 
        s3ImageGroups[groupIndex] && 
        Array.isArray(s3ImageGroups[groupIndex]) && 
        s3ImageGroups[groupIndex].length > 0) {
      
      photoUrls = s3ImageGroups[groupIndex].filter(url => 
        url && 
        typeof url === 'string' && 
        (url.includes('amazonaws.com') || url.startsWith('http'))
      );
    } else {
      alert(`Warning: Listing in Group ${groupIndex+1} has no valid image URLs. The CSV may not work correctly on eBay.`);
      
      photoUrls = Array.from(
        { length: imageGroups[groupIndex].length }, 
        (_, i) => `https://via.placeholder.com/800x600?text=Image+Not+Available+Group+${groupIndex+1}+Image+${i+1}`
      );
    }
    
    const selectedFields = Object.keys(listingFieldSelections).filter(label => 
      label !== 'price' && label !== 'sku'
    );
    
    let header = `#INFO,Version=0.0.2,Template= eBay-draft-listings-template_US,,,,,,,,
#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,
"#INFO After you've successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.com/sh/lst/drafts",,,,,,,,,,
#INFO,,,,,,,,,,
Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format`;

    if (selectedFields.length > 0) {
      selectedFields.forEach(field => {
        header += `,${field}`;
      });
    }

    // Only add eBay policy columns if not in batch mode
    if (!currentBatch && selectedPolicies.paymentPolicyId) {
      header += ',Payment policy name';
    }
    if (!currentBatch && selectedPolicies.fulfillmentPolicyId) {
      header += ',Shipping policy name';
    }
    if (!currentBatch && selectedPolicies.returnPolicyId) {
      header += ',Return policy name';
    }
    
    header += '\n';

    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    const formattedUrls = photoUrls.filter(url => url).join('||');
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
    let line = `Draft,${groupSku},${categoryID},"${title}",,${groupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
    
    if (selectedFields.length > 0) {
      selectedFields.forEach(field => {
        const fieldValue = listingFieldSelections[field] || "-- Select --";
        line += `,"${fieldValue.replace(/"/g, '""')}"`;
      });
    }

    // Only add eBay policy IDs if not in batch mode
    if (!currentBatch && selectedPolicies.paymentPolicyId) {
      line += `,"${selectedPolicies.paymentPolicyId}"`;
    }
    if (!currentBatch && selectedPolicies.fulfillmentPolicyId) {
      line += `,"${selectedPolicies.fulfillmentPolicyId}"`;
    }
    if (!currentBatch && selectedPolicies.returnPolicyId) {
      line += `,"${selectedPolicies.returnPolicyId}"`;
    }
    
    const csvContent = header + line + '\n';
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const csvFileName = `${currentBatch ? `${currentBatch.name}_` : ''}listing_group_${groupIndex+1}_${new Date().toISOString().split('T')[0]}.csv`;
    
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

    // Track single CSV download for batch status - call the callback from BatchEditor
    if (onCsvDownload) {
      onCsvDownload();
    }
  };

  // **UPDATED: Function to handle eBay listing manager with proper callback chain**
  const handleEbayListingManager = () => {
    console.log('BatchPreviewSection: handleEbayListingManager called');
    if (onShowListingManager) {
      console.log('BatchPreviewSection: Calling onShowListingManager');
      onShowListingManager();
    }
  };

  // **NEW: Handle when eBay listings are successfully created**
  const handleEbayListingsCreated = (listingsCount) => {
    console.log('BatchPreviewSection: eBay listings created:', listingsCount);
    if (onEbayListingsCreated) {
      console.log('BatchPreviewSection: Calling onEbayListingsCreated callback');
      onEbayListingsCreated(listingsCount);
    }
  };

  const mergeAiResolvedFields = (responseItem, originalFieldSelections) => {
    if (!responseItem.aiResolvedFields || typeof responseItem.aiResolvedFields !== 'object') {
      return originalFieldSelections;
    }

    const merged = { ...originalFieldSelections };
    
    Object.entries(responseItem.aiResolvedFields).forEach(([fieldName, aiValue]) => {
      const currentValue = originalFieldSelections[fieldName];
      
      if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
        if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified" && aiValue.trim() !== "") {
          merged[fieldName] = aiValue.trim();
        }
      }
    });

    return merged;
  };

  const renderResponseData = (index) => {
    const response = responseData[index];
    if (!response) return null;
    
    const metadata = groupMetadata && groupMetadata[index] 
      ? groupMetadata[index] 
      : { price: price || '', sku: sku || '' };
    
    const groupPrice = metadata.price || price || '';
    const groupSku = metadata.sku || sku || '';
    
    const listingFieldSelections = response.storedFieldSelections || fieldSelections;
    
    if (response.error) {
      return (
        <div className="response-error">
          <p style={{ color: '#000' }}>Error: {response.error}</p>
          {response.raw_content && <p style={{ color: '#000' }}>Raw content: {response.raw_content}</p>}
        </div>
      );
    }
    
    const updateListingPrice = (newPrice) => {
      const updatedMetadata = [...(groupMetadata || [])];
      while (updatedMetadata.length <= index) {
        updatedMetadata.push(null);
      }
      updatedMetadata[index] = {
        ...(updatedMetadata[index] || {}),
        price: newPrice
      };
      dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
    };
    
    const updateListingSku = (newSku) => {
      const updatedMetadata = [...(groupMetadata || [])];
      while (updatedMetadata.length <= index) {
        updatedMetadata.push(null);
      }
      updatedMetadata[index] = {
        ...(updatedMetadata[index] || {}),
        sku: newSku
      };
      dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
    };
    
    return (
      <div className="response-data">
        <h4 style={{ color: '#000' }}>Generated Listing</h4>
        <div className="response-fields">
          {response.title !== undefined && (
            <div className="response-field primary-field editable-title-field">
              <strong style={{ color: '#000' }}>Title:</strong>
              <textarea
                value={response.title || ''}
                onChange={(e) => updateListingContent(index, 'title', e.target.value)}
                placeholder="Enter title"
                className="editable-title-input"
                style={{
                  width: '100%',
                  minHeight: '60px',
                  padding: '8px 12px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  backgroundColor: '#fff',
                  color: '#000',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.4'
                }}
              />
            </div>
          )}
          
          {response.description !== undefined && (
            <div className="response-field primary-field editable-description-field">
              <strong style={{ color: '#000' }}>Description:</strong>
              <textarea
                value={response.description || ''}
                onChange={(e) => updateListingContent(index, 'description', e.target.value)}
                placeholder="Enter description"
                className="editable-description-input"
                style={{
                  width: '100%',
                  minHeight: '120px',
                  padding: '8px 12px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  backgroundColor: '#fff',
                  color: '#000',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: '1.4'
                }}
              />
            </div>
          )}
          
          {response.aiResolvedFields && Object.keys(response.aiResolvedFields).length > 0 && (
            <div className="ai-resolved-notification" style={{
              background: 'linear-gradient(135deg, #e8f4f8 0%, #d1edff 100%)',
              border: '1px solid #4a90e2',
              borderRadius: '6px',
              padding: '12px',
              margin: '8px 0',
              fontSize: '0.9rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.2em' }}>🤖</span>
                <strong style={{ color: '#0654ba' }}>AI Resolved Fields</strong>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#333' }}>
                AI automatically filled in {Object.keys(response.aiResolvedFields).length} category field(s) based on the images. 
                You can review and edit these values below.
              </div>
            </div>
          )}
          
          {Object.entries(response)
            .filter(([key]) => 
              key !== 'title' && 
              key !== 'description' && 
              key !== 'storedFieldSelections' && 
              key !== 'aiResolvedFields' && 
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
          
          <div className="category-fields-metadata">
            <h5 style={{ margin: '10px 0 5px 0', color: '#000' }}>Item Details</h5>
            
            <div className="response-field listing-metadata editable-field">
              <strong style={{ color: '#000' }}>Price:</strong>
              <input
                type="text"
                value={groupPrice}
                onChange={(e) => updateListingPrice(e.target.value)}
                placeholder="Enter price"
                style={{
                  marginLeft: '8px',
                  padding: '4px 8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  backgroundColor: '#fff',
                  color: '#000',
                  fontSize: '0.9rem',
                  minWidth: '100px'
                }}
              />
            </div>
            <div className="response-field listing-metadata editable-field">
              <strong style={{ color: '#000' }}>SKU:</strong>
              <input
                type="text"
                value={groupSku}
                onChange={(e) => updateListingSku(e.target.value)}
                placeholder="Enter SKU"
                style={{
                  marginLeft: '8px',
                  padding: '4px 8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  backgroundColor: '#fff',
                  color: '#000',
                  fontSize: '0.9rem',
                  minWidth: '100px'
                }}
              />
            </div>
            
            {Object.entries(listingFieldSelections).map(([label, value]) => {
              if (label !== 'price' && label !== 'sku') {
                const displayValue = (value === "-- Select --" || !value) ? "" : value;
                const wasAiResolved = response.aiResolvedFields && response.aiResolvedFields[label];
                
                return (
                  <div key={label} className={`response-field listing-metadata editable-field ${wasAiResolved ? 'ai-resolved-field' : ''}`}>
                    <strong style={{ color: '#000', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {label}:
                      {wasAiResolved && (
                        <span 
                          title="This field was automatically filled by AI" 
                          style={{ fontSize: '0.8em', opacity: 0.7 }}
                        >
                          🤖
                        </span>
                      )}
                    </strong>
                    <input
                      type="text"
                      value={displayValue}
                      onChange={(e) => updateListingFieldSelection(index, label, e.target.value)}
                      placeholder="Enter value"
                      style={{
                        marginLeft: '8px',
                        padding: '4px 8px',
                        border: wasAiResolved ? '2px solid #4a90e2' : '1px solid #ccc',
                        borderRadius: '4px',
                        backgroundColor: wasAiResolved ? '#f0f7ff' : '#fff',
                        color: '#000',
                        fontSize: '0.9rem',
                        minWidth: '150px'
                      }}
                      title={wasAiResolved ? 'This field was automatically filled by AI' : ''}
                    />
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

  const Spinner = () => (
    <div className="spinner">
      <div className="spinner-circle"></div>
    </div>
  );

  const hasValidListings = responseData.some(item => item && !item.error);

  const getAllCategoryFieldLabels = () => {
    const allLabels = new Set();
    
    responseData.forEach(response => {
      if (response && response.storedFieldSelections) {
        Object.keys(response.storedFieldSelections).forEach(label => {
          if (label !== 'price' && label !== 'sku') {
            allLabels.add(label);
          }
        });
      }
    });
    
    return Array.from(allLabels);
  };

  const allFieldLabels = getAllCategoryFieldLabels();

  const generateGridTemplate = (fieldCount) => {
    const baseColumns = '200px 250px 300px 100px 120px';
    const fieldColumns = fieldCount > 0 ? ` repeat(${fieldCount}, 150px)` : '';
    
    return baseColumns + fieldColumns;
  };

  // Debug logging for eBay button visibility
  console.log('eBay Button Debug:', {
    ebayAuthenticated,
    hasValidListings,
    hasImages: imageGroups.some(group => group && group.length > 0),
    categoryID,
    currentBatch: !!currentBatch,
    canCreateEbayListings: canCreateEbayListings()
  });

  return (
    <section className="preview-section">
      <div className="section-header">
        <div className="header-left">
          <h2>
            {currentBatch ? `${currentBatch.name} - Listings` : 'Image Groups & Listings'}
          </h2>
          <div className="view-toggle">
            <button 
              className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z"/>
              </svg>
            </button>
            <button 
              className={`view-toggle-btn ${viewMode === 'row' ? 'active' : ''}`}
              onClick={() => setViewMode('row')}
              title="Row View"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="header-buttons">
          {hasValidListings && (
            <>
              <button 
                className="download-button"
                onClick={downloadListingsAsCsv}
                disabled={displayIsLoading}
              >
                Download CSV
              </button>
              {canCreateEbayListings() && (
                <button 
                  className="create-ebay-listings-button"
                  onClick={handleEbayListingManager}
                  disabled={displayIsLoading}
                >
                  Create eBay Listings
                </button>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Enhanced eBay Connection Status for Batch Mode */}
      {!ebayAuthenticated && hasValidListings && (
        <div style={{
          background: 'linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%)',
          border: '1px solid #ffc107',
          borderRadius: '12px',
          padding: '20px 24px',
          margin: '16px 0',
          color: '#856404'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <span style={{ fontSize: '1.5em' }}>🔗</span>
            <strong style={{ fontSize: '1.1rem' }}>eBay Integration Available</strong>
          </div>
          <p style={{ margin: '0 0 16px 0', fontSize: '1rem', lineHeight: '1.5' }}>
            Connect your eBay account to create listings directly on eBay. You can still generate and download CSV files without connecting.
          </p>
          
          {/* Add the connection interface directly here for batch mode */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button 
              onClick={() => setShowEbaySection(!showEbaySection)}
              style={{
                background: 'linear-gradient(135deg, #0654ba, #4a90e2)',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                boxShadow: '0 2px 8px rgba(6, 84, 186, 0.2)'
              }}
              onMouseOver={(e) => {
                e.target.style.background = 'linear-gradient(135deg, #0545a0, #3a7bc8)';
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 12px rgba(6, 84, 186, 0.3)';
              }}
              onMouseOut={(e) => {
                e.target.style.background = 'linear-gradient(135deg, #0654ba, #4a90e2)';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 8px rgba(6, 84, 186, 0.2)';
              }}
            >
              {showEbaySection ? '▲ Hide eBay Setup' : '🔗 Connect eBay Account'}
            </button>
            
            <span style={{ fontSize: '0.9rem', color: '#856404', fontStyle: 'italic' }}>
              Takes just 2 minutes to set up
            </span>
          </div>
          
          {/* Expandable eBay Connection Section */}
          {showEbaySection && (
            <div style={{
              marginTop: '20px',
              padding: '20px',
              background: 'white',
              borderRadius: '8px',
              border: '1px solid #e9ecef',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <EbayAuth 
                onAuthSuccess={handleEbayAuthSuccess}
                onAuthError={handleEbayAuthError}
                redirectAfterAuth={window.location.pathname + window.location.search}
              />
              {ebayAuthenticated && (
                <div style={{ marginTop: '20px' }}>
                  <EbayPolicySelector onPolicyChange={handlePolicyChange} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
      {/* Authenticated eBay Status */}
      {ebayAuthenticated && hasValidListings && (
        <div style={{
          background: 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)',
          border: '1px solid #28a745',
          borderRadius: '12px',
          padding: '16px 20px',
          margin: '16px 0',
          color: '#155724'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.2em' }}>✅</span>
            <strong style={{ fontSize: '1rem' }}>eBay Account Connected</strong>
          </div>
          <div style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
            Ready to create listings directly on eBay{ebayService?.environment === 'sandbox' ? ' (sandbox mode)' : ''}.
            {selectedPolicies.paymentPolicyId && selectedPolicies.fulfillmentPolicyId && selectedPolicies.returnPolicyId ? (
              <div style={{ marginTop: '6px', color: '#155724' }}>
                ✓ All business policies configured
              </div>
            ) : (
              <div style={{ marginTop: '6px', color: '#856404' }}>
                ⚠️ Some business policies missing - listings will be created as drafts
              </div>
            )}
          </div>
          
          <button 
            onClick={() => setShowEbaySection(!showEbaySection)}
            style={{
              background: 'transparent',
              border: '1px solid #28a745',
              color: '#28a745',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              marginTop: '10px',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.target.style.background = '#28a745';
              e.target.style.color = 'white';
            }}
            onMouseOut={(e) => {
              e.target.style.background = 'transparent';
              e.target.style.color = '#28a745';
            }}
          >
            {showEbaySection ? 'Hide Settings' : 'Configure Policies'}
          </button>
          
          {showEbaySection && (
            <div style={{
              marginTop: '15px',
              padding: '15px',
              background: 'white',
              borderRadius: '6px',
              border: '1px solid #c3e6cb'
            }}>
              <EbayPolicySelector onPolicyChange={handlePolicyChange} />
            </div>
          )}
        </div>
      )}
      
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

      {previewImage && viewMode === 'row' && (
        <div 
          className="image-preview-popup"
          style={{
            position: 'fixed',
            left: previewPosition.x,
            top: previewPosition.y,
            zIndex: 1000,
            pointerEvents: 'none'
          }}
        >
          <img 
            src={previewImage} 
            alt="Preview" 
            className="preview-image"
          />
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="groups-container">
          {imageGroups.map((group, gi) => {
            if (group.length === 0) return null;
            
    let groupClass = "";
if (processingGroups[gi]) {
  groupClass = "processing";
} else if (processedGroupIndices && processedGroupIndices.includes(gi)) {
  groupClass = "processed";  
} else if (group.length > 0 && !responseData[gi]) {
  groupClass = "new";
}
            
            return (
              <div
                key={gi}
                className={`group-card ${groupClass}`}
                onDrop={e => handleGroupDrop(e, gi)}
                onDragOver={e => e.preventDefault()}
              >
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
                    </div>
                  )}
                </div>
                <div className="card-actions">
                  <button 
                    className="download-single-button"
                    onClick={() => downloadSingleListing(gi)}
                    disabled={!responseData[gi] || responseData[gi].error}
                  >
                    Download CSV
                  </button>
                  {canCreateEbayListings() && responseData[gi] && !responseData[gi].error && (
                    <button 
                      className="create-single-listing-button"
                      onClick={handleEbayListingManager}
                      disabled={processingGroups[gi]}
                      title="Create this listing on eBay"
                    >
                      List on eBay
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Row view implementation - completing the truncated code
        <div className="row-view-container">
          {imageGroups.some(group => group.length > 0) && (
            <div className="row-view-table">
              <div 
                className="row-view-header" 
                style={{ gridTemplateColumns: generateGridTemplate(allFieldLabels.length) }}
              >
                <div className="row-header-cell images-header">Images</div>
                <div className="row-header-cell title-header">Title</div>
                <div className="row-header-cell description-header">Description</div>
                <div className="row-header-cell price-header">Price</div>
                <div className="row-header-cell sku-header">SKU</div>
                {allFieldLabels.map(label => (
                  <div key={label} className="row-header-cell field-header">{label}</div>
                ))}
              </div>
              
              {imageGroups.map((group, gi) => {
                if (group.length === 0) return null;
                
                const response = responseData[gi];
                const metadata = groupMetadata && groupMetadata[gi] 
                  ? groupMetadata[gi] 
                  : { price: price || '', sku: sku || '' };
                
                const groupPrice = metadata.price || price || '';
                const groupSku = metadata.sku || sku || '';
                const listingFieldSelections = response?.storedFieldSelections || fieldSelections;
                
let groupClass = "";
if (processingGroups[gi]) {
  groupClass = "processing";
} else if (processedGroupIndices && processedGroupIndices.includes(gi)) {
  groupClass = "processed";
} else if (group.length > 0 && !responseData[gi]) {
  groupClass = "new";
}
                
                const nonEmptyGroupsBefore = imageGroups.slice(0, gi).filter(g => g.length > 0).length;
                const isEvenRow = nonEmptyGroupsBefore % 2 === 0;
                const alternatingClass = isEvenRow ? "row-even" : "row-odd";
                
                const updateListingPrice = (newPrice) => {
                  const updatedMetadata = [...(groupMetadata || [])];
                  while (updatedMetadata.length <= gi) {
                    updatedMetadata.push(null);
                  }
                  updatedMetadata[gi] = {
                    ...(updatedMetadata[gi] || {}),
                    price: newPrice
                  };
                  dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
                };
                
                const updateListingSku = (newSku) => {
                  const updatedMetadata = [...(groupMetadata || [])];
                  while (updatedMetadata.length <= gi) {
                    updatedMetadata.push(null);
                  }
                  updatedMetadata[gi] = {
                    ...(updatedMetadata[gi] || {}),
                    sku: newSku
                  };
                  dispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
                };
                
                return (
                  <div
                    key={gi}
                    className={`row-view-row ${groupClass} ${alternatingClass}`}
                    style={{ gridTemplateColumns: generateGridTemplate(allFieldLabels.length) }}
                    onDrop={e => handleGroupDrop(e, gi)}
                    onDragOver={e => e.preventDefault()}
                  >
                    <div className="row-cell images-cell">
                      <div className="row-images-container">
                        <div className="group-header-with-status">
                          <div className="group-number-badge">Group {gi + 1}</div>
                          {processingGroups[gi] ? (
                            <div className="status-indicator processing">⋯</div>
                          ) : (processedGroupIndices && processedGroupIndices.includes(gi)) ? (
                            <div className="status-indicator processed">✓</div>
                          ) : (group.length > 0 && !responseData[gi]) ? (
                            <div className="status-indicator new">NEW</div>
                          ) : null}
                          {response && response.aiResolvedFields && Object.keys(response.aiResolvedFields).length > 0 && (
                            <div 
                              className="status-indicator ai-resolved" 
                              title={`AI resolved ${Object.keys(response.aiResolvedFields).length} field(s)`}
                              style={{
                                backgroundColor: '#4a90e2',
                                color: 'white',
                                fontSize: '10px',
                                borderRadius: '10px',
                                padding: '2px 6px',
                                width: 'auto',
                                height: 'auto'
                              }}
                            >
                              🤖AI
                            </div>
                          )}
                        </div>
                        <div className="row-thumbs">
                          {group.map((src, xi) => (
                            <img 
                              key={xi} 
                              src={src} 
                              alt={`group-${gi}-img-${xi}`} 
                              className="row-thumb"
                              draggable 
                              onDragStart={e => {
                                e.dataTransfer.setData("from", "group");
                                e.dataTransfer.setData("index", `${gi}-${xi}`);
                              }}
                              onMouseEnter={(e) => handleImageHover(src, e)}
                              onMouseLeave={handleImageLeave}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    
                    <div className="row-cell title-cell">
                      {processingGroups[gi] ? (
                        <div className="row-loading">
                          <Spinner />
                          <span style={{ color: '#000' }}>Generating...</span>
                        </div>
                      ) : response && !response.error ? (
                        <textarea
                          value={response.title || ''}
                          onChange={(e) => updateListingContent(gi, 'title', e.target.value)}
                          placeholder="Enter title"
                          className="row-title-input"
                          style={{
                            width: '100%',
                            minHeight: '45px',
                            padding: '6px 8px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                            backgroundColor: '#fff',
                            color: '#000',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            lineHeight: '1.3'
                          }}
                        />
                      ) : response && response.error ? (
                        <div className="row-error" style={{ color: '#dc3545' }}>Error: {response.error}</div>
                      ) : (
                        <div className="row-placeholder" style={{ color: '#000' }}>Click "Generate Listing"</div>
                      )}
                    </div>
                    
                    <div className="row-cell description-cell">
                      {processingGroups[gi] ? (
                        <div className="row-loading">
                          <Spinner />
                          <span style={{ color: '#000' }}>Generating...</span>
                        </div>
                      ) : response && !response.error ? (
                        <textarea
                          value={response.description || ''}
                          onChange={(e) => updateListingContent(gi, 'description', e.target.value)}
                          placeholder="Enter description"
                          className="row-description-input"
                          style={{
                            width: '100%',
                            minHeight: '60px',
                            padding: '6px 8px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            fontSize: '0.85rem',
                            backgroundColor: '#fff',
                            color: '#000',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            lineHeight: '1.3'
                          }}
                        />
                      ) : response && response.error ? (
                        <div className="row-error" style={{ color: '#dc3545' }}>Error generating description</div>
                      ) : (
                        <div className="row-placeholder" style={{ color: '#000' }}>Click "Generate Listing"</div>
                      )}
                    </div>
                    
                    <div className="row-cell price-cell">
                      <input
                        type="text"
                        value={groupPrice}
                        onChange={(e) => updateListingPrice(e.target.value)}
                        placeholder="Enter price"
                        className="row-input price-input"
                        style={{ color: '#000' }}
                      />
                    </div>
                    
                    <div className="row-cell sku-cell">
                      <input
                        type="text"
                        value={groupSku}
                        onChange={(e) => updateListingSku(e.target.value)}
                        placeholder="Enter SKU"
                        className="row-input sku-input"
                        style={{ color: '#000' }}
                      />
                    </div>
                    
                    {allFieldLabels.map(label => {
                      const displayValue = (listingFieldSelections[label] === "-- Select --" || !listingFieldSelections[label]) ? 
                        "" : listingFieldSelections[label];
                      
                      const wasAiResolved = response && response.aiResolvedFields && response.aiResolvedFields[label];
                      
                      return (
                        <div key={label} className="row-cell field-cell">
                          <input
                            type="text"
                            value={displayValue}
                            onChange={(e) => updateListingFieldSelection(gi, label, e.target.value)}
                            placeholder="Enter value"
                            className="row-input field-input"
                            style={{ 
                              color: '#000',
                              border: wasAiResolved ? '2px solid #4a90e2' : '1px solid #ccc',
                              backgroundColor: wasAiResolved ? '#f0f7ff' : '#fff'
                            }}
                            title={wasAiResolved ? 'This field was automatically filled by AI' : ''}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default BatchPreviewSection;