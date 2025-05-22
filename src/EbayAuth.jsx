import React, { useState, useEffect } from 'react';

// Inline eBay OAuth Service
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
      clientId: 'YOUR_EBAY_CLIENT_ID', // Replace with your actual eBay Client ID
      clientSecret: 'YOUR_EBAY_CLIENT_SECRET', // Replace with your actual eBay Client Secret
      redirectUri: 'http://localhost:3000/ebay/callback', // Replace with your actual redirect URI
      ruName: 'YOUR_EBAY_RU_NAME' // Replace with your actual RU Name
    };
    
    // Required scopes for business policies
    this.scopes = [
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly'
    ];
  }

  getApiUrls() {
    return this.config[this.environment];
  }

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
      this.storeTokens(tokenData);
      return tokenData;
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  storeTokens(tokenData) {
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

  getStoredTokens() {
    const stored = localStorage.getItem('ebay_tokens');
    if (!stored) return null;
    
    try {
      const tokens = JSON.parse(stored);
      
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
      localStorage.removeItem('ebay_tokens');
      throw error;
    }
  }

  async getValidAccessToken() {
    let tokens = this.getStoredTokens();
    
    if (!tokens) {
      throw new Error('No tokens available. User needs to authenticate.');
    }

    if (Date.now() >= (tokens.expires_at - 300000)) {
      tokens = await this.refreshAccessToken();
    }

    return tokens.access_token;
  }

  async makeApiRequest(endpoint, options = {}) {
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
      const response = await fetch(`${urls.apiUrl}${endpoint}`, requestOptions);

      if (response.status === 401) {
        try {
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
        throw new Error(`API request failed: ${response.status} - ${errorData}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request error:', error);
      throw error;
    }
  }

  async getBusinessPolicies() {
    try {
      const response = await this.makeApiRequest('/sell/account/v1/fulfillment_policy');
      const fulfillmentPolicies = response.fulfillmentPolicies || [];

      const paymentResponse = await this.makeApiRequest('/sell/account/v1/payment_policy');
      const paymentPolicies = paymentResponse.paymentPolicies || [];

      const returnResponse = await this.makeApiRequest('/sell/account/v1/return_policy');
      const returnPolicies = returnResponse.returnPolicies || [];

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

  isAuthenticated() {
    const tokens = this.getStoredTokens();
    return tokens !== null;
  }

  logout() {
    localStorage.removeItem('ebay_tokens');
  }
}

const EbayAuth = ({ onAuthSuccess, onAuthError }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [businessPolicies, setBusinessPolicies] = useState(null);
  const [error, setError] = useState(null);
  
  const ebayService = new EbayOAuthService();

  useEffect(() => {
    // Check if user is already authenticated
    checkAuthStatus();
    
    // Handle OAuth callback
    handleOAuthCallback();
  }, []);

  const checkAuthStatus = async () => {
    if (ebayService.isAuthenticated()) {
      setIsAuthenticated(true);
      try {
        await loadUserData();
      } catch (error) {
        console.error('Error loading user data:', error);
        setError('Failed to load user data');
      }
    }
  };

  const handleOAuthCallback = async () => {
    // Check if this is an OAuth callback with authorization code
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const error = urlParams.get('error');
    const state = urlParams.get('state');

    if (error) {
      setError(`Authentication failed: ${error}`);
      onAuthError?.(error);
      return;
    }

    if (authCode) {
      setIsLoading(true);
      try {
        await ebayService.exchangeCodeForToken(authCode);
        setIsAuthenticated(true);
        await loadUserData();
        
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
        
        onAuthSuccess?.();
      } catch (error) {
        console.error('OAuth callback error:', error);
        setError('Authentication failed. Please try again.');
        onAuthError?.(error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const loadUserData = async () => {
    try {
      // Load user profile and business policies in parallel
      const [profileData, policiesData] = await Promise.all([
        ebayService.getUserProfile().catch(err => {
          console.warn('Could not load profile:', err);
          return null;
        }),
        ebayService.getBusinessPolicies()
      ]);

      setUserProfile(profileData);
      setBusinessPolicies(policiesData);
      
    } catch (error) {
      console.error('Error loading user data:', error);
      throw error;
    }
  };

  const handleLogin = () => {
    setError(null);
    setIsLoading(true);
    
    // Generate a random state parameter for CSRF protection
    const state = Math.random().toString(36).substring(2, 15);
    
    // Redirect to eBay OAuth
    const authUrl = ebayService.generateAuthUrl(state);
    window.location.href = authUrl;
  };

  const handleLogout = () => {
    ebayService.logout();
    setIsAuthenticated(false);
    setUserProfile(null);
    setBusinessPolicies(null);
    setError(null);
  };

  const handleRefreshPolicies = async () => {
    setIsLoading(true);
    try {
      const policiesData = await ebayService.getBusinessPolicies();
      setBusinessPolicies(policiesData);
    } catch (error) {
      setError('Failed to refresh business policies');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="ebay-auth-container">
        <div className="auth-loading">
          <div className="spinner">
            <div className="spinner-circle"></div>
          </div>
          <p>Connecting to eBay...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="ebay-auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg" 
              alt="eBay" 
              className="ebay-logo"
            />
            <h3>Connect Your eBay Account</h3>
            <p>Connect your eBay account to automatically import your payment, shipping, and return policies.</p>
          </div>
          
          {error && (
            <div className="auth-error">
              <p>{error}</p>
            </div>
          )}
          
          <div className="auth-benefits">
            <h4>Benefits of connecting:</h4>
            <ul>
              <li>✅ Auto-import payment policies</li>
              <li>✅ Auto-import shipping policies</li>
              <li>✅ Auto-import return policies</li>
              <li>✅ Streamlined listing creation</li>
              <li>✅ Consistent policy application</li>
            </ul>
          </div>
          
          <button 
            className="ebay-connect-button"
            onClick={handleLogin}
            disabled={isLoading}
          >
            Connect to eBay
          </button>
          
          <div className="auth-footer">
            <p><small>Your eBay credentials are handled securely through eBay's official OAuth system.</small></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ebay-auth-container">
      <div className="auth-card authenticated">
        <div className="auth-header">
          <img 
            src="https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg" 
            alt="eBay" 
            className="ebay-logo"
          />
          <div className="auth-status">
            <span className="status-indicator connected">●</span>
            <span>Connected to eBay</span>
          </div>
        </div>

        {userProfile && (
          <div className="user-profile">
            <h4>Account Information</h4>
            <div className="profile-info">
              <p><strong>User ID:</strong> {userProfile.userId || 'N/A'}</p>
              {userProfile.username && <p><strong>Username:</strong> {userProfile.username}</p>}
              {userProfile.registrationMarketplaceId && (
                <p><strong>Marketplace:</strong> {userProfile.registrationMarketplaceId}</p>
              )}
            </div>
          </div>
        )}

        {businessPolicies && (
          <div className="business-policies">
            <div className="policies-header">
              <h4>Business Policies</h4>
              <button 
                className="refresh-button"
                onClick={handleRefreshPolicies}
                disabled={isLoading}
              >
                🔄 Refresh
              </button>
            </div>

            <div className="policies-grid">
              <div className="policy-section">
                <h5>Payment Policies ({businessPolicies.paymentPolicies?.length || 0})</h5>
                {businessPolicies.paymentPolicies?.length > 0 ? (
                  <ul className="policy-list">
                    {businessPolicies.paymentPolicies.slice(0, 3).map((policy, index) => (
                      <li key={index} className="policy-item">
                        <span className="policy-name">{policy.name}</span>
                        <span className="policy-id">ID: {policy.paymentPolicyId}</span>
                      </li>
                    ))}
                    {businessPolicies.paymentPolicies.length > 3 && (
                      <li className="policy-more">
                        +{businessPolicies.paymentPolicies.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="no-policies">No payment policies found</p>
                )}
              </div>

              <div className="policy-section">
                <h5>Shipping Policies ({businessPolicies.fulfillmentPolicies?.length || 0})</h5>
                {businessPolicies.fulfillmentPolicies?.length > 0 ? (
                  <ul className="policy-list">
                    {businessPolicies.fulfillmentPolicies.slice(0, 3).map((policy, index) => (
                      <li key={index} className="policy-item">
                        <span className="policy-name">{policy.name}</span>
                        <span className="policy-id">ID: {policy.fulfillmentPolicyId}</span>
                      </li>
                    ))}
                    {businessPolicies.fulfillmentPolicies.length > 3 && (
                      <li className="policy-more">
                        +{businessPolicies.fulfillmentPolicies.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="no-policies">No shipping policies found</p>
                )}
              </div>

              <div className="policy-section">
                <h5>Return Policies ({businessPolicies.returnPolicies?.length || 0})</h5>
                {businessPolicies.returnPolicies?.length > 0 ? (
                  <ul className="policy-list">
                    {businessPolicies.returnPolicies.slice(0, 3).map((policy, index) => (
                      <li key={index} className="policy-item">
                        <span className="policy-name">{policy.name}</span>
                        <span className="policy-id">ID: {policy.returnPolicyId}</span>
                      </li>
                    ))}
                    {businessPolicies.returnPolicies.length > 3 && (
                      <li className="policy-more">
                        +{businessPolicies.returnPolicies.length - 3} more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="no-policies">No return policies found</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="auth-actions">
          <button 
            className="disconnect-button"
            onClick={handleLogout}
          >
            Disconnect eBay Account
          </button>
        </div>
      </div>
    </div>
  );
};

export default EbayAuth;