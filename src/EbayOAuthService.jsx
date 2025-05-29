// EbayOAuthService.js - Updated with better error handling and debugging
import EbayConfigService from './EbayConfigService';

class EbayOAuthService {
  constructor() {
    // Initialize configuration service
    this.configService = new EbayConfigService();
    
    // Get configuration from config service
    this.config = this.configService.getPublicConfig().urls;
    this.environment = this.configService.getEnvironment();
    
    // Get Lambda endpoints from config service
    const lambdaEndpoints = this.configService.getLambdaEndpoints();
    this.lambdaTokenEndpoint = lambdaEndpoints.tokenExchange;
    this.lambdaApiProxyEndpoint = lambdaEndpoints.apiProxy;
    
    // eBay Marketplace configurations
    this.marketplaces = {
      'EBAY_US': { siteId: 0, globalId: 'EBAY-US', currency: 'USD', name: 'United States' },
      'EBAY_CA': { siteId: 2, globalId: 'EBAY-ENCA', currency: 'CAD', name: 'Canada' },
      'EBAY_UK': { siteId: 3, globalId: 'EBAY-GB', currency: 'GBP', name: 'United Kingdom' },
      'EBAY_AU': { siteId: 15, globalId: 'EBAY-AU', currency: 'AUD', name: 'Australia' },
      'EBAY_DE': { siteId: 77, globalId: 'EBAY-DE', currency: 'EUR', name: 'Germany' },
      'EBAY_FR': { siteId: 71, globalId: 'EBAY-FR', currency: 'EUR', name: 'France' },
      'EBAY_IT': { siteId: 101, globalId: 'EBAY-IT', currency: 'EUR', name: 'Italy' },
      'EBAY_ES': { siteId: 186, globalId: 'EBAY-ES', currency: 'EUR', name: 'Spain' },
      'EBAY_NL': { siteId: 146, globalId: 'EBAY-NL', currency: 'EUR', name: 'Netherlands' },
      'EBAY_BE': { siteId: 123, globalId: 'EBAY-FRBE', currency: 'EUR', name: 'Belgium' },
      'EBAY_CH': { siteId: 193, globalId: 'EBAY-CH', currency: 'CHF', name: 'Switzerland' },
      'EBAY_IE': { siteId: 205, globalId: 'EBAY-IE', currency: 'EUR', name: 'Ireland' },
      'EBAY_PL': { siteId: 212, globalId: 'EBAY-PL', currency: 'PLN', name: 'Poland' },
      'EBAY_AT': { siteId: 16, globalId: 'EBAY-AT', currency: 'EUR', name: 'Austria' }
    };
    
    // Default marketplace (can be overridden)
    this.selectedMarketplace = 'EBAY_US';
    
    // Get public configuration
    const publicConfig = this.configService.getPublicConfig();
    
    // IMPORTANT: Credentials are no longer stored in frontend
    // They are securely managed by Lambda functions
    this.credentials = {
      // Client ID and Secret are handled by Lambda
      clientId: null,  // Retrieved from Lambda when needed
      clientSecret: null,  // Never exposed to frontend
      redirectUri: publicConfig.redirectUri,
      ruName: null  // Retrieved from Lambda when needed
    };
    
    this.scopes = publicConfig.scopes;
    
    // Debug logging (no sensitive data)
    console.log('eBay OAuth Service Configuration:');
    console.log('Environment:', this.environment);
    console.log('Redirect URI:', this.credentials.redirectUri);
    console.log('Scopes:', this.scopes);
    console.log('Lambda Token Endpoint:', this.lambdaTokenEndpoint);
    console.log('Lambda API Proxy Endpoint:', this.lambdaApiProxyEndpoint);
    console.log('Secure Mode: Credentials managed by Lambda');
    
    // Validate configuration
    this.validateConfiguration();
  }

  /**
   * Set the current marketplace
   */
  setMarketplace(marketplaceId) {
    if (this.marketplaces[marketplaceId]) {
      this.selectedMarketplace = marketplaceId;
      localStorage.setItem('ebay_marketplace', marketplaceId);
      console.log(`Marketplace set to: ${this.marketplaces[marketplaceId].name}`);
    } else {
      console.error(`Invalid marketplace ID: ${marketplaceId}`);
    }
  }

