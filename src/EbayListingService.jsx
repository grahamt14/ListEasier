// EbayListingService.jsx - Fixed with correct Lambda endpoint
import EbayOAuthService from './EbayOAuthService';

class EbayListingService {
  constructor() {
    this.ebayOAuthService = new EbayOAuthService();
    // FIXED: Use the correct Lambda endpoint from your existing deployment
    this.createListingEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-create-listing';
    this.batchSize = 3; // Process fewer at once to avoid rate limits
    this.delayBetweenListings = 2000; // 2 second delay between listings
  }

  /**
   * Format listing data for eBay API
   */
  formatListingForEbay(listing, imageUrls, metadata, categoryId, selectedPolicies) {
    // Clean and validate image URLs
    const validImageUrls = imageUrls
      .filter(url => url && typeof url === 'string' && url.includes('http'))
      .slice(0, 12); // eBay allows max 12 images

    if (validImageUrls.length === 0) {
      throw new Error('No valid image URLs found');
    }

    // Extract category fields for eBay aspects
    const aspectsData = {};
    if (listing.storedFieldSelections) {
      Object.entries(listing.storedFieldSelections).forEach(([key, value]) => {
        if (key !== 'price' && key !== 'sku' && value && value !== '-- Select --' && value.trim()) {
          aspectsData[key] = [value.trim()];
        }
      });
    }

    // Clean and validate required fields
    const title = (listing.title || 'No Title').substring(0, 255); // eBay title limit
    const description = listing.description || 'No Description';
    const price = parseFloat(metadata.price) || 9.99;
    const sku = metadata.sku || `SKU-${Date.now()}`;

    return {
      sku: sku,
      title: title,
      description: description,
      categoryId: categoryId.toString(),
      price: price,
      quantity: 1,
      imageUrls: validImageUrls,
      condition: 'NEW',
      policies: {
        paymentPolicyId: selectedPolicies.paymentPolicyId || null,
        fulfillmentPolicyId: selectedPolicies.fulfillmentPolicyId || null,
        returnPolicyId: selectedPolicies.returnPolicyId || null
      },
      aspectsData: aspectsData,
      location: {
        country: 'US',
        postalCode: '90210' // Default - should be configurable
      }
    };
  }

  /**
   * Create a single eBay listing via Lambda function
   */
  async createSingleListing(listingData) {
    try {
      console.log('=== CREATING EBAY LISTING ===');
      console.log('SKU:', listingData.sku);
      console.log('Title:', listingData.title);
      console.log('Price:', listingData.price);
      console.log('Images:', listingData.imageUrls.length);
      console.log('Category ID:', listingData.categoryId);
      console.log('Policies:', listingData.policies);
      
      const accessToken = await this.ebayOAuthService.getValidAccessToken();
      const environment = this.ebayOAuthService.environment;
      const marketplaceId = this.ebayOAuthService.getMarketplace();

      console.log('Environment:', environment);
      console.log('Marketplace:', marketplaceId);
      console.log('Lambda endpoint:', this.createListingEndpoint);

      const requestPayload = {
        accessToken,
        environment,
        marketplaceId,
        listingData
      };

      console.log('Sending request to Lambda...');

      const response = await fetch(this.createListingEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestPayload)
      });

