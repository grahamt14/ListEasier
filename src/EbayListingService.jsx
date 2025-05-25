// EbayListingService.jsx - Fixed version with proper location handling
import EbayOAuthService from './EbayOAuthService';

class EbayListingService {
  constructor() {
    this.ebayOAuthService = new EbayOAuthService();
    this.createListingEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-create-listing';
    this.batchSize = 5;
    this.delayBetweenListings = 1000;
  }

  /**
   * Parse CSV data from the PreviewSection component
   */
  formatListingForEbay(listing, imageUrls, metadata, categoryId, selectedPolicies) {
    // Extract category fields and convert to eBay aspects format
    const aspectsData = {};
    
    if (listing.storedFieldSelections) {
      Object.entries(listing.storedFieldSelections).forEach(([key, value]) => {
        if (key !== 'price' && key !== 'sku' && value && value !== '-- Select --') {
          aspectsData[key] = [value];
        }
      });
    }

    return {
      sku: metadata.sku || `SKU-${Date.now()}`,
      title: listing.title || 'No Title',
      description: listing.description || 'No Description',
      categoryId: categoryId,
      price: parseFloat(metadata.price) || 9.99,
      quantity: 1,
      imageUrls: imageUrls.filter(url => url && url.includes('http')),
      condition: 'NEW',
      policies: {
        paymentPolicyId: selectedPolicies?.paymentPolicyId,
        fulfillmentPolicyId: selectedPolicies?.fulfillmentPolicyId,
        returnPolicyId: selectedPolicies?.returnPolicyId
      },
      aspectsData: aspectsData,
      // Add proper location data - this is crucial for eBay
      location: {
        country: 'US',
        postalCode: '90210', // Default US postal code
        stateOrProvince: 'CA'
      }
    };
  }

  /**
   * Create a single eBay listing
   */
  async createSingleListing(listingData) {
    try {
      const accessToken = await this.ebayOAuthService.getValidAccessToken();
      const environment = this.ebayOAuthService.environment;
      const marketplaceId = this.ebayOAuthService.getMarketplace();

      console.log('Creating eBay listing with data:', {
        sku: listingData.sku,
        title: listingData.title?.substring(0, 50) + '...',
        categoryId: listingData.categoryId,
        price: listingData.price,
        hasLocation: !!listingData.location,
        policies: listingData.policies
      });

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

      if (!response.ok) {
        const errorText = await response.text();
        console.error('HTTP Error:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        console.error('eBay API Error:', result);
        throw new Error(result.error || result.message || 'Failed to create listing');
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

    if (results.total === 0) {
      throw new Error('No valid listings found to create');
    }

    console.log(`Creating ${results.total} eBay listings...`);

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