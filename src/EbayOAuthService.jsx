// EbayOAuthService.js - Updated with better debugging and error handling
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
    
    // Your eBay app credentials
    this.credentials = {
      clientId: process.env.REACT_APP_EBAY_CLIENT_ID || 'YOUR_ACTUAL_EBAY_CLIENT_ID',
      clientSecret: process.env.REACT_APP_EBAY_CLIENT_SECRET || 'YOUR_ACTUAL_EBAY_CLIENT_SECRET',
      redirectUri: process.env.REACT_APP_EBAY_REDIRECT_URI || window.location.origin + '/ebay/callback',
      ruName: process.env.REACT_APP_EBAY_RU_NAME || 'YOUR_ACTUAL_RU_NAME'
    };
    
    // Updated scopes - using more specific scopes that are commonly approved
    this.scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
    ];
    
    // Debug logging
    console.log('eBay OAuth Service Configuration:');
    console.log('Environment:', this.environment);
    console.log('Client ID:', this.credentials.clientId ? 'Set ✓' : 'Missing ✗');
    console.log('Client Secret:', this.credentials.clientSecret ? 'Set ✓' : 'Missing ✗');
    console.log('Redirect URI:', this.credentials.redirectUri);
    console.log('RuName:', this.credentials.ruName ? 'Set ✓' : 'Missing ✗');
    console.log('Scopes:', this.scopes);
    
    // Validate configuration on construction
    this.validateConfiguration();
  }

  /**
   * Validate that all required credentials are configured
   */
  validateConfiguration() {
    const required = ['clientId', 'clientSecret', 'redirectUri'];
    const missing = required.filter(key => 
      !this.credentials[key] || 
      this.credentials[key].startsWith('YOUR_') ||
      this.credentials[key] === ''
    );
    
    // RuName is sometimes optional depending on eBay app setup
    if (!this.credentials.ruName || this.credentials.ruName.startsWith('YOUR_')) {
      console.warn('RuName not set - this might be required depending on your eBay app configuration');
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
   * Exchange authorization code for access token with better error handling
   */
  async exchangeCodeForToken(authorizationCode) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    const urls = this.getApiUrls();
    
    try {
      console.log('Exchanging authorization code for token...');
      console.log('Token URL:', urls.tokenUrl);
      console.log('Authorization code:', authorizationCode);
      
      // Prepare the request body
      const requestBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: this.credentials.redirectUri
      });
      
      console.log('Token exchange request body:', requestBody.toString());
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`
      };
      
      console.log('Token exchange headers:', {
        'Content-Type': headers['Content-Type'],
        'Authorization': 'Basic [REDACTED]'
      });
      
      const response = await fetch(urls.tokenUrl, {
        method: 'POST',
        headers: headers,
        body: requestBody
      });

      const responseText = await response.text();
      console.log('Token exchange response status:', response.status);
      console.log('Token exchange response headers:', Object.fromEntries(response.headers.entries()));
      console.log('Token exchange response body:', responseText);

      if (!response.ok) {
        let errorMessage = `Token exchange failed: ${response.status}`;
        try {
          const errorData = JSON.parse(responseText);
          console.error('Parsed error data:', errorData);
          
          // Provide more specific error messages
          if (errorData.error_description) {
            errorMessage += ` - ${errorData.error_description}`;
          }
          
          if (errorData.error_id === 'invalid_request') {
            errorMessage += '\n\nPossible causes:\n';
            errorMessage += '- Invalid redirect_uri (must match exactly what\'s configured in eBay)\n';
            errorMessage += '- Invalid authorization code (may have expired)\n';
            errorMessage += '- Invalid client credentials\n';
            errorMessage += '- Missing or incorrect grant_type';
          }
          
        } catch (e) {
          errorMessage += ` - ${responseText}`;
        }
        throw new Error(errorMessage);
      }

      const tokenData = JSON.parse(responseText);
      this.storeTokens(tokenData);
      
      console.log('Token exchange successful');
      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for token:', error);
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
      expires_at: Date.now() + (tokenData.expires_in * 1000)
    };
    
    localStorage.setItem('ebay_tokens', JSON.stringify(tokens));
    console.log('Tokens stored successfully');
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
      
      // Check if tokens are expired
      if (Date.now() >= tokens.expires_at) {
        console.log('Tokens expired, need to refresh');
        return null;
      }
      
      return tokens;
    } catch (error) {
      console.error('Error parsing stored tokens:', error);
      return null;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    const tokens = this.getStoredTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    const urls = this.getApiUrls();

    try {
      console.log('Refreshing access token...');
      
      const response = await fetch(urls.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          scope: this.scopes.join(' ')
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Token refresh failed:', response.status, errorData);
        throw new Error(`Token refresh failed: ${response.status} - ${errorData}`);
      }

      const tokenData = await response.json();
      this.storeTokens(tokenData);
      
      console.log('Token refresh successful');
      return tokenData;
    } catch (error) {
      console.error('Error refreshing token:', error);
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

    const accessToken = await this.getValidAccessToken();
    const urls = this.getApiUrls();

    const defaultHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
    };

    const requestOptions = {
      method: 'GET',
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers
      }
    };

    try {
      console.log(`Making eBay API request to: ${urls.apiUrl}${endpoint}`);
      
      const response = await fetch(`${urls.apiUrl}${endpoint}`, requestOptions);

      if (response.status === 401) {
        try {
          console.log('Received 401, attempting token refresh...');
          await this.refreshAccessToken();
          const newAccessToken = await this.getValidAccessToken();
          
          requestOptions.headers.Authorization = `Bearer ${newAccessToken}`;
          const retryResponse = await fetch(`${urls.apiUrl}${endpoint}`, requestOptions);
          
          if (!retryResponse.ok) {
            const errorData = await retryResponse.text();
            throw new Error(`API request failed after token refresh: ${retryResponse.status} - ${errorData}`);
          }
          
          return await retryResponse.json();
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          throw new Error('Authentication failed. Please log in again.');
        }
      }

      if (!response.ok) {
        const errorData = await response.text();
        console.error('API request failed:', response.status, errorData);
        throw new Error(`API request failed: ${response.status} - ${errorData}`);
      }

      const responseData = await response.json();
      console.log('API request successful');
      return responseData;
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

      const fulfillmentPolicies = fulfillmentResponse.status === 'fulfilled' ? 
        (fulfillmentResponse.value.fulfillmentPolicies || []) : [];
      
      const paymentPolicies = paymentResponse.status === 'fulfilled' ? 
        (paymentResponse.value.paymentPolicies || []) : [];
      
      const returnPolicies = returnResponse.status === 'fulfilled' ? 
        (returnResponse.value.returnPolicies || []) : [];

      console.log('Business policies fetched successfully:', {
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
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
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