      console.log('Lambda response status:', response.status);
      console.log('Lambda response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Lambda HTTP error:', errorText);
        throw new Error(`Lambda HTTP error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('Lambda response body:', JSON.stringify(result, null, 2));

      // Handle Lambda response format (it might be wrapped in a body property)
      let actualResult = result;
      if (result.body && typeof result.body === 'string') {
        try {
          actualResult = JSON.parse(result.body);
          console.log('Parsed Lambda body:', JSON.stringify(actualResult, null, 2));
        } catch (e) {
          console.error('Failed to parse Lambda response body:', e);
          actualResult = result;
        }
      }

      if (!actualResult.success) {
        console.error('Lambda returned failure:', actualResult);
        return {
          success: false,
          error: actualResult.error || 'Unknown error occurred',
          details: actualResult.details || {},
          isDraft: actualResult.isDraft || false,
          sku: listingData.sku,
          offerId: actualResult.offerId || null,
          step: actualResult.step || 'unknown'
        };
      }

      // Success response
      console.log('=== LISTING CREATED SUCCESSFULLY ===');
      console.log('Listing ID:', actualResult.listingId);
      console.log('Offer ID:', actualResult.offerId);
      console.log('Is Draft:', actualResult.isDraft);
      
      return {
        success: true,
        listingId: actualResult.listingId || null,
        offerId: actualResult.offerId,
        sku: actualResult.sku || listingData.sku,
        originalSku: listingData.sku,
        message: actualResult.message || 'Listing created successfully',
        isDraft: actualResult.isDraft || false,
        environment: environment,
        categoryUsed: actualResult.categoryUsed || listingData.categoryId,
        businessPolicyStatus: actualResult.businessPolicyStatus
      };

    } catch (error) {
      console.error('=== ERROR IN CREATE SINGLE LISTING ===');
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      return {
        success: false,
        error: error.message,
        sku: listingData.sku,
        step: 'network_error'
      };
    }
  }

  /**
   * Create multiple eBay listings with progress tracking
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
    console.log('=== STARTING MULTIPLE LISTING CREATION ===');
    console.log('Total response data items:', responseData.length);
    console.log('Category ID:', categoryId);
    console.log('Selected policies:', selectedPolicies);
    
    const results = {
      successful: [],
      failed: [],
      drafts: [],
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
      .filter(item => {
        const hasResponse = item.response && !item.response.error;
        const hasImages = s3ImageGroups[item.index] && s3ImageGroups[item.index].length > 0;
        const hasValidImages = s3ImageGroups[item.index]?.some(url => 
          url && typeof url === 'string' && url.includes('http')
        );
        
        console.log(`Item ${item.index}: hasResponse=${hasResponse}, hasImages=${hasImages}, hasValidImages=${hasValidImages}`);
        
        return hasResponse && hasImages && hasValidImages;
      });

    console.log(`Found ${validListings.length} valid listings to create`);
    results.total = validListings.length;

    if (validListings.length === 0) {
      throw new Error('No valid listings found to create. Ensure listings have been generated and have valid S3 image URLs.');
    }

    // Process listings sequentially to avoid rate limits
    for (let i = 0; i < validListings.length; i++) {
      const { response, index } = validListings[i];
      
      try {
        console.log(`\n=== PROCESSING LISTING ${i + 1}/${validListings.length} (Index: ${index}) ===`);
        
        const metadata = groupMetadata[index] || { 
          price: '9.99', 
          sku: `SKU-${index + 1}` 
        };
        const imageUrls = s3ImageGroups[index] || [];
        
        console.log('Metadata:', metadata);
        console.log('Image URLs count:', imageUrls.length);
        console.log('First image URL:', imageUrls[0]);
        
        const listingData = this.formatListingForEbay(
          response,
          imageUrls,
          metadata,
          categoryId,
          selectedPolicies
        );

        console.log('Formatted listing data for eBay:', {
          sku: listingData.sku,
          title: listingData.title.substring(0, 50) + '...',
          price: listingData.price,
          imageCount: listingData.imageUrls.length
        });

        const result = await this.createSingleListing(listingData);
        
        // Categorize results
        if (result.success) {
          if (result.isDraft) {
            results.drafts.push({
              ...result,
              message: result.message || 'Created as draft due to missing business policies'
            });
            results.summary.drafts++;
            console.log(`✏️ Draft created: ${result.sku}`);
          } else {
            results.successful.push(result);
            results.summary.published++;
            console.log(`✅ Published: ${result.sku} (ID: ${result.listingId})`);
          }
        } else {
          results.failed.push({
            ...result,
            originalIndex: index,
            troubleshooting: this.generateTroubleshootingAdvice(result)
          });
          results.summary.failed++;
          console.log(`❌ Failed: ${result.sku} - ${result.error}`);
        }

        // Update progress
        const completed = results.summary.published + results.summary.drafts + results.summary.failed;
        progressCallback(completed, results.total);

        console.log(`Progress: ${completed}/${results.total} (${Math.round(completed/results.total*100)}%)`);

        // Add delay between listings to avoid rate limits
        if (completed < results.total) {
          console.log(`Waiting ${this.delayBetweenListings}ms before next listing...`);
          await new Promise(resolve => setTimeout(resolve, this.delayBetweenListings));
        }

      } catch (error) {
        console.error(`❌ Error processing listing ${index}:`, error);
        results.failed.push({
          success: false,
          error: error.message,
          sku: `SKU-${index + 1}`,
          originalIndex: index,
          step: 'processing_error'
        });
        results.summary.failed++;
        
        const completed = results.summary.published + results.summary.drafts + results.summary.failed;
        progressCallback(completed, results.total);
      }
    }

    console.log('\n=== LISTING CREATION COMPLETE ===');
    console.log('Summary:', results.summary);
    console.log(`Published: ${results.summary.published}`);
    console.log(`Drafts: ${results.summary.drafts}`);
    console.log(`Failed: ${results.summary.failed}`);
    
    return results;
  }

  /**
   * Generate troubleshooting advice based on the error
   */
  generateTroubleshootingAdvice(result) {
    const advice = [];
    
    if (result.error?.includes('shipping') || result.error?.includes('Fulfillment')) {
      advice.push('Set up business policies in your eBay account');
      advice.push('Go to My eBay → Account → Site Preferences');
      advice.push('Enable "Use business policies for listings"');
      advice.push('Create shipping, payment, and return policies');
    } else if (result.error?.includes('policy')) {
      advice.push('Business policies are required for this marketplace');
      advice.push('Enable business policies in your eBay seller preferences');
    } else if (result.error?.includes('token') || result.error?.includes('auth')) {
      advice.push('eBay authentication expired');
      advice.push('Disconnect and reconnect your eBay account');
    } else if (result.step === 'network_error') {
      advice.push('Network connection issue');
      advice.push('Check your internet connection and try again');
    } else if (result.error?.includes('category')) {
      advice.push('Invalid category ID or category not supported');
      advice.push('Verify the eBay category ID is correct');
    } else if (result.error?.includes('image')) {
      advice.push('Image URL issue - ensure all images are accessible');
      advice.push('Check that S3 images are publicly accessible');
    } else {
      advice.push('Check eBay Seller Hub for more details');
      advice.push('Ensure all required listing information is provided');
    }
    
    return advice;
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
      throw new Error('Invalid listing data for this group');
    }

    const metadata = groupMetadata[groupIndex] || { 
      price: '9.99', 
      sku: `SKU-${groupIndex + 1}` 
    };
    const imageUrls = s3ImageGroups[groupIndex] || [];

    if (imageUrls.length === 0) {
      throw new Error('No images available for this listing');
    }

    const validImageUrls = imageUrls.filter(url => 
      url && typeof url === 'string' && url.includes('http')
    );

    if (validImageUrls.length === 0) {
      throw new Error('No valid image URLs available for this listing');
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