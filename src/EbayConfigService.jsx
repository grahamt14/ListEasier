// EbayConfigService.jsx - Secure configuration management for eBay integration
class EbayConfigService {
  constructor() {
    // Environment configuration
    this.environment = process.env.REACT_APP_EBAY_ENVIRONMENT || 'sandbox';
    
    // Lambda endpoints (these are safe to have in frontend)
    this.lambdaEndpoints = {
      tokenExchange: process.env.REACT_APP_LAMBDA_TOKEN_ENDPOINT || 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-token-exchange',
      apiProxy: process.env.REACT_APP_LAMBDA_API_PROXY_ENDPOINT || 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-api-proxy',
      createListing: process.env.REACT_APP_LAMBDA_CREATE_LISTING_ENDPOINT || 'https://xospzjj5da.execute-api.us-east-2.amazonaws.com/prod/ebay-create-listing'
    };
    
    // Public configuration (safe for frontend)
    this.publicConfig = {
      // OAuth redirect URI (public information)
      redirectUri: process.env.REACT_APP_EBAY_REDIRECT_URI || window.location.origin + '/ebay/callback',
      
      // API URLs by environment
      urls: {
        production: {
          authUrl: 'https://auth.ebay.com/oauth2/authorize',
          tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
          apiUrl: 'https://api.ebay.com'
        },
        sandbox: {
          authUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
          tokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
          apiUrl: 'https://api.sandbox.ebay.com'
        }
      },
      
      // OAuth scopes (public information)
      scopes: [
        'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
        'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
        'https://api.ebay.com/oauth/api_scope/sell.inventory',
        'https://api.ebay.com/oauth/api_scope/sell.account',
        'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly'
      ]
    };
    
    // DO NOT store sensitive credentials here
    // Client ID and Client Secret should be handled by Lambda functions only
    
    this.validateConfiguration();
  }
  
  /**
   * Get the current environment
   */
  getEnvironment() {
    return this.environment;
  }
  
  /**
   * Set the environment (sandbox/production)
   */
  setEnvironment(env) {
    if (env === 'sandbox' || env === 'production') {
      this.environment = env;
      localStorage.setItem('ebay_environment', env);
      console.log('eBay environment set to:', env);
    } else {
      console.error('Invalid environment:', env);
    }
  }
  
  /**
   * Get OAuth authorization URL
   * Note: Client ID will be injected by Lambda function
   */
  async getAuthorizationUrl(state = null) {
    try {
      // Request auth URL from Lambda which has access to client ID
      const response = await fetch(this.lambdaEndpoints.tokenExchange, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'getAuthUrl',
          environment: this.environment,
          redirectUri: this.publicConfig.redirectUri,
          scopes: this.publicConfig.scopes,
          state: state
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to get authorization URL');
      }
      
      const data = await response.json();
      return data.authUrl;
    } catch (error) {
      console.error('Error getting authorization URL:', error);
      throw error;
    }
  }
  
  /**
   * Get Lambda endpoints
   */
  getLambdaEndpoints() {
    return this.lambdaEndpoints;
  }
  
  /**
   * Get public configuration
   */
  getPublicConfig() {
    return this.publicConfig;
  }
  
  /**
   * Get API URLs for current environment
   */
  getApiUrls() {
    return this.publicConfig.urls[this.environment];
  }
  
  /**
   * Validate configuration
   */
  validateConfiguration() {
    const issues = [];
    
    // Check Lambda endpoints
    Object.entries(this.lambdaEndpoints).forEach(([key, value]) => {
      if (!value || value.includes('YOUR_')) {
        issues.push(`Lambda endpoint '${key}' is not configured`);
      }
    });
    
    // Check redirect URI
    if (!this.publicConfig.redirectUri) {
      issues.push('Redirect URI is not configured');
    }
    
    if (issues.length > 0) {
      console.warn('Configuration issues found:', issues);
      this.configurationValid = false;
    } else {
      console.log('eBay configuration validated successfully');
      this.configurationValid = true;
    }
    
    return {
      valid: this.configurationValid,
      issues: issues
    };
  }
  
  /**
   * Check if service is configured
   */
  isConfigured() {
    return this.configurationValid;
  }
  
  /**
   * Get secure setup instructions
   */
  getSecureSetupInstructions() {
    return {
      frontend: {
        step1: "Never store Client ID or Client Secret in frontend code",
        step2: "Use environment variables for Lambda endpoints only",
        step3: "Configure redirect URI in .env file",
        requiredEnvVars: [
          'REACT_APP_EBAY_ENVIRONMENT (sandbox/production)',
          'REACT_APP_EBAY_REDIRECT_URI',
          'REACT_APP_LAMBDA_TOKEN_ENDPOINT',
          'REACT_APP_LAMBDA_API_PROXY_ENDPOINT',
          'REACT_APP_LAMBDA_CREATE_LISTING_ENDPOINT'
        ]
      },
      backend: {
        step1: "Store eBay credentials in AWS Secrets Manager",
        step2: "Configure Lambda functions with IAM role to access secrets",
        step3: "Update Lambda environment variables to specify secret name",
        secretStructure: {
          secretName: 'ebay-api-credentials',
          keys: {
            'sandbox': {
              clientId: 'Your sandbox Client ID',
              clientSecret: 'Your sandbox Client Secret',
              ruName: 'Your sandbox RuName'
            },
            'production': {
              clientId: 'Your production Client ID',
              clientSecret: 'Your production Client Secret',
              ruName: 'Your production RuName'
            }
          }
        }
      }
    };
  }
}

export default EbayConfigService;