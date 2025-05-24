// EbayOAuthService.js - Enhanced with debugging for invalid_grant issue
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
    
    // Lambda function URL for token exchange
    this.lambdaTokenEndpoint = 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-token-exchange';
    
    // Store auth state to prevent reuse
    this.authState = {
      lastAuthCode: null,
      lastAuthTime: null,
      pendingExchange: false
    };
    
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
    console.log('Redirect URI:', this.credentials.redirectUri);
    console.log('Lambda Endpoint:', this.lambdaTokenEndpoint);
    
    this.validateConfiguration();
  }

  validateConfiguration() {
    const required = ['clientId', 'clientSecret', 'redirectUri'];
    const missing = required.filter(key => {
      const value = this.credentials[key];
      return !value || value === '' || value.startsWith('YOUR_') || value.startsWith('PASTE_YOUR_');
    });
    
    if (missing.length > 0) {
      console.error('eBay OAuth Configuration Error: Missing credentials:', missing);
      this.configurationValid = false;
    } else {
      this.configurationValid = true;
      console.log('eBay OAuth configuration validated successfully');
    }
  }

  isConfigured() {
    return this.configurationValid;
  }

  getApiUrls() {
    return this.config[this.environment];
  }

  generateAuthUrl(state = null) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    const urls = this.getApiUrls();
    
    // Clear any pending exchange state when generating new auth URL
    this.authState = {
      lastAuthCode: null,
      lastAuthTime: null,
      pendingExchange: false
    };
    
    const params = {
      client_id: this.credentials.clientId,
      redirect_uri: this.credentials.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' ')
    };
    
    if (state) {
      params.state = state;
      // Store state for verification
      sessionStorage.setItem('ebay_oauth_state', state);
    }
    
    const urlParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      urlParams.append(key, value);
    });
    
    const authUrl = `${urls.authUrl}?${urlParams.toString()}`;
    console.log('Generated eBay auth URL:', authUrl);
    console.log('State parameter:', state);
    
    return authUrl;
  }

  async exchangeCodeForToken(authorizationCode) {
    if (!this.isConfigured()) {
      throw new Error('eBay OAuth service is not properly configured.');
    }

    // Check if we're already processing this code
    if (this.authState.pendingExchange) {
      console.warn('Token exchange already in progress, preventing duplicate request');
      throw new Error('Token exchange already in progress');
    }

    // Check if this code was already used
    if (this.authState.lastAuthCode === authorizationCode) {
      const timeSinceLastAuth = Date.now() - this.authState.lastAuthTime;
      console.error(`Authorization code was already used ${timeSinceLastAuth}ms ago`);
      throw new Error('Authorization code has already been used');
    }

    // Mark exchange as pending
    this.authState.pendingExchange = true;
    this.authState.lastAuthCode = authorizationCode;
    this.authState.lastAuthTime = Date.now();

    try {
      console.log('=== TOKEN EXCHANGE VIA LAMBDA ===');
      console.log('Authorization code:', authorizationCode);
      console.log('Code length:', authorizationCode.length);
      console.log('Lambda endpoint:', this.lambdaTokenEndpoint);
      console.log('Environment:', this.environment);
      console.log('Timestamp:', new Date().toISOString());
      
      // Check stored state
      const storedState = sessionStorage.getItem('ebay_oauth_state');
      console.log('Stored OAuth state:', storedState);
      
      const requestBody = {
        authorizationCode: authorizationCode,
        environment: this.environment,
        timestamp: Date.now() // Add timestamp to prevent caching
      };
      
      console.log('Request body:', JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(this.lambdaTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache' // Prevent caching
        },
        body: JSON.stringify(requestBody)
      });

      console.log('Lambda response status:', response.status);
      const responseText = await response.text();
      console.log('Lambda response body:', responseText);

      if (!response.ok) {
        // Parse error details
        let errorDetails;
        try {
          errorDetails = JSON.parse(responseText);
          console.error('Lambda error details:', errorDetails);
          
          // Check for specific eBay error codes
          if (errorDetails.error && errorDetails.error.includes('invalid_grant')) {
            console.error('Invalid grant error - authorization code issue');
            // Clear stored tokens to force re-authentication
            this.logout();
          }
        } catch (e) {
          errorDetails = { error: responseText };
        }
        
        throw new Error(`Lambda function error: ${response.status} - ${responseText}`);
      }

      // Parse successful response
      let responseData;
      try {
        responseData = JSON.parse(responseText);
        const tokenData = responseData.tokenData || responseData;
        
        if (!tokenData || !tokenData.access_token) {
          throw new Error('Invalid token data received from Lambda');
        }
        
        console.log('=== TOKEN EXCHANGE SUCCESS ===');
        console.log('Token type:', tokenData.token_type);
        console.log('Expires in:', tokenData.expires_in, 'seconds');
        console.log('Has refresh token:', !!tokenData.refresh_token);
        
        this.storeTokens(tokenData);
        
        // Clear OAuth state after successful exchange
        sessionStorage.removeItem('ebay_oauth_state');
        
        return tokenData;
      } catch (parseError) {
        console.error('Error parsing token response:', parseError);
        throw new Error(`Invalid response from Lambda: ${responseText}`);
      }
    } catch (error) {
      console.error('=== TOKEN EXCHANGE ERROR ===');
      console.error('Full error:', error);
      throw error;
    } finally {
      // Clear pending state after a delay to prevent rapid retries
      setTimeout(() => {
        this.authState.pendingExchange = false;
      }, 2000);
    }
  }

  storeTokens(tokenData) {
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      stored_at: Date.now()
    };
    
    localStorage.setItem('ebay_tokens', JSON.stringify(tokens));
    console.log('Tokens stored at:', new Date().toISOString());
    return tokens;
  }

  getStoredTokens() {
    const stored = localStorage.getItem('ebay_tokens');
    if (!stored) return null;
    
    try {
      const tokens = JSON.parse(stored);
      console.log('Retrieved tokens, stored at:', new Date(tokens.stored_at).toISOString());
      
      // Check if tokens are expired
      if (Date.now() >= tokens.expires_at) {
        console.log('Tokens expired, clearing storage');
        localStorage.removeItem('ebay_tokens');
        return null;
      }
      
      return tokens;
    } catch (error) {
      console.error('Error parsing stored tokens:', error);
      return null;
    }
  }

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

  isAuthenticated() {
    const tokens = this.getStoredTokens();
    return tokens !== null;
  }

  logout() {
    localStorage.removeItem('ebay_tokens');
    sessionStorage.removeItem('ebay_oauth_state');
    this.authState = {
      lastAuthCode: null,
      lastAuthTime: null,
      pendingExchange: false
    };
    console.log('User logged out, tokens and state cleared');
  }

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
}

export default EbayOAuthService;