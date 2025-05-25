// EbayListingService.jsx - Service for creating eBay listings from CSV data
import EbayOAuthService from './EbayOAuthService';

class EbayListingService {
  constructor() {
    this.ebayOAuthService = new EbayOAuthService();
    this.createListingEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-create-listing';
    this.batchSize = 5; // Process listings in batches to avoid rate limits
    this.delayBetweenListings = 1000; // 1 second delay between listings
  }

  /**
   * Parse CSV data from the PreviewSection component
   * @param {Object} listing - Single listing data from responseData
   * @param {Array} imageUrls - S3 URLs for the listing images
   * @param {Object} metadata - Price and SKU metadata
   * @param {string} categoryId - eBay category ID
   * @param {Object} selectedPolicies - eBay business policies
   * @returns {Object} - Formatted listing data for eBay API
   */
  formatListingForEbay(listing, imageUrls, metadata, categoryId, selectedPolicies) {
    // Extract category fields and convert to eBay aspects format
    const aspectsData = {};
    
    if (listing.storedFieldSelections) {
      Object.entries(listing.storedFieldSelections).forEach(([key, value]) => {
        // Skip price and SKU as they're handled separately
        if (key !== 'price' && key !== 'sku' && value && value !== '-- Select --') {
          // eBay expects aspects as key-value pairs
          aspectsData[key] = [value]; // eBay expects array of values
        }
      });
    }

    return {
      sku: metadata.sku || `SKU-${Date.now()}`,
      title: listing.title || 'No Title',
      description: listing.description || listing.title || 'No Description', // Fallback to title
      categoryId: categoryId,
      price: parseFloat(metadata.price) || 9.99,
      quantity: 1,
      imageUrls: imageUrls.filter(url => url && url.includes('http')),
      condition: 'NEW', // Default to NEW, can be made configurable
      policies: {
        paymentPolicyId: selectedPolicies?.paymentPolicyId || null,
        fulfillmentPolicyId: selectedPolicies?.fulfillmentPolicyId || null,
        returnPolicyId: selectedPolicies?.returnPolicyId || null
      },
      aspectsData: aspectsData || {}
    };
  }

  /**
   * Create a single eBay listing
   * @param {Object} listingData - Formatted listing data
   * @returns {Promise<Object>} - Result of listing creation
   */
  async createSingleListing(listingData) {
    try {
      const accessToken = await this.ebayOAuthService.getValidAccessToken();
      const environment = this.ebayOAuthService.environment;
      const marketplaceId = this.ebayOAuthService.getMarketplace();

      const response = await fetch(this.createListingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          accessToken,
          environment,
          marketplaceId,
          listingData
        })
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to create listing');
      }

      return {
        success: true,
        listingId: result.listingId,
        sku: result.sku,
        message: result.message
      };
    } catch (error) {
      console.error('Error creating listing:', error);
      return {
        success: false,
        error: error.message,
        sku: listingData.sku
      };
    }
  }

  /**
   * Create multiple eBay listings from app state data
   * @param {Object} params - Parameters including listings data
   * @returns {Promise<Object>} - Results of all listing creations
   */
  async createMultipleListings({
    responseData,
    imageGroups,
    s3ImageGroups,
    groupMetadata,
    categoryId,
    selectedPolicies,
    progressCallback = () => {}
  }) {
    const results = {
      successful: [],
      failed: [],
      total: 0
    };

    // Filter valid listings
    const validListings = responseData
      .map((response, index) => ({ response, index }))
      .filter(item => 
        item.response && 
        !item.response.error && 
        s3ImageGroups[item.index] && 
        s3ImageGroups[item.index].length > 0
      );

    results.total = validListings.length;

    // Process listings in batches
    for (let i = 0; i < validListings.length; i += this.batchSize) {
      const batch = validListings.slice(i, i + this.batchSize);
      
      // Process batch in parallel
      const batchPromises = batch.map(async ({ response, index }) => {
        const metadata = groupMetadata[index] || { price: '9.99', sku: `SKU-${index}` };
        const imageUrls = s3ImageGroups[index] || [];
        
        const listingData = this.formatListingForEbay(
          response,
          imageUrls,
          metadata,
          categoryId,
          selectedPolicies
        );

        return this.createSingleListing(listingData);
      });

      const batchResults = await Promise.all(batchPromises);
      
      // Process results
      batchResults.forEach((result, batchIndex) => {
        const listingIndex = i + batchIndex;
        progressCallback(listingIndex + 1, results.total);
        
        if (result.success) {
          results.successful.push(result);
        } else {
          results.failed.push(result);
        }
      });

      // Add delay between batches to avoid rate limits
      if (i + this.batchSize < validListings.length) {
        await new Promise(resolve => setTimeout(resolve, this.delayBetweenListings));
      }
    }

    return results;
  }

  /**
   * Create a single listing from a specific group index
   * @param {number} groupIndex - Index of the group to list
   * @param {Object} appState - Current app state
   * @returns {Promise<Object>} - Result of listing creation
   */
  async createListingFromGroup(groupIndex, appState) {
    const {
      responseData,
      s3ImageGroups,
      groupMetadata,
      categoryID,
      selectedPolicies
    } = appState;

    const listing = responseData[groupIndex];
    if (!listing || listing.error) {
      throw new Error('Invalid listing data');
    }

    const metadata = groupMetadata[groupIndex] || { price: '9.99', sku: `SKU-${groupIndex}` };
    const imageUrls = s3ImageGroups[groupIndex] || [];

    if (imageUrls.length === 0) {
      throw new Error('No images available for this listing');
    }

    const listingData = this.formatListingForEbay(
      listing,
      imageUrls,
      metadata,
      categoryID,
      selectedPolicies
    );

    return this.createSingleListing(listingData);
  }

  /**
   * Validate if the service is ready to create listings
   * @returns {Object} - Validation result
   */
  validateReadiness() {
    const issues = [];

    if (!this.ebayOAuthService.isAuthenticated()) {
      issues.push('Not authenticated with eBay');
    }

    if (!this.ebayOAuthService.isConfigured()) {
      issues.push('eBay OAuth service not configured');
    }

    return {
      ready: issues.length === 0,
      issues
    };
  }
}

export default EbayListingService;