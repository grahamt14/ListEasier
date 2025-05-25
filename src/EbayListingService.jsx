// EbayListingService.jsx - Fixed version with proper location management
import EbayOAuthService from './EbayOAuthService';

class EbayListingService {
  constructor() {
    this.ebayOAuthService = new EbayOAuthService();
    this.createListingEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-create-listing';
    this.batchSize = 5; // Process listings in batches to avoid rate limits
    this.delayBetweenListings = 1000; // 1 second delay between listings
    this.defaultLocationKey = 'warehouse-001'; // Use a consistent location key
  }

  /**
   * Ensure the seller has a valid inventory location set up
   * This is required before creating any offers
   */
  async ensureInventoryLocation() {
    try {
      console.log('Checking for existing inventory locations...');
      
      // First, check if we already have locations
      const locations = await this.ebayOAuthService.makeApiRequest('/sell/inventory/v1/location');
      
      if (locations && locations.locations && locations.locations.length > 0) {
        console.log(`Found ${locations.locations.length} existing inventory locations`);
        
        // Check if our default location exists
        const defaultLocation = locations.locations.find(loc => 
          loc.merchantLocationKey === this.defaultLocationKey
        );
        
        if (defaultLocation) {
          console.log('Default location already exists:', this.defaultLocationKey);
          return this.defaultLocationKey;
        }
        
        // Use the first available location
        const firstLocation = locations.locations[0];
        console.log('Using existing location:', firstLocation.merchantLocationKey);
        return firstLocation.merchantLocationKey;
      }
      
      // No locations exist, create a default warehouse location
      console.log('No inventory locations found, creating default location...');
      
      const locationData = {
        name: 'Default Warehouse Location',
        locationTypes: ['WAREHOUSE'],
        address: {
          addressLine1: '123 Main Street',
          city: 'San Jose',
          stateOrProvince: 'CA',
          postalCode: '95101',
          country: 'US'
        },
        merchantLocationStatus: 'ENABLED'
      };
      
      // Create the location
      await this.ebayOAuthService.makeApiRequest(
        `/sell/inventory/v1/location/${this.defaultLocationKey}`,
        {
          method: 'POST',
          body: locationData
        }
      );
      
      console.log('Successfully created default inventory location:', this.defaultLocationKey);
      return this.defaultLocationKey;
      
    } catch (error) {
      console.error('Error managing inventory location:', error);
      
      // If location creation fails, try to use any existing location
      try {
        const locations = await this.ebayOAuthService.makeApiRequest('/sell/inventory/v1/location');
        if (locations && locations.locations && locations.locations.length > 0) {
          const fallbackLocation = locations.locations[0].merchantLocationKey;
          console.log('Using fallback location:', fallbackLocation);
          return fallbackLocation;
        }
      } catch (fallbackError) {
        console.error('Could not retrieve fallback locations:', fallbackError);
      }
      
      // Last resort: use the default key and hope it works
      console.warn('Using default location key without verification:', this.defaultLocationKey);
      return this.defaultLocationKey;
    }
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
      description: listing.description || 'No Description',
      categoryId: categoryId,
      price: parseFloat(metadata.price) || 9.99,
      quantity: 1,
      imageUrls: imageUrls.filter(url => url && url.includes('http')),
      condition: 'NEW', // Default to NEW, can be made configurable
      policies: {
        paymentPolicyId: selectedPolicies.paymentPolicyId,
        fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId,
        returnPolicyId: selectedPolicies.returnPolicyId
      },
      aspectsData: aspectsData
    };
  }

  /**
   * Create a single eBay listing with proper location management
   * @param {Object} listingData - Formatted listing data
   * @returns {Promise<Object>} - Result of listing creation
   */
  async createSingleListing(listingData) {
    try {
      const accessToken = await this.ebayOAuthService.getValidAccessToken();
      const environment = this.ebayOAuthService.environment;
      const marketplaceId = this.ebayOAuthService.getMarketplace();

      // Ensure we have a valid inventory location before proceeding
      const merchantLocationKey = await this.ensureInventoryLocation();

      // Enhanced listing data with proper location
      const enhancedListingData = {
        ...listingData,
        merchantLocationKey: merchantLocationKey,
        // Add location-specific data
        location: {
          country: 'US', // This should match your inventory location
          postalCode: '95101' // This should match your inventory location
        }
      };

      console.log('Creating listing with location:', merchantLocationKey);

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
          listingData: enhancedListingData
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

    // Ensure inventory location is set up before processing any listings
    try {
      await this.ensureInventoryLocation();
    } catch (error) {
      console.error('Failed to ensure inventory location:', error);
      // Continue anyway - the individual listing creation will handle this
    }

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