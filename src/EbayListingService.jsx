// EbayListingService.jsx - Enhanced service for creating eBay listings from CSV data
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
      aspectsData: aspectsData,
      location: {
        // Add user's location data here
        country: 'US', // Get from user settings
        postalCode: '90210' // Get from user settings
      }
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
        // Enhanced error handling for different response types
        let errorMessage = result.error || 'Failed to create listing';
        let errorDetails = result.details || {};
        let isDraft = result.isDraft || false;
        
        // Handle specific error scenarios
        if (result.step === 'publish_offer' && result.troubleshooting) {
          errorMessage = `Publishing failed: ${errorMessage}`;
          errorDetails.troubleshooting = result.troubleshooting;
          errorDetails.suggestions = result.suggestions;
          errorDetails.canRetry = result.canRetry;
        }
        
        // Handle business policy issues
        if (result.businessPolicyStatus === 'not_available') {
          errorMessage = `Business policies not enabled: ${errorMessage}`;
          errorDetails.nextSteps = result.nextSteps;
        }
        
        return {
          success: false,
          error: errorMessage,
          details: errorDetails,
          isDraft: isDraft,
          sku: listingData.sku,
          offerId: result.offerId || null,
          step: result.step || 'unknown'
        };
      }

      // Handle successful responses (including draft listings)
      return {
        success: true,
        listingId: result.listingId || null,
        offerId: result.offerId,
        sku: result.sku || result.originalSku,
        originalSku: result.originalSku,
        message: result.message,
        isDraft: result.isDraft || false,
        environment: result.environment,
        categoryUsed: result.categoryUsed,
        businessPolicyStatus: result.businessPolicyStatus,
        nextSteps: result.nextSteps || null,
        troubleshooting: result.troubleshooting || null
      };
    } catch (error) {
      console.error('Error creating listing:', error);
      return {
        success: false,
        error: error.message,
        sku: listingData.sku,
        step: 'network_error'
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
      drafts: [], // NEW: Track draft listings separately
      total: 0,
      summary: {
        published: 0,
        drafts: 0,
        failed: 0
      }
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
      
      // Process results with enhanced categorization
      batchResults.forEach((result, batchIndex) => {
        const listingIndex = i + batchIndex;
        progressCallback(listingIndex + 1, results.total);
        
        if (result.success) {
          if (result.isDraft) {
            // Successfully created but as draft
            results.drafts.push({
              ...result,
              message: result.message || 'Created as draft due to missing business policies'
            });
            results.summary.drafts++;
          } else {
            // Successfully published
            results.successful.push(result);
            results.summary.published++;
          }
        } else {
          // Failed to create
          results.failed.push({
            ...result,
            originalIndex: listingIndex,
            troubleshooting: this.generateTroubleshootingAdvice(result)
          });
          results.summary.failed++;
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
   * Generate troubleshooting advice based on the error
   * @param {Object} result - Failed listing result
   * @returns {Array} - Array of troubleshooting suggestions
   */
  generateTroubleshootingAdvice(result) {
    const advice = [];
    
    // Shipping service related issues
    if (result.error?.includes('shipping service') || result.error?.includes('Fulfillment policy')) {
      advice.push('eBay requires proper shipping configuration for listings');
      advice.push('Enable business policies in your eBay account for full shipping support');
      advice.push('Go to My eBay → Account → Site Preferences → Selling preferences');
      advice.push('Turn on "Use business policies for my listings"');
      advice.push('Create a shipping (fulfillment) policy with valid shipping services');
    }
    
    // Business policy related issues
    else if (result.details?.businessPolicyStatus === 'not_available') {
      advice.push('Enable business policies in your eBay account settings');
      advice.push('Go to My eBay → Account → Site Preferences → Selling preferences');
      advice.push('Turn on "Use business policies for my listings"');
      advice.push('Create payment, shipping, and return policies');
    }
    
    // Publishing issues
    else if (result.step === 'publish_offer') {
      advice.push('The offer was created but could not be published');
      advice.push('Check eBay Seller Hub for the draft listing');
      advice.push('You may be able to publish it manually from eBay');
      if (result.error?.includes('policy') || result.error?.includes('shipping')) {
        advice.push('This is likely due to missing business policies');
        advice.push('Enable business policies in your eBay account to resolve this');
      }
    }
    
    // Category issues
    else if (result.step === 'offer_creation' && result.details?.suggestions) {
      advice.push(...result.details.suggestions);
    }
    
    // Network/API issues
    else if (result.step === 'network_error') {
      advice.push('Check your internet connection');
      advice.push('eBay servers may be temporarily unavailable');
      advice.push('Try again in a few minutes');
    }
    
    // Token issues
    else if (result.error?.includes('token') || result.error?.includes('auth')) {
      advice.push('Your eBay authentication may have expired');
      advice.push('Try disconnecting and reconnecting your eBay account');
    }
    
    // General policy advice if nothing else matches
    if (advice.length === 0 && (result.error?.includes('policy') || result.isDraft)) {
      advice.push('This appears to be a business policy related issue');
      advice.push('Enable business policies in your eBay account');
      advice.push('Go to My eBay → Account → Site Preferences → Selling preferences');
      advice.push('Create payment, shipping, and return policies');
    }
    
    return advice.length > 0 ? advice : ['Contact support for assistance with this error'];
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

  /**
   * Get detailed status about the current eBay connection
   * @returns {Object} - Connection status details
   */
  async getConnectionStatus() {
    const status = {
      isAuthenticated: false,
      isConfigured: false,
      hasBusinessPolicies: false,
      environment: this.ebayOAuthService.environment,
      marketplace: this.ebayOAuthService.getMarketplace(),
      issues: [],
      recommendations: []
    };

    // Check configuration
    status.isConfigured = this.ebayOAuthService.isConfigured();
    if (!status.isConfigured) {
      status.issues.push('eBay OAuth service not properly configured');
      status.recommendations.push('Check your eBay developer credentials');
      return status;
    }

    // Check authentication
    status.isAuthenticated = this.ebayOAuthService.isAuthenticated();
    if (!status.isAuthenticated) {
      status.issues.push('Not authenticated with eBay');
      status.recommendations.push('Connect your eBay account');
      return status;
    }

    // Check business policies (if authenticated)
    try {
      const policies = await this.ebayOAuthService.getBusinessPolicies();
      status.hasBusinessPolicies = policies.success && !policies.notEligible;
      
      if (!status.hasBusinessPolicies) {
        if (policies.notEligible) {
          status.issues.push('Business policies not enabled on eBay account');
          status.recommendations.push('Enable business policies in eBay seller preferences');
        } else {
          status.issues.push('Unable to verify business policies');
          status.recommendations.push('Check eBay account permissions');
        }
      }
    } catch (error) {
      status.issues.push('Error checking business policies');
      status.recommendations.push('Verify eBay account connectivity');
    }

    return status;
  }
}

export default EbayListingService;