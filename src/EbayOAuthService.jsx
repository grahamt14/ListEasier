// EbayOAuthService.js - Updated with better error handling and debugging
class EbayOAuthService {
  constructor() {
    // eBay API Configuration
    this.config = {
      // Production URLs
      production: {
        authUrl: 'https://auth.ebay.com/oauth2/authorize',
        tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
        apiUrl: 'https://api.ebay.com'
      },
      // Sandbox URLs for testing
      sandbox: {
        authUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
        tokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
        apiUrl: 'https://api.sandbox.ebay.com'
      }
    };
    
    // Set environment (change to 'production' for live)
    this.environment = 'sandbox'; // or 'production'
    
    // Lambda function URLs
    this.lambdaTokenEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-token-exchange';
    this.lambdaApiProxyEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-api-proxy';
    
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
    
    // Debug environment variables
    console.log('Environment Variables Debug:');
    console.log('REACT_APP_EBAY_CLIENT_ID:', process.env.REACT_APP_EBAY_CLIENT_ID);
    console.log('REACT_APP_EBAY_CLIENT_SECRET:', process.env.REACT_APP_EBAY_CLIENT_SECRET ? '[SET]' : '[NOT SET]');
    console.log('REACT_APP_EBAY_REDIRECT_URI:', process.env.REACT_APP_EBAY_REDIRECT_URI);
    console.log('REACT_APP_EBAY_RU_NAME:', process.env.REACT_APP_EBAY_RU_NAME);
    
    this.credentials = {
      clientId: 'DavidJac-ListEasi-SBX-50e7167ce-0d788b93',
      clientSecret: 'SBX-0e7167ce5ea2-8b89-4ac9-ba7f-5818',
      redirectUri: 'https://main.dhpq8vit86dyp.amplifyapp.com/ebay/callback',
      ruName: 'David_Jacobs-DavidJac-ListEa-gkelan'
    };
    
 // Updated scopes - including inventory management for listing creation
    this.scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account'
    ];
    
    // Debug logging
    console.log('eBay OAuth Service Configuration:');
    console.log('Environment:', this.environment);
    console.log('Client ID:', this.credentials.clientId);
    console.log('Client Secret:', this.credentials.clientSecret ? '[SET]' : '[NOT SET]');
    console.log('Redirect URI:', this.credentials.redirectUri);
    console.log('RuName:', this.credentials.ruName);
    console.log('Scopes:', this.scopes);
    console.log('Lambda Token Endpoint:', this.lambdaTokenEndpoint);
    console.log('Lambda API Proxy Endpoint:', this.lambdaApiProxyEndpoint);
    
    // Validate configuration on construction
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
   * Validate that all required credentials are configured
   */
  validateConfiguration() {
    const required = ['clientId', 'clientSecret', 'redirectUri'];
    const missing = required.filter(key => {
      const value = this.credentials[key];
      return !value || 
             value === '' ||
             value.startsWith('YOUR_') ||
             value.startsWith('PASTE_YOUR_');
    });
    
    // Check if Lambda endpoints are configured
    if (this.lambdaTokenEndpoint.includes('YOUR_')) {
      console.warn('Lambda token endpoint not configured - token exchange will fail');
      missing.push('lambdaTokenEndpoint');
    }

    if (this.lambdaApiProxyEndpoint.includes('YOUR_')) {
      console.warn('Lambda API proxy endpoint not configured - API calls will fail');
      missing.push('lambdaApiProxyEndpoint');
    }
    
    // RuName validation
    if (!this.credentials.ruName || 
        this.credentials.ruName.startsWith('YOUR_') ||
        this.credentials.ruName.startsWith('PASTE_YOUR_')) {
      console.warn('RuName not properly set - this might be required depending on your eBay app configuration');
      missing.push('ruName');
    }
    
    if (missing.length > 0) {
      console.error('eBay OAuth Configuration Error: Missing or invalid credentials:', missing);
      console.error('Please check your eBay Developer Account and update the following:');
      missing.forEach(key => {
        console.error(`- ${key}: ${this.credentials[key]}`);
      });
      
      this.configurationValid = false;
    } else {
      this.configurationValid = true;
      console.log('eBay OAuth configuration validated successfully');
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
    return {
      step1: "Go to https://developer.ebay.com/my/keys",
      step2: "Create a new application or use an existing one",
      step3: "Copy your Client ID and Client Secret",
      step4: "Create a RuName (Redirect URL Name) with your callback URL",
      step5: "Deploy the Lambda functions for token exchange and API proxy",
      environment: this.environment,
      redirectUri: this.credentials.redirectUri,
      lambdaTokenEndpoint: this.lambdaTokenEndpoint,
      lambdaApiProxyEndpoint: this.lambdaApiProxyEndpoint,
      requiredEnvVars: [
        'REACT_APP_EBAY_CLIENT_ID',
        'REACT_APP_EBAY_CLIENT_SECRET', 
        'REACT_APP_EBAY_REDIRECT_URI',
        'REACT_APP_EBAY_RU_NAME',
        'REACT_APP_LAMBDA_TOKEN_ENDPOINT',
        'REACT_APP_LAMBDA_API_PROXY_ENDPOINT'
      ]
    };
  }

  /**
   * Get the current API URLs based on environment
   */
  getApiUrls() {
    return this.config[this.environment];
  }

  /**
   * Generate the eBay OAuth authorization URL with better parameter validation
   */
  generateAuthUrl(state = null) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured. Please check your credentials.');
    }

