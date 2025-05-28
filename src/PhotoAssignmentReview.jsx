import React, { useState, useEffect, useRef } from 'react';
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';
import { getSelectedCategoryOptionsJSON } from './FormSection';
import { saveAs } from 'file-saver';
import EbayListingManager from './EbayListingManager';
import EbayAuth from './EbayAuth';

function PhotoAssignmentReview({ 
  photoListings, 
  onBack, 
  currentBatch,
  categoryFields = [],
  aiResolveCategoryFields = false,
  generatedListings: initialGeneratedListings = [],
  onGeneratedListingsChange,
  category,
  subCategory,
  categoryID
}) {
  const [selectedListing, setSelectedListing] = useState(null);
  const [selectedListingIndex, setSelectedListingIndex] = useState(null);
  const [generatedListings, setGeneratedListings] = useState(initialGeneratedListings);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [error, setError] = useState(null);
  const [showEbayListingManager, setShowEbayListingManager] = useState(false);
  const [showEbayAuth, setShowEbayAuth] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [searchTerms, setSearchTerms] = useState({});
  const dropdownRefs = useRef({});
  
  const { state, dispatch } = useAppState();
  const { isAuthenticated: ebayAuthenticated, selectedPolicies } = useEbayAuth();
  
  // Ensure categoryID is set in the state when component mounts
  useEffect(() => {
    if (categoryID && state.categoryID !== categoryID) {
      dispatch({ type: 'SET_CATEGORY_ID', payload: categoryID });
    }
  }, [categoryID, state.categoryID, dispatch]);
  
  // Sync with initial generated listings when they change from parent
  useEffect(() => {
    if (initialGeneratedListings.length > 0 && initialGeneratedListings !== generatedListings) {
      setGeneratedListings(initialGeneratedListings);
    }
  }, [initialGeneratedListings]);
  
  // Generate listings when component mounts or when photoListings change
  useEffect(() => {
    console.log('PhotoAssignmentReview mounted with categoryFields:', categoryFields);
    console.log('Initial generated listings:', initialGeneratedListings.length);
    console.log('Photo listings:', photoListings.length);
    
    // Check if we need to generate listings for new photoListings
    const existingListingIds = new Set(generatedListings.map(listing => listing.id));
    const newPhotoListings = photoListings.filter(photoListing => !existingListingIds.has(photoListing.id));
    
    if (newPhotoListings.length > 0) {
      generateListingsForNew(newPhotoListings);
    } else if (initialGeneratedListings.length === 0 && photoListings.length > 0) {
      generateListings();
    }
  }, [photoListings]);
  
  // Update parent when generatedListings change
  useEffect(() => {
    if (onGeneratedListingsChange && generatedListings.length > 0) {
      onGeneratedListingsChange(generatedListings);
    }
  }, [generatedListings, onGeneratedListingsChange]);
  
  // Select first listing by default when generated
  useEffect(() => {
    if (generatedListings.length > 0 && !selectedListing) {
      setSelectedListing(generatedListings[0]);
      setSelectedListingIndex(0);
    }
  }, [generatedListings]);
  
  // Generate listings for new photo listings (incremental)
  const generateListingsForNew = async (newPhotoListings) => {
    if (newPhotoListings.length === 0) return;
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setError(null);
    
    try {
      const newResults = [];
      const totalNewListings = newPhotoListings.length;
      
      // Prepare field selections with AI resolution if enabled
      const fieldSelections = state.fieldSelections || {};
      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections,
        state.price || currentBatch?.salePrice || '',
        '', // SKU will be set per listing
        ebayAuthenticated ? selectedPolicies : null
      );
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
        console.log('🤖 AI Category Fields enabled for new listings:', {
          aiResolveCategoryFields,
          categoryFieldsCount: categoryFields.length,
          selectedCategoryOptions
        });
      }
      
      // Process each new photo listing
      for (let i = 0; i < newPhotoListings.length; i++) {
        const listing = newPhotoListings[i];
        setGenerationProgress(Math.round(((i + 1) / totalNewListings) * 100));
        
        try {
          // Convert photos to base64 for API
          const base64Images = [];
          for (const photo of listing.photos) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            await new Promise((resolve) => {
              img.onload = () => {
                // Resize if needed
                const maxSize = 800;
                let width = img.width;
                let height = img.height;
                
                if (width > maxSize || height > maxSize) {
                  const ratio = Math.min(maxSize / width, maxSize / height);
                  width *= ratio;
                  height *= ratio;
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                base64Images.push(base64);
                resolve();
              };
              img.src = photo.url;
            });
          }
          
          // Call API to generate listing
          const response = await fetch(
            "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: state.category || currentBatch?.category,
                subCategory: state.subCategory || currentBatch?.subCategory,
                Base64Key: [base64Images],
                SelectedCategoryOptions: {
                  ...selectedCategoryOptions,
                  sku: listing.sku
                }
              })
            }
          );
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }
          
          const data = await response.json();
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          const result = Array.isArray(parsed) ? parsed[0] : parsed;
          
          console.log('🔍 API Response for new listing:', {
            sku: listing.sku,
            title: result.title,
            description: result.description,
            fieldSelections: result.fieldSelections,
            aiResolvedFields: result.aiResolvedFields,
            fullResult: result
          });
          
          // Merge AI resolved fields if available
          let finalFieldSelections = { ...fieldSelections };
          if (result.aiResolvedFields) {
            Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
              const currentValue = fieldSelections[fieldName];
              if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified") {
                  finalFieldSelections[fieldName] = aiValue.trim();
                }
              }
            });
          }
          
          // Create the listing object
          const generatedListing = {
            id: listing.id,
            title: result.title || `Listing for ${listing.sku}`,
            description: result.description || '',
            price: result.price || state.price || currentBatch?.salePrice || '',
            sku: listing.sku,
            photos: listing.photos,
            base64Images: base64Images,
            fieldSelections: finalFieldSelections,
            aiResolvedFields: result.aiResolvedFields || {},
            error: null
          };
          
          newResults.push(generatedListing);
          
        } catch (error) {
          console.error(`Error generating listing for ${listing.sku}:`, error);
          newResults.push({
            id: listing.id,
            title: 'Error generating title',
            description: 'Error generating description',
            price: currentBatch?.salePrice || '0.00',
            sku: listing.sku,
            photos: listing.photos,
            fieldSelections: {},
            aiResolvedFields: {},
            error: error.message
          });
        }
      }
      
      // Merge new results with existing listings
      const mergedResults = [...generatedListings, ...newResults];
      setGeneratedListings(mergedResults);
      setIsGenerating(false);
      
      // Update app state with all listings
      const responseData = mergedResults.map(listing => ({
        title: listing.title,
        description: listing.description,
        price: listing.price,
        sku: listing.sku,
        storedFieldSelections: listing.fieldSelections,
        aiResolvedFields: listing.aiResolvedFields,
        error: listing.error
      }));
      
      dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
      
      // Also update the parent component
      if (onGeneratedListingsChange) {
        onGeneratedListingsChange(mergedResults);
      }
      
    } catch (error) {
      console.error('Error generating new listings:', error);
      setError(error.message);
      setIsGenerating(false);
    }
  };
  
  const generateListings = async () => {
    setIsGenerating(true);
    setGenerationProgress(0);
    setError(null);
    
    try {
      const results = [];
      const totalListings = photoListings.length;
      
      // Prepare field selections with AI resolution if enabled
      const fieldSelections = state.fieldSelections || {};
      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections,
        state.price || currentBatch?.salePrice || '',
        '', // SKU will be set per listing
        ebayAuthenticated ? selectedPolicies : null
      );
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
        console.log('🤖 AI Category Fields enabled for main generation:', {
          aiResolveCategoryFields,
          categoryFieldsCount: categoryFields.length,
          selectedCategoryOptions
        });
      }
      
      // Process each photo listing
      for (let i = 0; i < photoListings.length; i++) {
        const listing = photoListings[i];
        setGenerationProgress(Math.round(((i + 1) / totalListings) * 100));
        
        try {
          // Convert photos to base64 for API
          const base64Images = [];
          for (const photo of listing.photos) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            await new Promise((resolve) => {
              img.onload = () => {
                // Resize if needed
                const maxSize = 800;
                let width = img.width;
                let height = img.height;
                
                if (width > maxSize || height > maxSize) {
                  const ratio = Math.min(maxSize / width, maxSize / height);
                  width *= ratio;
                  height *= ratio;
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                base64Images.push(base64);
                resolve();
              };
              img.src = photo.url;
            });
          }
          
          // Call API to generate listing
          const response = await fetch(
            "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: state.category || currentBatch?.category,
                subCategory: state.subCategory || currentBatch?.subCategory,
                Base64Key: [base64Images],
                SelectedCategoryOptions: {
                  ...selectedCategoryOptions,
                  sku: listing.sku
                }
              })
            }
          );
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }
          
          const data = await response.json();
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          const result = Array.isArray(parsed) ? parsed[0] : parsed;
          
          console.log('🔍 API Response for main listing:', {
            sku: listing.sku,
            title: result.title,
            description: result.description,
            fieldSelections: result.fieldSelections,
            aiResolvedFields: result.aiResolvedFields,
            fullResult: result
          });
          
          // Merge AI resolved fields if available
          let finalFieldSelections = { ...fieldSelections };
          if (result.aiResolvedFields) {
            Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
              const currentValue = fieldSelections[fieldName];
              if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified") {
                  finalFieldSelections[fieldName] = aiValue.trim();
                }
              }
            });
          }
          
          results.push({
            id: listing.id,
            sku: listing.sku,
            photos: listing.photos,
            base64Images: base64Images,
            title: result.title || `Listing ${i + 1}`,
            description: result.description || '',
            price: state.price || currentBatch?.salePrice || '',
            fieldSelections: finalFieldSelections,
            aiResolvedFields: result.aiResolvedFields || {},
            error: result.error || null
          });
          
        } catch (error) {
          console.error(`Error generating listing ${i + 1}:`, error);
          results.push({
            id: listing.id,
            sku: listing.sku,
            photos: listing.photos,
            title: `Error: Listing ${i + 1}`,
            description: error.message,
            error: true
          });
        }
      }
      
      setGeneratedListings(results);
      setIsGenerating(false);
      
      // Update app state with generated listings
      const responseData = results.map(listing => ({
        title: listing.title,
        description: listing.description,
        price: listing.price,
        sku: listing.sku,
        storedFieldSelections: listing.fieldSelections,
        aiResolvedFields: listing.aiResolvedFields,
        error: listing.error
      }));
      
      dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
      
      // Also update the parent component
      if (onGeneratedListingsChange) {
        onGeneratedListingsChange(results);
      }
      
    } catch (error) {
      console.error('Error generating listings:', error);
      setError(error.message);
      setIsGenerating(false);
    }
  };
  
  const handleListingSelect = (listing, index) => {
    setSelectedListing(listing);
    setSelectedListingIndex(index);
  };
  
  const updateListing = (field, value) => {
    if (!selectedListing) return;
    
    const updatedListing = {
      ...selectedListing,
      [field]: value
    };
    
    const updatedListings = [...generatedListings];
    updatedListings[selectedListingIndex] = updatedListing;
    setGeneratedListings(updatedListings);
    setSelectedListing(updatedListing);
    
    // Update app state
    const responseData = updatedListings.map(listing => ({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      sku: listing.sku,
      storedFieldSelections: listing.fieldSelections,
      aiResolvedFields: listing.aiResolvedFields,
      error: listing.error
    }));
    
    dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
    
    // Also update the parent component
    if (onGeneratedListingsChange) {
      onGeneratedListingsChange(updatedListings);
    }
  };
  
  const updateFieldSelection = (field, value) => {
    if (!selectedListing) return;
    
    const updatedListing = {
      ...selectedListing,
      fieldSelections: {
        ...selectedListing.fieldSelections,
        [field]: value
      }
    };
    
    const updatedListings = [...generatedListings];
    updatedListings[selectedListingIndex] = updatedListing;
    setGeneratedListings(updatedListings);
    setSelectedListing(updatedListing);
    
    // Update app state
    const responseData = updatedListings.map(listing => ({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      sku: listing.sku,
      storedFieldSelections: listing.fieldSelections,
      aiResolvedFields: listing.aiResolvedFields,
      error: listing.error
    }));
    
    dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
    
    // Also update the parent component
    if (onGeneratedListingsChange) {
      onGeneratedListingsChange(updatedListings);
    }
  };
  
  const downloadCSV = () => {
    if (generatedListings.length === 0) return;
    
    // Create CSV header
    const headers = ['Title', 'Description', 'Price', 'SKU'];
    
    // Add category field headers
    if (categoryFields.length > 0) {
      categoryFields.forEach(field => {
        headers.push(field.FieldLabel);
      });
    }
    
    // Create CSV rows
    const rows = generatedListings.map(listing => {
      const row = [
        listing.title,
        listing.description.replace(/"/g, '""'), // Escape quotes
        listing.price,
        listing.sku
      ];
      
      // Add category field values
      if (categoryFields.length > 0) {
        categoryFields.forEach(field => {
          const value = listing.fieldSelections[field.FieldLabel] || '';
          row.push(value);
        });
      }
      
      return row;
    });
    
    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    saveAs(blob, `${currentBatch?.name || 'listings'}_${new Date().toISOString().split('T')[0]}.csv`);
  };
  
  
  const handleEbayListingsCreated = (count) => {
    console.log(`${count} listings created on eBay`);
    // You can add additional handling here if needed
  };
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '15px'
      }}>
        <div>
          <h2 style={{ margin: '0 0 5px 0', color: '#333' }}>
            📋 Review & Finalize Listings
          </h2>
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
            {isGenerating 
              ? `Generating listings... ${generationProgress}%` 
              : `${generatedListings.length} listings ready`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            ← Back to Photo Assignment
          </button>
          {!isGenerating && generatedListings.length > 0 && (
            <>
              <button
                onClick={downloadCSV}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                📄 Download CSV
              </button>
              {ebayAuthenticated ? (
                <button
                  onClick={() => setShowEbayListingManager(true)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🛒 List on eBay
                </button>
              ) : (
                <button
                  onClick={() => setShowEbayAuth(true)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🔗 Connect eBay Account
                </button>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      {error ? (
        <div style={{
          backgroundColor: '#f8d7da',
          color: '#721c24',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <strong>Error:</strong> {error}
        </div>
      ) : isGenerating ? (
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚙️</div>
            <h3>Generating Listings...</h3>
            <div style={{
              width: '300px',
              height: '20px',
              backgroundColor: '#e0e0e0',
              borderRadius: '10px',
              overflow: 'hidden',
              marginTop: '20px'
            }}>
              <div style={{
                width: `${generationProgress}%`,
                height: '100%',
                backgroundColor: '#007bff',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <p style={{ marginTop: '10px', color: '#666' }}>
              {generationProgress}% Complete
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '350px 1fr',
          gap: '20px',
          minHeight: 0
        }}>
          {/* Left Column - Listing List */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', color: '#333' }}>
              Listings
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {generatedListings.map((listing, index) => (
                <div
                  key={listing.id}
                  onClick={() => handleListingSelect(listing, index)}
                  style={{
                    padding: '15px',
                    border: `2px solid ${selectedListing?.id === listing.id ? '#007bff' : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: selectedListing?.id === listing.id ? '#f0f8ff' : 'white',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Thumbnail */}
                    {listing.photos.length > 0 && (
                      <img
                        src={listing.photos[0].url}
                        alt="Listing thumbnail"
                        style={{
                          width: '60px',
                          height: '60px',
                          objectFit: 'cover',
                          borderRadius: '6px'
                        }}
                      />
                    )}
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{
                        margin: '0 0 4px 0',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: listing.error ? '#dc3545' : '#333',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {listing.title}
                      </h4>
                      <p style={{
                        margin: '0 0 4px 0',
                        fontSize: '12px',
                        color: '#666',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}>
                        {listing.description}
                      </p>
                      <div style={{ fontSize: '11px', color: '#999' }}>
                        SKU: {listing.sku} • ${listing.price} • {listing.photos.length} photos
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Right Column - Listing Details */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            overflowY: 'auto'
          }}>
            {selectedListing ? (
              <div>
                <h3 style={{ margin: '0 0 20px 0', fontSize: '24px', color: '#333' }}>
                  Listing Details
                </h3>
                
                {/* Images */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                    Images
                  </h4>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: '10px'
                  }}>
                    {selectedListing.photos.map((photo, index) => (
                      <img
                        key={photo.id}
                        src={photo.url}
                        alt={`Image ${index + 1}`}
                        style={{
                          width: '100%',
                          height: '120px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: '1px solid #e0e0e0'
                        }}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Title */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>Title</h4>
                  <input
                    type="text"
                    value={selectedListing.title}
                    onChange={(e) => updateListing('title', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      fontSize: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '6px'
                    }}
                  />
                </div>
                
                {/* Details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>SKU</h4>
                    <input
                      type="text"
                      value={selectedListing.sku}
                      onChange={(e) => updateListing('sku', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        fontSize: '14px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>Price</h4>
                    <input
                      type="text"
                      value={selectedListing.price}
                      onChange={(e) => updateListing('price', e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: '100%',
                        padding: '8px',
                        fontSize: '14px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                
                {/* Description */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                    Description
                  </h4>
                  <textarea
                    value={selectedListing.description}
                    onChange={(e) => updateListing('description', e.target.value)}
                    rows={10}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      resize: 'vertical'
                    }}
                  />
                </div>
                
                {/* Category Fields */}
                {categoryFields && categoryFields.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                      Category Fields
                    </h4>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr',
                      gap: '15px',
                      padding: '15px',
                      backgroundColor: '#34495e',
                      borderRadius: '6px',
                      border: '1px solid #555'
                    }}>
                      {categoryFields.map((field) => {
                        const value = (selectedListing.fieldSelections && selectedListing.fieldSelections[field.FieldLabel]) || '';
                        const options = field.CategoryOptions ? field.CategoryOptions.split(';').map(opt => opt.trim()) : [];
                        
                        return (
                          <div key={field.FieldLabel}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500', color: 'white' }}>
                              {field.FieldLabel}
                              {selectedListing.aiResolvedFields && 
                               selectedListing.aiResolvedFields[field.FieldLabel] && 
                               selectedListing.aiResolvedFields[field.FieldLabel] === value && (
                                <span style={{ marginLeft: '5px', color: '#007bff', fontSize: '12px' }}>
                                  (AI)
                                </span>
                              )}
                            </label>
                            {/* Custom Type-ahead Dropdown */}
                            <div style={{ position: 'relative' }}>
                              <input
                                ref={(el) => dropdownRefs.current[field.FieldLabel] = el}
                                type="text"
                                value={value}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  updateFieldSelection(field.FieldLabel, newValue);
                                  setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: newValue }));
                                  if (options.length > 0) {
                                    setOpenDropdown(field.FieldLabel);
                                  }
                                }}
                                onFocus={() => {
                                  if (options.length > 0) {
                                    setOpenDropdown(field.FieldLabel);
                                    setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: value }));
                                  }
                                }}
                                onBlur={() => {
                                  // Delay closing to allow for option selection
                                  setTimeout(() => setOpenDropdown(null), 150);
                                }}
                                placeholder={options.length > 0 ? "Type to search or select..." : "Enter value..."}
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  fontSize: '14px',
                                  border: '1px solid #555',
                                  borderRadius: '4px',
                                  backgroundColor: '#2c3e50',
                                  color: 'white',
                                  '::placeholder': {
                                    color: '#bdc3c7'
                                  }
                                }}
                              />
                              {options.length > 0 && openDropdown === field.FieldLabel && (
                                <div style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  maxHeight: '200px',
                                  overflowY: 'auto',
                                  backgroundColor: '#34495e',
                                  border: '1px solid #555',
                                  borderRadius: '4px',
                                  borderTop: 'none',
                                  zIndex: 1000,
                                  boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                                }}>
                                  {options
                                    .filter(opt => 
                                      opt.toLowerCase().includes((searchTerms[field.FieldLabel] || '').toLowerCase())
                                    )
                                    .map((opt, idx) => (
                                      <div
                                        key={idx}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          updateFieldSelection(field.FieldLabel, opt);
                                          setOpenDropdown(null);
                                          setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: opt }));
                                        }}
                                        style={{
                                          padding: '8px 12px',
                                          cursor: 'pointer',
                                          backgroundColor: opt === value ? '#3498db' : 'transparent',
                                          color: 'white',
                                          fontSize: '14px',
                                          borderBottom: '1px solid #555'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.target.style.backgroundColor = '#3498db';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.target.style.backgroundColor = opt === value ? '#3498db' : 'transparent';
                                        }}
                                      >
                                        {opt}
                                      </div>
                                    ))
                                  }
                                  {options
                                    .filter(opt => 
                                      opt.toLowerCase().includes((searchTerms[field.FieldLabel] || '').toLowerCase())
                                    ).length === 0 && (
                                    <div style={{
                                      padding: '8px 12px',
                                      color: '#bdc3c7',
                                      fontSize: '14px',
                                      fontStyle: 'italic'
                                    }}>
                                      No matching options (you can still type your own value)
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: '#999'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '10px' }}>📋</div>
                  <p>Select a listing to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* eBay Listing Manager Modal */}
      {showEbayListingManager && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <EbayListingManager 
              onClose={() => setShowEbayListingManager(false)}
              onListingsCreated={handleEbayListingsCreated}
            />
          </div>
        </div>
      )}
      
      {/* eBay Auth Modal */}
      {showEbayAuth && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1001
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowEbayAuth(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666'
              }}
            >
              ×
            </button>
            <h2 style={{ margin: '0 0 20px 0', color: '#333' }}>
              Connect Your eBay Account
            </h2>
            <EbayAuth 
              onAuthSuccess={() => {
                console.log('eBay authentication successful');
                setShowEbayAuth(false);
              }}
              onAuthError={(error) => {
                console.error('eBay authentication error:', error);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default PhotoAssignmentReview;