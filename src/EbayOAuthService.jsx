// EbayOAuthService.js
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
    
    // Your eBay app credentials (these should be stored securely)
    this.credentials = {
      clientId: process.env.REACT_APP_EBAY_CLIENT_ID || 'YOUR_EBAY_CLIENT_ID',
      clientSecret: process.env.REACT_APP_EBAY_CLIENT_SECRET || 'YOUR_EBAY_CLIENT_SECRET',
      redirectUri: process.env.REACT_APP_EBAY_REDIRECT_URI || 'http://localhost:3000/ebay/callback',
      ruName: process.env.REACT_APP_EBAY_RU_NAME || 'YOUR_EBAY_RU_NAME'
    };
    
    // Required scopes for business policies
    this.scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
    ];
  }

  /**
   * Get the current API URLs based on environment
   */
  getApiUrls() {
    return this.config[this.environment];
  }

  /**
   * Generate the eBay OAuth authorization URL
   */
  generateAuthUrl(state = null) {
    const urls = this.getApiUrls();
    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: this.credentials.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      ...(state && { state })
    });

    return `${urls.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(authorizationCode) {
    const urls = this.getApiUrls();
    
    try {
      const response = await fetch(urls.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${this.credentials.clientId}:${this.credentials.clientSecret}`)}`
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: this.credentials.redirectUri
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token exchange failed: ${response.status} - ${errorData}`);
      }

      const tokenData = await response.json();
      
      // Store tokens securely (in a real app, use secure storage)
      this.storeTokens(tokenData);
      
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
    // In a real application, store these securely (encrypted, server-side)
    // For demo purposes, using localStorage (NOT recommended for production)
    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      token_type: tokenData.token_type,
      expires_at: Date.now() + (tokenData.expires_in * 1000)
    };
    
    localStorage.setItem('ebay_tokens', JSON.stringify(tokens));
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
        throw new Error(`Token refresh failed: ${response.status} - ${errorData}`);
      }

      const tokenData = await response.json();
      this.storeTokens(tokenData);
      
      return tokenData;
    } catch (error) {
      console.error('Error refreshing token:', error);
      // Clear invalid tokens
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
    const accessToken = await this.getValidAccessToken();
    const urls = this.getApiUrls();

    const defaultHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' // Default to US marketplace
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
      const response = await fetch(`${urls.apiUrl}${endpoint}`, requestOptions);

      if (response.status === 401) {
        // Token might be invalid, try refreshing
        try {
          await this.refreshAccessToken();
          const newAccessToken = await this.getValidAccessToken();
          
          // Retry with new token
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
        throw new Error(`API request failed: ${response.status} - ${errorData}`);
      }

      return await response.json();
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
      const response = await this.makeApiRequest('/sell/account/v1/fulfillment_policy');
      const fulfillmentPolicies = response.fulfillmentPolicies || [];

      const paymentResponse = await this.makeApiRequest('/sell/account/v1/payment_policy');
      const paymentPolicies = paymentResponse.paymentPolicies || [];

      const returnResponse = await this.makeApiRequest('/sell/account/v1/return_policy');
      const returnPolicies = returnResponse.returnPolicies || [];

      return {
        fulfillmentPolicies, // Shipping policies
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
   * Get user account information
   */
  async getUserAccount() {
    try {
      const response = await this.makeApiRequest('/sell/account/v1/privilege');
      return response;
    } catch (error) {
      console.error('Error fetching user account:', error);
      throw error;
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
  }

  /**
   * Get user profile information
   */
  async getUserProfile() {
    try {
      // Get basic user info from identity API
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