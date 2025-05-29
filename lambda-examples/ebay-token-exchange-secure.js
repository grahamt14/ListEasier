// Example Lambda function for secure eBay token exchange
const AWS = require('aws-sdk');
const axios = require('axios');

const secretsManager = new AWS.SecretsManager();

// Cache credentials for performance
let cachedCredentials = null;
let cacheExpiry = 0;

async function getEbayCredentials(environment) {
  // Check cache first
  if (cachedCredentials && Date.now() < cacheExpiry) {
    return cachedCredentials[environment];
  }

  try {
    const params = {
      SecretId: process.env.EBAY_CREDENTIALS_SECRET_NAME || 'ebay-api-credentials'
    };
    
    const data = await secretsManager.getSecretValue(params).promise();
    const credentials = JSON.parse(data.SecretString);
    
    // Cache for 5 minutes
    cachedCredentials = credentials;
    cacheExpiry = Date.now() + (5 * 60 * 1000);
    
    return credentials[environment];
  } catch (error) {
    console.error('Error retrieving credentials from Secrets Manager:', error);
    throw new Error('Failed to retrieve credentials');
  }
}

function getEbayUrls(environment) {
  const urls = {
    production: {
      authUrl: 'https://auth.ebay.com/oauth2/authorize',
      tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token'
    },
    sandbox: {
      authUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
      tokenUrl: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    }
  };
  
  return urls[environment] || urls.sandbox;
}

exports.handler = async (event) => {
  console.log('Request:', JSON.stringify(event));
  
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const environment = body.environment || 'sandbox';
    
    // Handle different actions
    if (body.action === 'getAuthUrl') {
      // Generate OAuth authorization URL
      const credentials = await getEbayCredentials(environment);
      const urls = getEbayUrls(environment);
      
      const params = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: body.redirectUri,
        response_type: 'code',
        scope: body.scopes.join(' ')
      });
      
      if (body.state) {
        params.append('state', body.state);
      }
      
      const authUrl = `${urls.authUrl}?${params.toString()}`;
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ authUrl })
      };
    }
    
    // Handle token exchange
    if (body.authorizationCode) {
      const credentials = await getEbayCredentials(environment);
      const urls = getEbayUrls(environment);
      
      // Exchange authorization code for tokens
      const tokenData = new URLSearchParams({
        grant_type: 'authorization_code',
        code: body.authorizationCode,
        redirect_uri: credentials.redirectUri || body.redirectUri
      });
      
      const response = await axios.post(urls.tokenUrl, tokenData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`
        }
      });
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          tokenData: response.data
        })
      };
    }
    
    // Handle token refresh
    if (body.refreshToken) {
      const credentials = await getEbayCredentials(environment);
      const urls = getEbayUrls(environment);
      
      const tokenData = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: body.refreshToken,
        scope: body.scopes.join(' ')
      });
      
      const response = await axios.post(urls.tokenUrl, tokenData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`
        }
      });
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          tokenData: response.data
        })
      };
    }
    
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Invalid request. Specify action, authorizationCode, or refreshToken.'
      })
    };
    
  } catch (error) {
    console.error('Lambda error:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: error.message,
        details: error.response?.data
      })
    };
  }
};

// Environment variables required:
// EBAY_CREDENTIALS_SECRET_NAME - Name of the secret in AWS Secrets Manager

// IAM Role permissions required:
// {
//   "Version": "2012-10-17",
//   "Statement": [
//     {
//       "Effect": "Allow",
//       "Action": [
//         "secretsmanager:GetSecretValue"
//       ],
//       "Resource": "arn:aws:secretsmanager:region:account-id:secret:ebay-api-credentials-*"
//     }
//   ]
// }