  /**
   * Get the current marketplace
   */
  getMarketplace() {
    // Try to get from localStorage first
    const savedMarketplace = localStorage.getItem('ebay_marketplace');
    if (savedMarketplace && this.marketplaces[savedMarketplace]) {
      this.selectedMarketplace = savedMarketplace;
    }
    return this.selectedMarketplace;
  }

  /**
   * Get marketplace details
   */
  getMarketplaceDetails() {
    return this.marketplaces[this.getMarketplace()];
  }

  /**
   * Get all available marketplaces
   */
  getAllMarketplaces() {
    return this.marketplaces;
  }

  /**
   * Validate that all required configuration is present
   */
  validateConfiguration() {
    const missing = [];
    
    // Check redirect URI
    if (!this.credentials.redirectUri || 
        this.credentials.redirectUri === '' ||
        this.credentials.redirectUri.includes('YOUR_')) {
      missing.push('redirectUri');
    }
    
    // Check if Lambda endpoints are configured
    if (!this.lambdaTokenEndpoint || this.lambdaTokenEndpoint.includes('YOUR_')) {
      console.warn('Lambda token endpoint not configured - token exchange will fail');
      missing.push('lambdaTokenEndpoint');
    }

    if (!this.lambdaApiProxyEndpoint || this.lambdaApiProxyEndpoint.includes('YOUR_')) {
      console.warn('Lambda API proxy endpoint not configured - API calls will fail');
      missing.push('lambdaApiProxyEndpoint');
    }
    
    // Verify config service is properly initialized
    if (!this.configService || !this.configService.isConfigured()) {
      console.warn('Configuration service is not properly initialized');
      missing.push('configService');
    }
    
    if (missing.length > 0) {
      console.error('eBay OAuth Configuration Error: Missing configuration:', missing);
      console.error('Please ensure the following environment variables are set:');
      console.error('- REACT_APP_EBAY_REDIRECT_URI');
      console.error('- REACT_APP_LAMBDA_TOKEN_ENDPOINT');
      console.error('- REACT_APP_LAMBDA_API_PROXY_ENDPOINT');
      console.error('Note: eBay credentials are now securely managed by Lambda functions');
      
      this.configurationValid = false;
    } else {
      this.configurationValid = true;
      console.log('eBay OAuth configuration validated successfully (secure mode)');
    }
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured() {
    return this.configurationValid;
  }

  /**
   * Get configuration instructions for the user
   */
  getConfigurationInstructions() {
    return this.configService.getSecureSetupInstructions();
  }

  /**
   * Get the current API URLs based on environment
   */
  getApiUrls() {
    return this.config[this.environment];
  }

  /**
   * Generate the eBay OAuth authorization URL using Lambda service
   */
  async generateAuthUrl(state = null) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured. Please check your configuration.');
    }