    const urls = this.getApiUrls();
    
    // Validate redirect URI format
    if (!this.credentials.redirectUri.startsWith('http')) {
      throw new Error('Redirect URI must be a valid HTTP/HTTPS URL');
    }
    
    // Build parameters object
    const params = {
      client_id: this.credentials.clientId,
      redirect_uri: this.credentials.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' ')
    };
    
    // Only add state if provided
    if (state) {
      params.state = state;
    }
    
    // Debug the parameters being sent
    console.log('eBay OAuth Parameters:');
    console.log('Auth URL:', urls.authUrl);
    console.log('Parameters:', params);
    
    // Create URL with proper encoding
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      urlParams.append(key, value);
    });
    
    const authUrl = `${urls.authUrl}?${urlParams.toString()}`;
    console.log('Generated eBay auth URL:', authUrl);
    
    return authUrl;
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
      
      console.log(`Making eBay API request via Lambda proxy to: ${endpoint}`);
      
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

      const response = await fetch(this.lambdaApiProxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(proxyRequest)
      });

      console.log('Lambda proxy response status:', response.status);

      if (!response.ok) {
        let errorMessage = `API proxy request failed: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = `API proxy request failed: ${errorData.error || errorData.message || response.statusText}`;
        } catch (e) {
          // If we can't parse the error, use the default message
        }
        
        console.error('API proxy request error:', errorMessage);
        throw new Error(errorMessage);
      }

      const proxyResponse = await response.json();
      
      // LOG THE FULL RESPONSE FOR DEBUGGING
      console.log('Full proxy response:', JSON.stringify(proxyResponse, null, 2));
      
      // Check if the proxied request was successful
      if (!proxyResponse.success) {
        // Check for auth errors
        if (proxyResponse.statusCode === 401) {
          console.log('Received 401 from eBay, attempting token refresh...');
          
          try {
            await this.refreshAccessToken();
            // Retry the request with new token
            return this.makeApiRequest(endpoint, options);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            throw new Error('Authentication failed. Please log in again.');
          }
        }
        
        // LOG MORE DETAILS ABOUT THE ERROR
        console.error('eBay API error details:', {
          statusCode: proxyResponse.statusCode,
          error: proxyResponse.error,
          data: proxyResponse.data
        });
        
        const error = new Error(`eBay API error: ${proxyResponse.error || JSON.stringify(proxyResponse.data) || 'Unknown error'}`);
        error.statusCode = proxyResponse.statusCode;
        error.data = proxyResponse.data;
        throw error;
      }

      console.log('API request successful');
      return proxyResponse.data;
    } catch (error) {
      console.error('API request error:', error);
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