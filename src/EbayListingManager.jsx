// EbayListingManager.jsx - Improved UI and messaging
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
    if (!isAuthenticated) return { can: false, reason: 'eBay account not connected' };
    if (!state.categoryID) return { can: false, reason: 'No eBay category selected' };
    
    const hasValidListings = state.responseData.some((item, index) => 
      item && !item.error && state.s3ImageGroups[index]?.length > 0
    );
    
    if (!hasValidListings) return { can: false, reason: 'No valid listings with images ready' };
    
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

  // Get count of valid listings
  const getValidListingsCount = () => {
    return state.responseData.filter(item => item && !item.error).length;
  };

  // Get count of missing policies
  const getMissingPoliciesCount = () => {
    let missing = 0;
    if (!selectedPolicies.paymentPolicyId) missing++;
    if (!selectedPolicies.fulfillmentPolicyId) missing++;
    if (!selectedPolicies.returnPolicyId) missing++;
    return missing;
  };

  // Determine what type of message to show
  const getStatusMessage = () => {
    const validCount = getValidListingsCount();
    const missingPolicies = getMissingPoliciesCount();
    
    if (missingPolicies > 0) {
      return {
        type: 'warning',
        title: 'Business Policies Required',
        message: `${missingPolicies} business policy type${missingPolicies > 1 ? 's are' : ' is'} missing. Listings will be created as drafts that you can complete in eBay Seller Hub.`,
        icon: '⚠️'
      };
    }
    
    if (validCount === 0) {
      return {
        type: 'info',
        title: 'No Listings Ready',
        message: 'Generate some listings first before creating them on eBay.',
        icon: 'ℹ️'
      };
    }
    
    return {
      type: 'success',
      title: 'Ready to List',
      message: `${validCount} listing${validCount > 1 ? 's are' : ' is'} ready to be created on eBay.`,
      icon: '🚀'
    };
  };

  const statusMessage = getStatusMessage();

  return (
    <div className="ebay-listing-manager">
      <div className="listing-manager-header">
        <h3>Create eBay Listings</h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>

      {!canList && (
        <div className="warning-message">
          <p>{reason}</p>
        </div>
      )}

      {canList && !listingStatus.results && (
        <div className="listing-options">
          <div className="listing-summary">
            <h4>{statusMessage.title}</h4>
            <p>{statusMessage.message}</p>
            
            <div className="policy-summary">
              <h5>eBay Business Policies:</h5>
              <ul>
                <li className={selectedPolicies.paymentPolicyId ? 'selected' : 'missing'}>
                  {selectedPolicies.paymentPolicyId ? '✓ Payment policy selected' : '⚠️ Payment policy missing'}
                </li>
                <li className={selectedPolicies.fulfillmentPolicyId ? 'selected' : 'missing'}>
                  {selectedPolicies.fulfillmentPolicyId ? '✓ Shipping policy selected' : '⚠️ Shipping policy missing'}
                </li>
                <li className={selectedPolicies.returnPolicyId ? 'selected' : 'missing'}>
                  {selectedPolicies.returnPolicyId ? '✓ Return policy selected' : '⚠️ Return policy missing'}
                </li>
              </ul>
            </div>

            {getMissingPoliciesCount() > 0 && (
              <div className="status-message info">
                <span>💡</span>
                <div>
                  <strong>Note:</strong> Listings without complete business policies will be created as drafts. 
                  You can complete them later in eBay Seller Hub.
                </div>
              </div>
            )}
          </div>

          <div className="action-buttons">
            <button 
              className="create-all-button"
              onClick={handleCreateAllListings}
              disabled={listingStatus.isListing}
            >
              Create {getValidListingsCount()} Listing{getValidListingsCount() > 1 ? 's' : ''} on eBay
            </button>
          </div>
        </div>
      )}

      {listingStatus.isListing && (
        <div className="listing-progress">
          <h4>Creating eBay Listings...</h4>
          <div className="progress-info">
            <p>Processing listing {listingStatus.currentIndex} of {listingStatus.total}</p>
            <div className="progress-bar-container">
              <div 
                className="progress-bar" 
                style={{ width: `${listingStatus.progress}%` }}
              />
            </div>
            <div className="progress-percentage">{listingStatus.progress}%</div>
            <p style={{ fontSize: '0.9rem', color: '#6b7280', marginTop: '12px' }}>
              This may take a few moments...
            </p>
          </div>
        </div>
      )}

      {listingStatus.results && (
        <div className="listing-results">
          <h4>Listing Creation Complete</h4>
          
          <div className="results-summary">
            <div className="result-stat success">
              <span className="stat-number">{listingStatus.results.successful.length}</span>
              <span className="stat-label">Created</span>
            </div>
            <div className="result-stat failed">
              <span className="stat-number">{listingStatus.results.failed.length}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {listingStatus.results.successful.length > 0 && (
            <>
              <div className="status-message success">
                <span>🎉</span>
                <div>
                  <strong>Success!</strong> {listingStatus.results.successful.length} listing{listingStatus.results.successful.length > 1 ? 's have' : ' has'} been created on eBay.
                  {getMissingPoliciesCount() > 0 ? (
                    <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>
                      These are currently <strong>drafts</strong>. Complete them in eBay Seller Hub to make them live.
                    </div>
                  ) : (
                    <div style={{ marginTop: '8px', fontSize: '0.9rem' }}>
                      Your listings are now <strong>live</strong> on eBay and ready for buyers!
                    </div>
                  )}
                  <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#065f46' }}>
                    💡 Tip: You can view and manage all your listings using the buttons below.
                  </div>
                </div>
              </div>

              <div className="successful-listings">
                <h5>Successfully Created Listings:</h5>
                <ul>
                  {listingStatus.results.successful.map((item, index) => (
                    <li key={index}>
                      <div>
                        <div className="sku">{item.sku}</div>
                        {item.listingId && (
                          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                            Listing ID: {item.listingId}
                          </div>
                        )}
                      </div>
                      <div className="listing-actions">
                        <div className="listing-status">
                          {getMissingPoliciesCount() > 0 ? 'Draft Created' : 'Live Listing'}
                        </div>
                        {item.listingId && (
                          <a 
                            href={`https://www.ebay.com/itm/${item.listingId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="view-listing-link"
                            title="View listing on eBay"
                          >
                            View on eBay
                          </a>
                        )}
                        {item.offerId && getMissingPoliciesCount() > 0 && (
                          <a 
                            href="https://www.ebay.com/sh/lst/drafts"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="manage-draft-link"
                            title="Complete this draft in Seller Hub"
                          >
                            Complete Draft
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Add bulk action buttons */}
              <div className="bulk-actions">
                {listingStatus.results.successful.some(item => item.listingId) && (
                  <a 
                    href="https://www.ebay.com/sh/lst/active"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bulk-action-button view-all-listings"
                  >
                    <span>📋</span>
                    View All My Listings
                  </a>
                )}
                {getMissingPoliciesCount() > 0 && listingStatus.results.successful.length > 0 && (
                  <a 
                    href="https://www.ebay.com/sh/lst/drafts"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bulk-action-button manage-drafts"
                  >
                    <span>✏️</span>
                    Manage All Drafts
                  </a>
                )}
              </div>
            </>
          )}

          {listingStatus.results.failed.length > 0 && (
            <div className="failed-listings">
              <h5>Failed to Create:</h5>
              <ul>
                {listingStatus.results.failed.map((item, index) => (
                  <li key={index}>
                    <div className="sku">{item.sku}</div>
                    <div className="error">{item.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button className="close-results-button" onClick={onClose}>
            Done
          </button>
        </div>
      )}

      {listingStatus.error && (
        <div className="error-message">
          <p><strong>Error Creating Listings:</strong></p>
          <p>{listingStatus.error}</p>
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