// EbayListingManager.jsx - Complete with Environment-Aware URLs
import React, { useState } from 'react';
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';
import EbayListingService from './EbayListingService';
import './EbayListingManager.css';

const EbayListingManager = ({ onClose }) => {
  const { state } = useAppState();
  const { isAuthenticated, selectedPolicies, ebayService } = useEbayAuth();
  const [listingStatus, setListingStatus] = useState({
    isListing: false,
    progress: 0,
    currentIndex: 0,
    total: 0,
    results: null,
    error: null
  });
  
  const listingService = new EbayListingService();

  // Get environment-aware eBay URLs
  const getEbayUrls = () => {
    const isSandbox = ebayService?.environment === 'sandbox';
    
    if (isSandbox) {
      return {
        viewListing: (listingId) => `https://www.sandbox.ebay.com/itm/${listingId}`,
        drafts: 'https://www.sandbox.ebay.com/sh/lst/drafts',
        active: 'https://www.sandbox.ebay.com/sh/lst/active'
      };
    } else {
      return {
        viewListing: (listingId) => `https://www.ebay.com/itm/${listingId}`,
        drafts: 'https://www.ebay.com/sh/lst/drafts',
        active: 'https://www.ebay.com/sh/lst/active'
      };
    }
  };

  const ebayUrls = getEbayUrls();

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

      // Debug logging
      console.log('=== LISTING RESULTS DEBUG ===');
      console.log('Environment:', ebayService?.environment || 'unknown');
      console.log('Full results object:', results);
      console.log('Successful array:', results.successful);
      console.log('Drafts array:', results.drafts);
      console.log('Failed array:', results.failed);
      console.log('Successful length:', results.successful?.length || 0);
      console.log('Drafts length:', results.drafts?.length || 0);
      console.log('Failed length:', results.failed?.length || 0);
      console.log('Summary:', results.summary);
      console.log('eBay URLs:', ebayUrls);
      if (results.successful?.length > 0) {
        console.log('First successful item:', results.successful[0]);
      }
      if (results.drafts?.length > 0) {
        console.log('First draft item:', results.drafts[0]);
      }
      console.log('=== END DEBUG ===');

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
          successful: result.success && !result.isDraft ? [result] : [],
          drafts: result.success && result.isDraft ? [result] : [],
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

  // Get total created count (successful + drafts)
  const getTotalCreatedCount = () => {
    return (listingStatus.results?.successful?.length || 0) + (listingStatus.results?.drafts?.length || 0);
  };

  // Determine what type of message to show
  const getStatusMessage = () => {
    const validCount = getValidListingsCount();
    const missingPolicies = getMissingPoliciesCount();
    
    if (missingPolicies > 0) {
      const environmentNote = ebayService?.environment === 'sandbox' ? ' (in sandbox)' : '';
      return {
        type: 'warning',
        title: 'Business Policies Required',
        message: `${missingPolicies} business policy type${missingPolicies > 1 ? 's are' : ' is'} missing. Listings will be created as drafts${environmentNote} that you can complete in eBay Seller Hub.`,
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
            
            {/* Show environment indicator */}
            {ebayService?.environment && (
              <div style={{ 
                background: ebayService.environment === 'sandbox' ? '#fff3cd' : '#d1edff', 
                border: `1px solid ${ebayService.environment === 'sandbox' ? '#ffc107' : '#0ea5e9'}`,
                borderRadius: '6px', 
                padding: '8px 12px', 
                margin: '10px 0',
                fontSize: '0.85rem',
                color: ebayService.environment === 'sandbox' ? '#856404' : '#0c4a6e'
              }}>
                <strong>Environment:</strong> {ebayService.environment === 'sandbox' ? '🧪 Sandbox (Testing)' : '🌐 Production (Live)'}
              </div>
            )}
            
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
                  You can complete them later in eBay Seller Hub{ebayService?.environment === 'sandbox' ? ' (sandbox)' : ''}.
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
              Create {getValidListingsCount()} Listing{getValidListingsCount() > 1 ? 's' : ''} on eBay{ebayService?.environment === 'sandbox' ? ' (Sandbox)' : ''}
            </button>
          </div>
        </div>
      )}

      {listingStatus.isListing && (
        <div className="listing-progress">
          <h4>Creating eBay Listings{ebayService?.environment === 'sandbox' ? ' (Sandbox)' : ''}...</h4>
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
              <span className="stat-number">{getTotalCreatedCount()}</span>
              <span className="stat-label">Created</span>
            </div>
            <div className="result-stat failed">
              <span className="stat-number">{listingStatus.results.failed?.length || 0}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {/* Debug info - remove this in production */}
          <div style={{ background: '#f0f0f0', padding: '10px', margin: '10px 0', fontSize: '12px', borderRadius: '4px' }}>
            <strong>Debug Info:</strong><br/>
            Environment: {ebayService?.environment || 'unknown'}<br/>
            Results object keys: {Object.keys(listingStatus.results || {}).join(', ')}<br/>
            Successful count: {listingStatus.results.successful?.length || 0}<br/>
            Drafts count: {listingStatus.results.drafts?.length || 0}<br/>
            Failed count: {listingStatus.results.failed?.length || 0}<br/>
            Total created: {getTotalCreatedCount()}<br/>
            Draft URLs: {ebayUrls.drafts}<br/>
            Active URLs: {ebayUrls.active}
          </div>

          {/* Success message for any created listings (published or drafts) */}
          {getTotalCreatedCount() > 0 && (
            <div className="status-message success">
              <span>🎉</span>
              <div>
                <strong>Success!</strong> {getTotalCreatedCount()} listing{getTotalCreatedCount() > 1 ? 's have' : ' has'} been created on eBay{ebayService?.environment === 'sandbox' ? ' sandbox' : ''}.
                {listingStatus.results.drafts?.length > 0 ? (
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
          )}

          {/* Show published listings */}
          {listingStatus.results.successful?.length > 0 && (
            <div className="successful-listings">
              <h5>✅ Published Listings:</h5>
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
                      <div className="listing-status">Live Listing</div>
                      {item.listingId && (
                        <a 
                          href={ebayUrls.viewListing(item.listingId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="view-listing-link"
                          title="View listing on eBay"
                        >
                          View on eBay
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Show draft listings */}
          {listingStatus.results.drafts?.length > 0 && (
            <div className="successful-listings">
              <h5>📝 Draft Listings Created:</h5>
              <ul>
                {listingStatus.results.drafts.map((item, index) => (
                  <li key={index}>
                    <div>
                      <div className="sku">{item.sku}</div>
                      {item.offerId && (
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                          Offer ID: {item.offerId}
                        </div>
                      )}
                      <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: '4px' }}>
                        {item.message || 'Created as draft - complete in Seller Hub'}
                      </div>
                    </div>
                    <div className="listing-actions">
                      <div className="listing-status">Draft Created</div>
                      <a 
                        href={ebayUrls.drafts}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="manage-draft-link"
                        title="Complete this draft in Seller Hub"
                      >
                        Complete Draft
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bulk action buttons */}
          {getTotalCreatedCount() > 0 && (
            <div className="bulk-actions">
              {listingStatus.results.successful?.length > 0 && (
                <a 
                  href={ebayUrls.active}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bulk-action-button view-all-listings"
                >
                  <span>📋</span>
                  View All My Listings
                </a>
              )}
              {listingStatus.results.drafts?.length > 0 && (
                <a 
                  href={ebayUrls.drafts}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bulk-action-button manage-drafts"
                >
                  <span>✏️</span>
                  Manage All Drafts
                </a>
              )}
            </div>
          )}

          {/* Show failed listings if any */}
          {listingStatus.results.failed?.length > 0 && (
            <div className="failed-listings">
              <h5>❌ Failed to Create:</h5>
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