// EbayListingManager.jsx - Enhanced component for creating and managing eBay listings
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
      
      // Format single result to match batch format
      const formattedResults = {
        successful: [],
        failed: [],
        drafts: [],
        total: 1,
        summary: {
          published: 0,
          drafts: 0,
          failed: 0
        }
      };

      if (result.success) {
        if (result.isDraft) {
          formattedResults.drafts.push(result);
          formattedResults.summary.drafts = 1;
        } else {
          formattedResults.successful.push(result);
          formattedResults.summary.published = 1;
        }
      } else {
        formattedResults.failed.push(result);
        formattedResults.summary.failed = 1;
      }
      
      setListingStatus({
        isListing: false,
        progress: 100,
        currentIndex: 1,
        total: 1,
        results: formattedResults,
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
                {!selectedPolicies.paymentPolicyId && !selectedPolicies.fulfillmentPolicyId && !selectedPolicies.returnPolicyId && (
                  <div className="policy-warning">
                    <p style={{ color: '#f57c00', fontSize: '0.9rem', margin: '10px 0' }}>
                      ⚠️ No business policies selected. Listings may be created as drafts if your eBay account doesn't have business policies enabled.
                    </p>
                  </div>
                )}
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
              <span className="stat-number">{listingStatus.results.summary.published}</span>
              <span className="stat-label">Published</span>
            </div>
            
            {listingStatus.results.summary.drafts > 0 && (
              <div className="result-stat draft">
                <span className="stat-number">{listingStatus.results.summary.drafts}</span>
                <span className="stat-label">Drafts</span>
              </div>
            )}
            
            <div className="result-stat failed">
              <span className="stat-number">{listingStatus.results.summary.failed}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {/* Successfully Published Listings */}
          {listingStatus.results.successful.length > 0 && (
            <div className="successful-listings">
              <h5>✅ Successfully Published ({listingStatus.results.successful.length}):</h5>
              <ul>
                {listingStatus.results.successful.map((item, index) => (
                  <li key={index}>
                    <span className="sku">{item.originalSku || item.sku}</span>
                    <span className="listing-id">Listing ID: {item.listingId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Draft Listings */}
          {listingStatus.results.drafts && listingStatus.results.drafts.length > 0 && (
            <div className="draft-listings">
              <h5>📝 Created as Drafts ({listingStatus.results.drafts.length}):</h5>
              <div className="draft-explanation">
                <p style={{ color: '#f57c00', fontSize: '0.9rem', marginBottom: '10px' }}>
                  These listings were created but need business policies to be published.
                </p>
              </div>
              <ul>
                {listingStatus.results.drafts.map((item, index) => (
                  <li key={index}>
                    <div className="draft-item">
                      <span className="sku">{item.originalSku || item.sku}</span>
                      <span className="offer-id">Offer ID: {item.offerId}</span>
                      <div className="draft-next-steps">
                        {item.nextSteps && (
                          <div className="next-steps">
                            <strong>Next Steps:</strong>
                            <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                              {item.nextSteps.map((step, stepIndex) => (
                                <li key={stepIndex} style={{ fontSize: '0.8rem' }}>{step}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              
              {/* Business Policy Help */}
              <div className="business-policy-help">
                <h6>How to enable business policies:</h6>
                <ol style={{ fontSize: '0.85rem', margin: '10px 0', paddingLeft: '20px' }}>
                  <li>Go to <strong>My eBay</strong> → <strong>Account</strong> → <strong>Site Preferences</strong></li>
                  <li>Find <strong>Selling preferences</strong></li>
                  <li>Turn on <strong>"Use business policies for my listings"</strong></li>
                  <li>Create your payment, shipping, and return policies</li>
                  <li>Come back and try listing again</li>
                </ol>
              </div>
            </div>
          )}

          {/* Failed Listings */}
          {listingStatus.results.failed.length > 0 && (
            <div className="failed-listings">
              <h5>❌ Failed to Create ({listingStatus.results.failed.length}):</h5>
              <ul>
                {listingStatus.results.failed.map((item, index) => (
                  <li key={index}>
                    <div className="failed-item">
                      <span className="sku">{item.originalSku || item.sku}</span>
                      <span className="error">{item.error}</span>
                      
                      {/* Show troubleshooting advice */}
                      {item.troubleshooting && item.troubleshooting.length > 0 && (
                        <div className="troubleshooting">
                          <strong>Troubleshooting:</strong>
                          <ul style={{ margin: '5px 0', paddingLeft: '20px' }}>
                            {item.troubleshooting.map((advice, adviceIndex) => (
                              <li key={adviceIndex} style={{ fontSize: '0.8rem' }}>{advice}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {/* Show retry option if available */}
                      {item.details?.canRetry && (
                        <div className="retry-info">
                          <p style={{ fontSize: '0.8rem', color: '#2196F3', margin: '5px 0' }}>
                            💡 {item.details.retryInstructions}
                          </p>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Overall Summary and Next Steps */}
          <div className="results-summary-text">
            <h6>Summary:</h6>
            <p>
              {listingStatus.results.summary.published > 0 && 
                `${listingStatus.results.summary.published} listings published successfully. `
              }
              {listingStatus.results.summary.drafts > 0 && 
                `${listingStatus.results.summary.drafts} listings created as drafts. `
              }
              {listingStatus.results.summary.failed > 0 && 
                `${listingStatus.results.summary.failed} listings failed to create.`
              }
            </p>
            
            {listingStatus.results.summary.drafts > 0 && (
              <div className="draft-summary-help">
                <p style={{ color: '#f57c00', fontSize: '0.9rem', fontWeight: 'bold' }}>
                  📝 Your draft listings are saved in eBay and can be published once you enable business policies.
                </p>
              </div>
            )}
          </div>

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