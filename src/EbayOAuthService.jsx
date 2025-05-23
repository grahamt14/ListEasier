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
    
    // Debug environment variables first
    console.log('Environment Variables Debug:');
    console.log('REACT_APP_EBAY_CLIENT_ID:', process.env.REACT_APP_EBAY_CLIENT_ID);
    console.log('REACT_APP_EBAY_CLIENT_SECRET:', process.env.REACT_APP_EBAY_CLIENT_SECRET ? '[SET]' : '[NOT SET]');
    console.log('REACT_APP_EBAY_REDIRECT_URI:', process.env.REACT_APP_EBAY_REDIRECT_URI);
    console.log('REACT_APP_EBAY_RU_NAME:', process.env.REACT_APP_EBAY_RU_NAME);
    
    this.credentials = {
      clientId: 'DavidJac-ListEasi-SBX-50e7167ce-0d788b93',
      clientSecret: 'SBX-0e7167ce0d788b93-8b89-4ac9-ba7f-5818',
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
      step5: "For AWS Amplify: Set environment variables in the Amplify console OR update credentials directly in code",
      environment: this.environment,
      redirectUri: this.credentials.redirectUri,
      amplifyInstructions: [
        "1. Go to AWS Amplify Console",
        "2. Select your app",
        "3. Go to Environment Variables",
        "4. Add the required variables",
        "5. Redeploy your app"
      ],
      requiredEnvVars: [
        'REACT_APP_EBAY_CLIENT_ID',
        'REACT_APP_EBAY_CLIENT_SECRET', 
        'REACT_APP_EBAY_REDIRECT_URI',
        'REACT_APP_EBAY_RU_NAME'
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
   * Exchange authorization code for access token with enhanced debugging
   */
  async exchangeCodeForToken(authorizationCode) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    const urls = this.getApiUrls();
    
    try {
      console.log('=== TOKEN EXCHANGE DEBUG ===');
      console.log('Authorization code received:', authorizationCode);
      console.log('Token URL:', urls.tokenUrl);
      console.log('Client ID:', this.credentials.clientId);
      console.log('Redirect URI:', this.credentials.redirectUri);
      
      // Prepare the request body - EXACT format required by eBay
      const requestBody = new URLSearchParams();
      requestBody.append('grant_type', 'authorization_code');
      requestBody.append('code', authorizationCode);
      requestBody.append('redirect_uri', this.credentials.redirectUri);
      
      console.log('Request body params:');
      for (const [key, value] of requestBody) {
        console.log(`  ${key}: ${value}`);
      }
      
      // Prepare headers - eBay requires specific format
      const authString = `${this.credentials.clientId}:${this.credentials.clientSecret}`;
      const base64Auth = btoa(authString);
      
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${base64Auth}`,
        'Accept': 'application/json'
      };
      
      console.log('Request headers:');
      console.log('  Content-Type:', headers['Content-Type']);
      console.log('  Authorization: Basic [REDACTED]');
      console.log('  Accept:', headers['Accept']);
      console.log('Auth string length:', authString.length);
      console.log('Base64 auth length:', base64Auth.length);
      
      // Make the request
      console.log('Making token exchange request...');
      const response = await fetch(urls.tokenUrl, {
        method: 'POST',
        headers: headers,
        body: requestBody.toString()
      });

      console.log('Response received:');
      console.log('  Status:', response.status);
      console.log('  Status Text:', response.statusText);
      console.log('  Headers:', Object.fromEntries(response.headers.entries()));

      const responseText = await response.text();
      console.log('  Raw response body:', responseText);

      if (!response.ok) {
        console.error('=== TOKEN EXCHANGE FAILED ===');
        console.error('Status:', response.status);
        console.error('Status Text:', response.statusText);
        console.error('Response:', responseText);
        
        let errorMessage = `Token exchange failed: ${response.status} ${response.statusText}`;
        let errorData = null;
        
        try {
          errorData = JSON.parse(responseText);
          console.error('Parsed error data:', errorData);
          
          if (errorData.error_description) {
            errorMessage += ` - ${errorData.error_description}`;
          }
          
          // Provide specific troubleshooting based on error
          if (errorData.error_id === 'invalid_request') {
            console.error('INVALID_REQUEST troubleshooting:');
            console.error('1. Check if redirect_uri matches exactly what is configured in eBay app');
            console.error('2. Verify authorization code is not expired (expires in 5 minutes)');
            console.error('3. Ensure client credentials are correct');
            console.error('4. Check that RuName is properly configured in eBay app');
            
            errorMessage += '\n\nPossible causes:';
            errorMessage += '\n• Redirect URI mismatch between request and eBay app configuration';
            errorMessage += '\n• Authorization code has expired (5 minute limit)';
            errorMessage += '\n• Invalid client credentials';
            errorMessage += '\n• RuName not properly configured in eBay Developer account';
          }
          
        } catch (parseError) {
          console.error('Could not parse error response as JSON:', parseError);
          errorMessage += ` - ${responseText}`;
        }
        
        throw new Error(errorMessage);
      }

      let tokenData;
      try {
        tokenData = JSON.parse(responseText);
        console.log('=== TOKEN EXCHANGE SUCCESS ===');
        console.log('Token type:', tokenData.token_type);
        console.log('Expires in:', tokenData.expires_in, 'seconds');
        console.log('Access token length:', tokenData.access_token?.length || 0);
        console.log('Refresh token present:', !!tokenData.refresh_token);
        
      } catch (parseError) {
        console.error('Could not parse successful response as JSON:', parseError);
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
      
      this.storeTokens(tokenData);
      console.log('Tokens stored successfully');
      
      return tokenData;
    } catch (error) {
      console.error('=== TOKEN EXCHANGE ERROR ===');
      console.error('Error details:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
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