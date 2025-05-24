// EbayListingManager.jsx - Component for creating and managing eBay listings
import React, { useState } from 'react';
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';
import EbayListingService from './EbayListingService';
import './EbayListingManager.css';

const EbayListingManager = ({ onClose }) => {
  const { state } = useAppState();
  const { isAuthenticated, selectedPolicies } = useEbayAuth();
  const [listingStatus, setListingStatus] = useState({
    isListing: false,
    progress: 0,
    currentIndex: 0,
    total: 0,
    results: null,
    error: null
  });
  
  const listingService = new EbayListingService();

  // Check if we can create listings
  const canCreateListings = () => {
    if (!isAuthenticated) return { can: false, reason: 'Not connected to eBay' };
    if (!state.categoryID) return { can: false, reason: 'No eBay category ID available' };
    
    const hasValidListings = state.responseData.some((item, index) => 
      item && !item.error && state.s3ImageGroups[index]?.length > 0
    );
    
    if (!hasValidListings) return { can: false, reason: 'No valid listings to create' };
    
    return { can: true };
  };

  const { can: canList, reason } = canCreateListings();

  // Create all listings
  const handleCreateAllListings = async () => {
    setListingStatus({
      isListing: true,
      progress: 0,
      currentIndex: 0,
      total: 0,
      results: null,
      error: null
    });

    try {
      const results = await listingService.createMultipleListings({
        responseData: state.responseData,
        imageGroups: state.imageGroups,
        s3ImageGroups: state.s3ImageGroups,
        groupMetadata: state.groupMetadata,
        categoryId: state.categoryID,
        selectedPolicies: selectedPolicies,
        progressCallback: (current, total) => {
          setListingStatus(prev => ({
            ...prev,
            currentIndex: current,
            total: total,
            progress: Math.round((current / total) * 100)
          }));
        }
      });

      setListingStatus(prev => ({
        ...prev,
        isListing: false,
        results: results
      }));
    } catch (error) {
      console.error('Error creating listings:', error);
      setListingStatus(prev => ({
        ...prev,
        isListing: false,
        error: error.message
      }));
    }
  };

  // Create single listing
  const handleCreateSingleListing = async (groupIndex) => {
    setListingStatus({
      isListing: true,
      progress: 0,
      currentIndex: 0,
      total: 1,
      results: null,
      error: null
    });

    try {
      const result = await listingService.createListingFromGroup(groupIndex, state);
      
      setListingStatus({
        isListing: false,
        progress: 100,
        currentIndex: 1,
        total: 1,
        results: {
          successful: result.success ? [result] : [],
          failed: result.success ? [] : [result],
          total: 1
        },
        error: null
      });
    } catch (error) {
      console.error('Error creating listing:', error);
      setListingStatus(prev => ({
        ...prev,
        isListing: false,
        error: error.message
      }));
    }
  };

  return (
    <div className="ebay-listing-manager">
      <div className="listing-manager-header">
        <h3>Create eBay Listings</h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      {!canList && (
        <div className="warning-message">
          <p>⚠️ {reason}</p>
        </div>
      )}

      {canList && !listingStatus.results && (
        <div className="listing-options">
          <div className="listing-summary">
            <h4>Ready to Create Listings</h4>
            <p>You have {state.responseData.filter(item => item && !item.error).length} listings ready to be created on eBay.</p>
            
            {selectedPolicies && (
              <div className="policy-summary">
                <h5>Selected Policies:</h5>
                <ul>
                  {selectedPolicies.paymentPolicyId && <li>✓ Payment policy selected</li>}
                  {selectedPolicies.fulfillmentPolicyId && <li>✓ Shipping policy selected</li>}
                  {selectedPolicies.returnPolicyId && <li>✓ Return policy selected</li>}
                </ul>
              </div>
            )}
          </div>

          <div className="action-buttons">
            <button 
              className="create-all-button"
              onClick={handleCreateAllListings}
              disabled={listingStatus.isListing}
            >
              Create All Listings
            </button>
          </div>
        </div>
      )}

      {listingStatus.isListing && (
        <div className="listing-progress">
          <h4>Creating Listings...</h4>
          <div className="progress-info">
            <p>Processing listing {listingStatus.currentIndex} of {listingStatus.total}</p>
            <div className="progress-bar-container">
              <div 
                className="progress-bar" 
                style={{ width: `${listingStatus.progress}%` }}
              />
            </div>
            <p className="progress-percentage">{listingStatus.progress}%</p>
          </div>
        </div>
      )}

      {listingStatus.results && (
        <div className="listing-results">
          <h4>Listing Creation Complete</h4>
          
          <div className="results-summary">
            <div className="result-stat success">
              <span className="stat-number">{listingStatus.results.successful.length}</span>
              <span className="stat-label">Successful</span>
            </div>
            <div className="result-stat failed">
              <span className="stat-number">{listingStatus.results.failed.length}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {listingStatus.results.successful.length > 0 && (
            <div className="successful-listings">
              <h5>Successfully Created:</h5>
              <ul>
                {listingStatus.results.successful.map((item, index) => (
                  <li key={index}>
                    <span className="sku">{item.sku}</span>
                    <span className="listing-id">Listing ID: {item.listingId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {listingStatus.results.failed.length > 0 && (
            <div className="failed-listings">
              <h5>Failed to Create:</h5>
              <ul>
                {listingStatus.results.failed.map((item, index) => (
                  <li key={index}>
                    <span className="sku">{item.sku}</span>
                    <span className="error">{item.error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="close-results-button" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {listingStatus.error && (
        <div className="error-message">
          <p>❌ Error: {listingStatus.error}</p>
          <button onClick={() => setListingStatus(prev => ({ ...prev, error: null }))}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
};

// Component to add to each listing card for individual listing creation
export const CreateListingButton = ({ groupIndex, disabled = false }) => {
  const [showManager, setShowManager] = useState(false);
  const { isAuthenticated } = useEbayAuth();
  const listingService = new EbayListingService();

  if (!isAuthenticated) return null;

  return (
    <>
      <button 
        className="create-listing-button"
        onClick={() => setShowManager(true)}
        disabled={disabled}
        title="Create this listing on eBay"
      >
        List on eBay
      </button>
      
      {showManager && (
        <div className="listing-modal-overlay">
          <div className="listing-modal">
            <EbayListingManager 
              onClose={() => setShowManager(false)}
              singleListingIndex={groupIndex}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default EbayListingManager;