    try {
      console.log('=== GENERATING AUTH URL ===');
      console.log('Environment:', this.environment);
      console.log('State:', state);
      
      // Use config service to get auth URL from Lambda
      const authUrl = await this.configService.getAuthorizationUrl(state);
      
      console.log('Authorization URL generated successfully');
      return authUrl;
    } catch (error) {
      console.error('Error generating authorization URL:', error);
      throw new Error('Failed to generate authorization URL. Please check your configuration.');
    }
  }

  /**
   * Exchange authorization code for access token using Lambda proxy
   */
  async exchangeCodeForToken(authorizationCode) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    try {
      console.log('=== TOKEN EXCHANGE VIA LAMBDA ===');
      console.log('Authorization code received:', authorizationCode);
      console.log('Lambda endpoint:', this.lambdaTokenEndpoint);
      console.log('Environment:', this.environment);
      
      const requestBody = {
        authorizationCode: authorizationCode,
        environment: this.environment,
        timestamp: new Date().toISOString()
      };
      
      console.log('Request body:', requestBody);
      
      const response = await fetch(this.lambdaTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Lambda response status:', response.status);
      console.log('Lambda response headers:', Object.fromEntries(response.headers.entries()));

      const responseText = await response.text();
      console.log('Lambda response body:', responseText);

      // First check if the response is OK
      if (!response.ok) {
        // Try to parse any error details
        try {
          const errorData = JSON.parse(responseText);
          throw new Error(`Lambda function error: ${response.status} - ${errorData.error || responseText}`);
        } catch (parseError) {
          // If can't parse JSON, just use the text
          throw new Error(`Lambda function error: ${response.status} - ${responseText}`);
        }
      }

      // Parse the successful response
      let responseData;
      try {
        responseData = JSON.parse(responseText);
        
        // Check if response contains a nested JSON response (common issue with API Gateway)
        if (responseData.body && typeof responseData.body === 'string') {
          try {
            responseData = JSON.parse(responseData.body);
          } catch (nestedError) {
            console.log('Could not parse nested body, using original response');
          }
        }
        
        // Ensure we have tokenData
        const tokenData = responseData.tokenData || responseData;
        
        if (!tokenData || (!tokenData.access_token && !tokenData.refresh_token)) {
          throw new Error('Invalid token data received from Lambda');
        }
        
        console.log('=== TOKEN EXCHANGE SUCCESS ===');
        console.log('Token type:', tokenData.token_type);
        console.log('Expires in:', tokenData.expires_in, 'seconds');
        console.log('Access token length:', tokenData.access_token?.length || 0);
        console.log('Refresh token present:', !!tokenData.refresh_token);
        
        this.storeTokens(tokenData);
        console.log('Tokens stored successfully');
        
        return tokenData;
      } catch (parseError) {
        console.error('Error parsing JSON response:', parseError);
        throw new Error(`Invalid JSON response from Lambda: ${responseText}`);
      }
    } catch (error) {
      console.error('=== TOKEN EXCHANGE ERROR ===');
      console.error('Error details:', error);
      console.error('Error message:', error.message);
      throw error;
    }
  }

  /**
   * Store tokens securely
   */
  storeTokens(tokenData) {
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      stored_at: new Date().toISOString()
    };
    
    localStorage.setItem('ebay_tokens', JSON.stringify(tokens));
    console.log('Tokens stored successfully at:', tokens.stored_at);
    return tokens;
  }

  /**
   * Get stored tokens
   */
  getStoredTokens() {
    const stored = localStorage.getItem('ebay_tokens');
    if (!stored) return null;
    
    try {
      const tokens = JSON.parse(stored);
      
      console.log('Retrieved tokens, stored at:', tokens.stored_at);
      
      // Check if tokens are expired
      if (Date.now() >= tokens.expires_at) {
        console.log('Tokens expired, need to refresh');
        // Don't automatically clear - let refresh token flow handle it
        return tokens; // Return expired tokens so refresh can be attempted
      }
      
      return tokens;
    } catch (error) {
      console.error('Error parsing stored tokens:', error);
      return null;
    }
  }

  /**
   * Refresh access token using refresh token via Lambda proxy
   */
  async refreshAccessToken() {
    const tokens = this.getStoredTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      console.log('Refreshing access token via Lambda proxy...');
      
      const response = await fetch(this.lambdaApiProxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          endpoint: '/identity/v1/oauth2/token',
          method: 'POST',
          environment: this.environment,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${btoa(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`
          },
          requestBody: {
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            scope: this.scopes.join(' ')
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Token refresh proxy failed:', response.status, errorData);
        throw new Error(`Token refresh failed: ${response.status} - ${errorData}`);
      }

      const proxyResponse = await response.json();
      
      if (!proxyResponse.success) {
        console.error('Token refresh failed:', proxyResponse);
        throw new Error(`Token refresh failed: ${proxyResponse.error || 'Unknown error'}`);
      }

      const tokenData = proxyResponse.data;
      this.storeTokens(tokenData);
      
      console.log('Token refresh successful');
      return tokenData;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Clear tokens on refresh failure
      localStorage.removeItem('ebay_tokens');
      throw error;
    }
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidAccessToken() {
    let tokens = this.getStoredTokens();
    
    if (!tokens) {
      throw new Error('No tokens available. User needs to authenticate.');
    }

    // If token expires in less than 5 minutes, refresh it
    if (Date.now() >= (tokens.expires_at - 300000)) {
      console.log('Token expiring soon or expired, refreshing...');
      tokens = await this.refreshAccessToken();
    }

    return tokens.access_token;
  }

  /**
   * Make authenticated API request to eBay
   */
  async makeApiRequest(endpoint, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    try {
      const accessToken = await this.getValidAccessToken();
      
      console.log('=== EBAY API REQUEST ===');
      console.log(`Endpoint: ${endpoint}`);
      console.log(`Method: ${options.method || 'GET'}`);
      console.log(`Environment: ${this.environment}`);
      console.log(`Marketplace: ${this.getMarketplace()}`);
      console.log(`Lambda Proxy: ${this.lambdaApiProxyEndpoint}`);
      
      const proxyRequest = {
        endpoint: endpoint,
        method: options.method || 'GET',
        accessToken: accessToken,
        environment: this.environment,
        headers: {
          'X-EBAY-C-MARKETPLACE-ID': this.getMarketplace(),
          ...options.headers
        },
        requestBody: options.body || null
      };

      // Log request details (sanitize sensitive data)
      console.log('Proxy Request Headers:', proxyRequest.headers);
      if (proxyRequest.requestBody) {
        console.log('Request Body Preview:', JSON.stringify(proxyRequest.requestBody, null, 2).substring(0, 500) + '...');
      }

      const startTime = Date.now();
      const response = await fetch(this.lambdaApiProxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(proxyRequest)
      });
      const responseTime = Date.now() - startTime;

      console.log(`Lambda proxy response: ${response.status} ${response.statusText} (${responseTime}ms)`);
      console.log('Response Headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        console.error('=== LAMBDA PROXY ERROR ===');
        let errorMessage = `API proxy request failed: ${response.status}`;
        let errorBody = null;
        try {
          errorBody = await response.text();
          console.error('Error Response Body:', errorBody);
          const errorData = JSON.parse(errorBody);
          errorMessage = `API proxy request failed: ${errorData.error || errorData.message || response.statusText}`;
        } catch (e) {
          console.error('Failed to parse error response:', e);
          if (errorBody) {
            console.error('Raw error body:', errorBody);
          }
        }
        
        throw new Error(errorMessage);
      }

      const responseText = await response.text();
      console.log('Response body length:', responseText.length);
      
      let proxyResponse;
      try {
        proxyResponse = JSON.parse(responseText);
      } catch (e) {
        console.error('Failed to parse proxy response as JSON:', e);
        console.error('Raw response text:', responseText.substring(0, 1000));
        throw new Error('Invalid JSON response from Lambda proxy');
      }
      
      // Log the full response structure for debugging
      console.log('=== PROXY RESPONSE STRUCTURE ===');
      console.log('Success:', proxyResponse.success);
      console.log('Status Code:', proxyResponse.statusCode);
      if (proxyResponse.error) {
        console.log('Error:', proxyResponse.error);
      }
      if (proxyResponse.data) {
        console.log('Data keys:', Object.keys(proxyResponse.data));
        console.log('Data preview:', JSON.stringify(proxyResponse.data, null, 2).substring(0, 500) + '...');
      }
      
      // Check if the proxied request was successful
      if (!proxyResponse.success) {
        console.error('=== EBAY API ERROR ===');
        console.error('Status Code:', proxyResponse.statusCode);
        console.error('Error:', proxyResponse.error);
        console.error('Full Error Data:', JSON.stringify(proxyResponse.data, null, 2));
        
        // Check for auth errors
        if (proxyResponse.statusCode === 401) {
          console.log('Authentication error detected, attempting token refresh...');
          
          try {
            await this.refreshAccessToken();
            console.log('Token refresh successful, retrying original request...');
            // Retry the request with new token
            return this.makeApiRequest(endpoint, options);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            throw new Error('Authentication failed. Please log in again.');
          }
        }
        
        // Extract detailed error information
        let detailedError = proxyResponse.error || 'Unknown error';
        if (proxyResponse.data) {
          if (proxyResponse.data.errors && Array.isArray(proxyResponse.data.errors)) {
            const errorDetails = proxyResponse.data.errors.map(e => ({
              errorId: e.errorId,
              category: e.category,
              message: e.message || e.longMessage,
              parameters: e.parameters
            }));
            console.error('eBay API Errors:', errorDetails);
            detailedError = errorDetails.map(e => e.message).join('; ');
          } else if (proxyResponse.data.error_description) {
            detailedError = proxyResponse.data.error_description;
          }
        }
        
        const error = new Error(`eBay API error: ${detailedError}`);
        error.statusCode = proxyResponse.statusCode;
        error.data = proxyResponse.data;
        error.endpoint = endpoint;
        throw error;
      }

      console.log('=== API REQUEST SUCCESSFUL ===');
      console.log(`Total request time: ${responseTime}ms`);
      return proxyResponse.data;
    } catch (error) {
      console.error('=== API REQUEST EXCEPTION ===');
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      console.error('Error Stack:', error.stack);
      if (error.data) {
        console.error('Error Data:', JSON.stringify(error.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Get user's business policies (payment, shipping, return)
   */
  async getBusinessPolicies() {
    try {
      console.log('Fetching business policies...');
      
      const [fulfillmentResponse, paymentResponse, returnResponse] = await Promise.allSettled([
        this.makeApiRequest('/sell/account/v1/fulfillment_policy'),
        this.makeApiRequest('/sell/account/v1/payment_policy'), 
        this.makeApiRequest('/sell/account/v1/return_policy')
      ]);

      // Check if user is not eligible for business policies
      const checkNotEligible = (response) => {
        if (response.status === 'rejected') {
          const error = response.reason;
          if (error.data && error.data.errors) {
            const notEligible = error.data.errors.some(e => 
              e.errorId === 20403 || 
              e.longMessage?.includes('not eligible for Business Policy')
            );
            if (notEligible) {
              console.log('User is not eligible for business policies in this environment');
              return true;
            }
          }
        }
        return false;
      };

      // If user is not eligible for business policies, return empty but valid response
      if (checkNotEligible(fulfillmentResponse) || 
          checkNotEligible(paymentResponse) || 
          checkNotEligible(returnResponse)) {
        
        console.log('Business policies not available for this account');
        return {
          fulfillmentPolicies: [],
          paymentPolicies: [],
          returnPolicies: [],
          notEligible: true,
          message: 'Business policies are not enabled for this account. You can still create listings without them.',
          success: true
        };
      }

      const fulfillmentPolicies = fulfillmentResponse.status === 'fulfilled' ? 
        (fulfillmentResponse.value.fulfillmentPolicies || []) : [];
      
      const paymentPolicies = paymentResponse.status === 'fulfilled' ? 
        (paymentResponse.value.paymentPolicies || []) : [];
      
      const returnPolicies = returnResponse.status === 'fulfilled' ? 
        (returnResponse.value.returnPolicies || []) : [];

      console.log('Business policies fetched:', {
        fulfillment: fulfillmentPolicies.length,
        payment: paymentPolicies.length,
        return: returnPolicies.length
      });

      return {
        fulfillmentPolicies,
        paymentPolicies,
        returnPolicies,
        success: true
      };
    } catch (error) {
      console.error('Error fetching business policies:', error);
      return {
        fulfillmentPolicies: [],
        paymentPolicies: [],
        returnPolicies: [],
        error: error.message,
        success: false
      };
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    const tokens = this.getStoredTokens();
    return tokens !== null;
  }

  /**
   * Logout user (clear tokens)
   */
  logout() {
    localStorage.removeItem('ebay_tokens');
    console.log('User logged out, tokens cleared');
  }

  /**
   * Get user profile information
   */
  async getUserProfile() {
    try {
      const response = await this.makeApiRequest('/commerce/identity/v1/user', {
        headers: {
          'X-EBAY-C-MARKETPLACE-ID': this.getMarketplace()
        }
      });
      
      return response;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw error;
    }
  }
}

export default EbayOAuthService;