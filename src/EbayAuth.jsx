import React, { useState, useEffect } from 'react';
import EbayOAuthService from './EbayOAuthService';
import EbayMarketplaceSelector from './EbayMarketplaceSelector';

const EbayAuth = ({ onAuthSuccess, onAuthError }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [businessPolicies, setBusinessPolicies] = useState(null);
  const [error, setError] = useState(null);
  const [configurationError, setConfigurationError] = useState(false);
  
  const ebayService = new EbayOAuthService();

  useEffect(() => {
    // Check if service is properly configured
    if (!ebayService.isConfigured()) {
      setConfigurationError(true);
      const instructions = ebayService.getConfigurationInstructions();
      setError(`eBay OAuth is not configured. Please set up your eBay Developer credentials first.`);
      console.log('Configuration instructions:', instructions);
      return;
    }

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
        setError(`Authentication failed: ${error.message}`);
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
    if (!ebayService.isConfigured()) {
      setError('eBay OAuth service is not properly configured. Please check your credentials.');
      return;
    }

    setError(null);
    setIsLoading(true);
    
    try {
      // Generate a random state parameter for CSRF protection
      const state = Math.random().toString(36).substring(2, 15);
      
      // Redirect to eBay OAuth
      const authUrl = ebayService.generateAuthUrl(state);
      console.log('Redirecting to eBay OAuth:', authUrl);
      window.location.href = authUrl;
    } catch (error) {
      console.error('Error generating auth URL:', error);
      setError(`Failed to initialize authentication: ${error.message}`);
      setIsLoading(false);
    }
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

  const showConfigurationHelp = () => {
    const instructions = ebayService.getConfigurationInstructions();
    
    alert(`eBay Configuration Required:

1. Go to ${instructions.step1}
2. ${instructions.step2}
3. ${instructions.step3}
4. ${instructions.step4}
5. Set these environment variables:
   ${instructions.requiredEnvVars.join('\n   ')}

Current environment: ${instructions.environment}
Redirect URI should be: ${instructions.redirectUri}

Check the browser console for more details.`);
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

  if (configurationError) {
    return (
      <div className="ebay-auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/1/1b/EBay_logo.svg" 
              alt="eBay" 
              className="ebay-logo"
            />
            <h3>eBay Configuration Required</h3>
            <p>Your eBay Developer credentials need to be configured before you can connect.</p>
          </div>
          
          {error && (
            <div className="auth-error">
              <p>{error}</p>
            </div>
          )}
          
          <div className="auth-benefits">
            <h4>Setup Steps:</h4>
            <ul>
              <li>🔧 Create an eBay Developer Account at developer.ebay.com</li>
              <li>📝 Create a new application in your developer account</li>
              <li>🔑 Copy your Client ID and Client Secret</li>
              <li>🔗 Create a RuName with your callback URL</li>
              <li>⚙️ Set environment variables or update credentials in code</li>
            </ul>
          </div>
          
          <button 
            className="ebay-connect-button"
            onClick={showConfigurationHelp}
          >
            Show Configuration Instructions
          </button>
          
          <div className="auth-footer">
            <p><small>Check the browser console for detailed configuration information.</small></p>
          </div>
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
              <button 
                onClick={showConfigurationHelp}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#007bff',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  marginTop: '8px'
                }}
              >
                Need help with configuration?
              </button>
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