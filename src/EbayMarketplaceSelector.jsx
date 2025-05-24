import React from 'react';
import { useEbayAuth } from './EbayAuthContext';

const EbayMarketplaceSelector = () => {
  const { ebayService, selectedMarketplace, refreshPolicies } = useEbayAuth();
  
  const marketplaces = ebayService?.getAllMarketplaces() || {};
  const currentMarketplace = selectedMarketplace || ebayService?.getMarketplace() || 'EBAY_US';
  
  const handleMarketplaceChange = async (e) => {
    const newMarketplace = e.target.value;
    
    // Update the marketplace in the service
    ebayService.setMarketplace(newMarketplace);
    
    // Refresh business policies for the new marketplace
    try {
      await refreshPolicies();
    } catch (error) {
      console.error('Error refreshing policies for new marketplace:', error);
    }
  };
  
  return (
    <div className="marketplace-selector">
      <label className="marketplace-label">
        <span className="marketplace-icon">🌍</span>
        eBay Marketplace:
      </label>
      <select 
        value={currentMarketplace}
        onChange={handleMarketplaceChange}
        className="marketplace-select"
      >
        {Object.entries(marketplaces).map(([id, market]) => (
          <option key={id} value={id}>
            {market.name} ({market.currency})
          </option>
        ))}
      </select>
    </div>
  );
};

export default EbayMarketplaceSelector;