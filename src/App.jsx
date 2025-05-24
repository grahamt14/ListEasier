import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AppStateProvider, useAppState } from './StateContext';
import { EbayAuthProvider, useEbayAuth } from './EbayAuthContext';

function PreviewSection({ categoryFields = [] }) {
  const { state, dispatch } = useAppState();
  const { selectedPolicies, ebayService } = useEbayAuth(); // Get eBay policies and service
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
  
  // Get current marketplace details
  const marketplaceDetails = ebayService?.getMarketplaceDetails() || { siteId: 0, currency: 'USD', globalId: 'EBAY-US' };
  
  // Use new processing status for consistent display
  const { isProcessing, processTotal, processCompleted } = processingStatus || { isProcessing: false, processTotal: 0, processCompleted: 0 };
  const displayIsLoading = isLoading || isProcessing;
  const displayTotalChunks = processTotal || totalChunks;
  const displayCompletedChunks = processCompleted || completedChunks;
  const processProgress = displayTotalChunks > 0 ? Math.round((displayCompletedChunks / displayTotalChunks) * 100) : 0;

  // Handle hover for drop target
  const [hoveredGroup, setHoveredGroup] = useState(null);
  
  // Add view mode state
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'row'

  // Add image preview state
  const [previewImage, setPreviewImage] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });

  // AWS Configuration
  const REGION = "us-east-2";
  const BUCKET_NAME = "listeasier";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  // Handle image hover
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

  // Add function to update title and description
  const updateListingContent = (listingIndex, field, newValue) => {
    // Get the current response data
    const updatedResponseData = [...responseData];
    
    // Make sure the listing exists
    if (!updatedResponseData[listingIndex]) {
      return;
    }
    
    // Update the specific field (title or description)
    const currentListing = { ...updatedResponseData[listingIndex] };
    currentListing[field] = newValue;
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

  // ... (keep all the existing CSV generation and download functions unchanged)

  const generateCSVContent = () => {
    // Debug output to help diagnose data structure issues
    console.log("Generating CSV with data:", {
      responseData: responseData,
      imageGroups: imageGroups,
      s3ImageGroups: s3ImageGroups,
      groupMetadata: groupMetadata,
      selectedPolicies: selectedPolicies
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

    // Add eBay policy columns if policies are selected
    if (selectedPolicies.paymentPolicyId) {
      header += ',Payment policy name';
    }
    if (selectedPolicies.fulfillmentPolicyId) {
      header += ',Shipping policy name';
    }
    if (selectedPolicies.returnPolicyId) {
      header += ',Return policy name';
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
      
      // Get current metadata for this group (which may have been updated by the user)
      const metadata = groupMetadata && groupMetadata[index] 
        ? groupMetadata[index] 
        : { price: price, sku: sku };
      
      const groupPrice = metadata.price || price || '9.99';
      const groupSku = metadata.sku || sku || `SKU-${index+1}`;
      
      // Start with the standard fields using current metadata values
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

      // Add eBay policy IDs if selected
      if (selectedPolicies.paymentPolicyId) {
        line += `,"${selectedPolicies.paymentPolicyId}"`;
      }
      if (selectedPolicies.fulfillmentPolicyId) {
        line += `,"${selectedPolicies.fulfillmentPolicyId}"`;
      }
      if (selectedPolicies.returnPolicyId) {
        line += `,"${selectedPolicies.returnPolicyId}"`;
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

  const downloadSingleListing = (groupIndex) => {
    const listing = responseData[groupIndex];
    if (!listing || listing.error) {
      alert("No valid listing to download!");
      return;
    }
    
    // Get the stored field selections for this listing
    const listingFieldSelections = listing.storedFieldSelections || {};
    
    // Get the current group metadata for price and SKU
    const metadata = groupMetadata && groupMetadata[groupIndex] 
      ? groupMetadata[groupIndex] 
      : { price: price || '', sku: sku || '' };
    
    const groupPrice = metadata.price || price || '9.99';
    const groupSku = metadata.sku || sku || `SKU-${groupIndex+1}`;
    
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

    // Add eBay policy columns if policies are selected
    if (selectedPolicies.paymentPolicyId) {
      header += ',Payment policy name';
    }
    if (selectedPolicies.fulfillmentPolicyId) {
      header += ',Shipping policy name';
    }
    if (selectedPolicies.returnPolicyId) {
      header += ',Return policy name';
    }
    
    header += '\n';

    const title = listing.title ? listing.title.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    const formattedUrls = photoUrls.filter(url => url).join('||');
    const description = listing.description ? listing.description.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""') : '';
    
    // Start with standard fields using the current metadata values
    let line = `Draft,${groupSku},${categoryID},"${title}",,${groupPrice},1,${formattedUrls},3000,"${description}",FixedPrice`;
    
    // Add category fields to the line (including those with default values)
    if (selectedFields.length > 0) {
      selectedFields.forEach(field => {
        const fieldValue = listingFieldSelections[field] || "-- Select --";
        line += `,"${fieldValue.replace(/"/g, '""')}"`;
      });
    }

    // Add eBay policy IDs if selected
    if (selectedPolicies.paymentPolicyId) {
      line += `,"${selectedPolicies.paymentPolicyId}"`;
    }
    if (selectedPolicies.fulfillmentPolicyId) {
      line += `,"${selectedPolicies.fulfillmentPolicyId}"`;
    }
    if (selectedPolicies.returnPolicyId) {
      line += `,"${selectedPolicies.returnPolicyId}"`;
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

  // Updated renderResponseData function with editable title and description
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
    
    // Function to update price for this specific listing
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
    
    // Function to update SKU for this specific listing
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
          {/* Editable title field */}
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
          
          {/* Editable description field */}
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
            
            {/* Make price and SKU editable */}
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

  // Get all unique category field labels for table headers in row view
  const getAllCategoryFieldLabels = () => {
    const allLabels = new Set();
    
    // First, add labels from any existing response data
    responseData.forEach(response => {
      if (response && response.storedFieldSelections) {
        Object.keys(response.storedFieldSelections).forEach(label => {
          if (label !== 'price' && label !== 'sku') {
            allLabels.add(label);
          }
        });
      }
    });
    
    // If no response data yet, use the current form's category fields
    if (allLabels.size === 0 && categoryFields.length > 0) {
      categoryFields.forEach(field => {
        if (field.FieldLabel) {
          allLabels.add(field.FieldLabel);
        }
      });
    }
    
    return Array.from(allLabels);
  };

  const allFieldLabels = getAllCategoryFieldLabels();

  // Generate dynamic grid template based on number of fields (REMOVED Actions column)
  const generateGridTemplate = (fieldCount) => {
    const baseColumns = '200px 250px 300px 100px 120px'; // Images, Title, Description, Price, SKU
    const fieldColumns = fieldCount > 0 ? ` repeat(${fieldCount}, 150px)` : '';
    
    return baseColumns + fieldColumns;
  };

  return (
    <section className="preview-section">
      <div className="section-header">
        <div className="header-left">
          <h2>Image Groups & Listings</h2>
          {/* View Toggle Button */}
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

      {/* Image Preview Popup for Row View */}
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

      {/* Conditional rendering based on view mode */}
      {viewMode === 'grid' ? (
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
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Row View - Updated with editable title and description
        <div className="row-view-container">
          {imageGroups.some(group => group.length > 0) && (
            <div className="row-view-table">
              {/* Table Header with dynamic grid template */}
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
              
              {/* Table Rows with dynamic grid template */}
              {imageGroups.map((group, gi) => {
                // Skip empty groups
                if (group.length === 0) return null;
                
                const response = responseData[gi];
                const metadata = groupMetadata && groupMetadata[gi] 
                  ? groupMetadata[gi] 
                  : { price: price || '', sku: sku || '' };
                
                const groupPrice = metadata.price || price || '';
                const groupSku = metadata.sku || sku || '';
                const listingFieldSelections = response?.storedFieldSelections || fieldSelections;
                
                // Determine the class based on processing state
                let groupClass = "";
                if (processingGroups[gi]) {
                  groupClass = "processing";
                } else if (processedGroupIndices && processedGroupIndices.includes(gi)) {
                  groupClass = "processed";
                } else if (group.length > 0 && !responseData[gi]) {
                  groupClass = "new";
                }
                
                // Add alternating row class based on the actual rendered row index
                const nonEmptyGroupsBefore = imageGroups.slice(0, gi).filter(g => g.length > 0).length;
                const isEvenRow = nonEmptyGroupsBefore % 2 === 0;
                const alternatingClass = isEvenRow ? "row-even" : "row-odd";
                
                // Function to update price for this specific listing
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
                
                // Function to update SKU for this specific listing
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
                    {/* Images Column */}
                    <div className="row-cell images-cell">
                      <div className="row-images-container">
                        <div className="group-header-with-status">
                          <div className="group-number-badge">Group {gi + 1}</div>
                          {/* Status indicator moved to images column */}
                          {processingGroups[gi] ? (
                            <div className="status-indicator processing">⋯</div>
                          ) : (processedGroupIndices && processedGroupIndices.includes(gi)) ? (
                            <div className="status-indicator processed">✓</div>
                          ) : (group.length > 0 && !responseData[gi]) ? (
                            <div className="status-indicator new">NEW</div>
                          ) : null}
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
                    
                    {/* Title Column - Updated with editable textarea */}
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
                    
                    {/* Description Column - Updated with editable textarea */}
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
                    
                    {/* Price Column */}
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
                    
                    {/* SKU Column */}
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
                    
                    {/* Category Fields Columns */}
                    {allFieldLabels.map(label => {
                      const fieldDefinition = categoryFields.find(field => field.FieldLabel === label);
                      const options = fieldDefinition?.CategoryOptions ? 
                        fieldDefinition.CategoryOptions.split(';').map(opt => opt.trim()) : [];
                      const displayValue = (listingFieldSelections[label] === "-- Select --" || !listingFieldSelections[label]) ? 
                        "" : listingFieldSelections[label];
                      
                      return (
                        <div key={label} className="row-cell field-cell">
                          {options.length > 0 ? (
                            <div style={{ position: 'relative' }}>
                              <input
                                type="text"
                                value={displayValue}
                                onChange={(e) => updateListingFieldSelection(gi, label, e.target.value)}
                                placeholder="Select or enter"
                                list={`${label}-${gi}-row-options`}
                                className="row-input field-input"
                                style={{ color: '#000' }}
                              />
                              <datalist id={`${label}-${gi}-row-options`}>
                                {options.map((opt, idx) => (
                                  <option key={idx} value={opt}>{opt}</option>
                                ))}
                              </datalist>
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={displayValue}
                              onChange={(e) => updateListingFieldSelection(gi, label, e.target.value)}
                              placeholder="Enter value"
                              className="row-input field-input"
                              style={{ color: '#000' }}
                            />
                          )}
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

// Main App Component
function AppContent() {
  const { state, dispatch } = useAppState();
  const { selectedPolicies } = useEbayAuth(); // Get eBay policies
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

  // Modified handleGenerateListing to include eBay policies
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

      // Prepare options for API call - include eBay policies
      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(fieldSelections, price, sku, selectedPolicies);   
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
                SelectedCategoryOptions: selectedCategoryOptions // Now includes eBay policies
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
// Updated EbayCallback component in App.jsx
const EbayCallback = () => {
  const { handleAuthCallback } = useEbayAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('=== EBAY CALLBACK COMPONENT MOUNTED ===');
    console.log('Current URL:', window.location.href);
    console.log('Timestamp:', new Date().toISOString());
    
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const error = urlParams.get('error');
    const state = urlParams.get('state');
    const errorDescription = urlParams.get('error_description');
    
    console.log('URL Parameters parsed:');
    console.log('  code:', authCode ? `${authCode.substring(0, 10)}... (${authCode.length} chars)` : 'null');
    console.log('  error:', error);
    console.log('  state:', state);
    console.log('  error_description:', errorDescription);
    
    // Check if we've already processed this callback
    const processedKey = `ebay_callback_processed_${authCode || error || 'unknown'}`;
    const alreadyProcessed = sessionStorage.getItem(processedKey);
    
    if (alreadyProcessed) {
      console.warn('=== CALLBACK ALREADY PROCESSED ===');
      console.warn('This callback was already handled. Redirecting to home...');
      setError('This authorization has already been processed. Please try logging in again.');
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
      return;
    }

    if (error) {
      console.error('=== OAUTH ERROR RECEIVED ===');
      console.error('Error:', error);
      console.error('Error Description:', errorDescription);
      
      // Mark as processed
      sessionStorage.setItem(processedKey, 'true');
      
      // Redirect back to main app with error
      const errorParam = encodeURIComponent(errorDescription || error);
      console.log('Redirecting to main app with error:', errorParam);
      window.location.href = '/?ebay_error=' + errorParam;
      return;
    }

    if (authCode) {
      console.log('=== AUTHORIZATION CODE RECEIVED ===');
      console.log('Processing authorization code...');
      
      // Mark as processed immediately to prevent double processing
      sessionStorage.setItem(processedKey, 'true');
      
      // Set a timeout for the exchange process
      const exchangeTimeout = setTimeout(() => {
        console.error('Token exchange timeout after 30 seconds');
        setError('The authentication process timed out. Please try again.');
        setTimeout(() => {
          window.location.href = '/?ebay_error=timeout';
        }, 3000);
      }, 30000); // 30 second timeout
      
      handleAuthCallback(authCode).then(success => {
        clearTimeout(exchangeTimeout);
        console.log('handleAuthCallback completed, success:', success);
        
        if (success) {
          console.log('Authentication successful, redirecting to main app');
          // Small delay to ensure tokens are stored
          setTimeout(() => {
            window.location.href = '/?ebay_connected=true';
          }, 100);
        } else {
          console.log('Authentication failed, redirecting with error');
          window.location.href = '/?ebay_error=authentication_failed';
        }
      }).catch(callbackError => {
        clearTimeout(exchangeTimeout);
        console.error('handleAuthCallback threw an error:', callbackError);
        
        // Check for specific error types
        if (callbackError.message.includes('already been used')) {
          setError('This authorization code has already been used. Please log in again.');
        } else if (callbackError.message.includes('invalid_grant')) {
          setError('The authorization has expired or is invalid. Please try logging in again.');
        } else {
          setError(`Authentication failed: ${callbackError.message}`);
        }
        
        setTimeout(() => {
          window.location.href = '/?ebay_error=' + encodeURIComponent(callbackError.message || 'callback_error');
        }, 3000);
      });
    } else {
      console.warn('=== NO CODE OR ERROR RECEIVED ===');
      console.warn('Invalid callback state');
      window.location.href = '/?ebay_error=invalid_callback';
    }
  }, [handleAuthCallback]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      padding: '20px'
    }}>
      {error ? (
        <>
          <div style={{
            color: '#dc3545',
            fontSize: '1.2rem',
            marginBottom: '1rem',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            {error}
          </div>
          <p style={{ color: '#666' }}>Redirecting...</p>
        </>
      ) : (
        <>
          <div className="spinner">
            <div className="spinner-circle"></div>
          </div>
          <p>Processing eBay authentication...</p>
          <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '1rem' }}>
            This may take a few seconds...
          </p>
        </>
      )}
    </div>
  );
};

function App() {
  const pathname = window.location.pathname;
  if (pathname === '/ebay/callback' || pathname === '/ebay/callback/') {
    return (
      <EbayAuthProvider>
        <EbayCallback />
      </EbayAuthProvider>
    );
  }

  // Normal app rendering
  return (
    <EbayAuthProvider>
      <AppStateProvider>
        <AppContent />
      </AppStateProvider>
    </EbayAuthProvider>
  );
}

export default App;