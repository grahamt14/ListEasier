// EbayOAuthService.js - Updated to use Lambda proxy for token exchange
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
    
    // Lambda function URL for token exchange - CORRECTED ENDPOINT TO MATCH API GATEWAY
    this.lambdaTokenEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-token-exchange';
    
    // Debug environment variables first
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
    
    // Updated scopes - using more specific scopes that are commonly approved
    this.scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
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
    
    // Validate configuration on construction
    this.validateConfiguration();
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
    
    // Check if Lambda endpoint is configured
    if (this.lambdaTokenEndpoint.includes('YOUR_')) {
      console.warn('Lambda token endpoint not configured - token exchange will fail');
      missing.push('lambdaTokenEndpoint');
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
      step5: "Deploy the Lambda function for token exchange",
      environment: this.environment,
      redirectUri: this.credentials.redirectUri,
      lambdaEndpoint: this.lambdaTokenEndpoint,
      requiredEnvVars: [
        'REACT_APP_EBAY_CLIENT_ID',
        'REACT_APP_EBAY_CLIENT_SECRET', 
        'REACT_APP_EBAY_REDIRECT_URI',
        'REACT_APP_EBAY_RU_NAME',
        'REACT_APP_LAMBDA_TOKEN_ENDPOINT'
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
        environment: this.environment
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

      let responseData;
      try {
        responseData = JSON.parse(responseText);
        
        // Check if response contains a nested JSON response (common issue with API Gateway)
        if (responseData.body && typeof responseData.body === 'string') {
          try {
            const nestedBody = JSON.parse(responseData.body);
            
            // If we have a nested error, throw it
            if (nestedBody.error) {
              throw new Error(`Lambda function error: ${nestedBody.error}`);
            }
            
            // Otherwise, try to use the nested body
            responseData = nestedBody;
          } catch (nestedError) {
            // If parsing the nested body fails, continue with the original response
            console.log('Could not parse nested body, using original response');
          }
        }
        
        // Check if direct error in response
        if (responseData.error) {
          throw new Error(`Token exchange failed: ${responseData.error}`);
        }
        
        // If response is not OK, throw error
        if (!response.ok) {
          throw new Error(`Lambda function error: ${response.status} - ${responseText}`);
        }
        
        // If success is explicitly false, throw error
        if (responseData.success === false) {
          throw new Error(`Token exchange failed: ${responseData.error || 'Unknown error'}`);
        }
        
        // Ensure we have tokenData
        if (!responseData.tokenData && !responseData.access_token) {
          throw new Error('Token data missing from response');
        }
        
        // Normalize response format
        const tokenData = responseData.tokenData || responseData;
        
      } catch (parseError) {
        throw new Error(`Invalid JSON response from Lambda: ${responseText}`);
      }

      const tokenData = responseData.tokenData || responseData;
      console.log('=== TOKEN EXCHANGE SUCCESS ===');
      console.log('Token type:', tokenData.token_type);
      console.log('Expires in:', tokenData.expires_in, 'seconds');
      console.log('Access token length:', tokenData.access_token?.length || 0);
      console.log('Refresh token present:', !!tokenData.refresh_token);
      
      this.storeTokens(tokenData);
      console.log('Tokens stored successfully');
      
      return tokenData;
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
   * Refresh access token using refresh token (also via Lambda if needed)
   */
  async refreshAccessToken() {
    const tokens = this.getStoredTokens();
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available');
    }

    // For now, use direct API call for refresh token
    // You could also route this through Lambda if needed
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