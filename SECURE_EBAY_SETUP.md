# Secure eBay API Credential Setup

This guide explains how to securely configure eBay API credentials for ListEasier.

## Overview

For security reasons, eBay API credentials (Client ID, Client Secret, and RuName) are no longer stored in the frontend application. Instead, they are securely managed by AWS Lambda functions and stored in AWS Secrets Manager.

## Architecture

```
Frontend (React) → Lambda Functions → AWS Secrets Manager → eBay API
```

## Setup Steps

### 1. AWS Secrets Manager Configuration

Create a secret in AWS Secrets Manager with the name `ebay-api-credentials` containing:

```json
{
  "sandbox": {
    "clientId": "your-sandbox-client-id",
    "clientSecret": "your-sandbox-client-secret",
    "ruName": "your-sandbox-runame"
  },
  "production": {
    "clientId": "your-production-client-id",
    "clientSecret": "your-production-client-secret",
    "ruName": "your-production-runame"
  }
}
```

### 2. Lambda Function Updates

Update your Lambda functions to retrieve credentials from Secrets Manager:

```javascript
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager();

async function getEbayCredentials(environment) {
  const params = {
    SecretId: 'ebay-api-credentials'
  };
  
  const data = await secretsManager.getSecretValue(params).promise();
  const credentials = JSON.parse(data.SecretString);
  
  return credentials[environment];
}
```

### 3. Lambda IAM Role Permissions

Ensure your Lambda execution role has permission to read the secret:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:region:account-id:secret:ebay-api-credentials-*"
    }
  ]
}
```

### 4. Frontend Environment Variables

Create a `.env` file in your project root (copy from `.env.example`):

```bash
# Environment: sandbox or production
REACT_APP_EBAY_ENVIRONMENT=production

# OAuth Redirect URI
REACT_APP_EBAY_REDIRECT_URI=https://your-app-url.com/ebay/callback

# Lambda Function Endpoints
REACT_APP_LAMBDA_TOKEN_ENDPOINT=https://your-api-gateway-url/prod/ebay-token-exchange
REACT_APP_LAMBDA_API_PROXY_ENDPOINT=https://your-api-gateway-url/prod/ebay-api-proxy
REACT_APP_LAMBDA_CREATE_LISTING_ENDPOINT=https://your-api-gateway-url/prod/ebay-create-listing
```

### 5. Update Lambda Function for Auth URL Generation

Add a new endpoint to your token exchange Lambda to generate auth URLs:

```javascript
if (event.action === 'getAuthUrl') {
  const credentials = await getEbayCredentials(event.environment);
  
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: event.redirectUri,
    response_type: 'code',
    scope: event.scopes.join(' ')
  });
  
  if (event.state) {
    params.append('state', event.state);
  }
  
  const authUrl = `${getAuthBaseUrl(event.environment)}?${params.toString()}`;
  
  return {
    statusCode: 200,
    body: JSON.stringify({ authUrl })
  };
}
```

## Security Benefits

1. **No Client Secrets in Frontend**: Client Secret never leaves AWS infrastructure
2. **Centralized Credential Management**: Easy to rotate credentials without code changes
3. **Environment Isolation**: Separate credentials for sandbox/production
4. **Audit Trail**: AWS CloudTrail logs all access to secrets
5. **Access Control**: IAM policies control who can access credentials

## Migration Checklist

- [ ] Create AWS Secrets Manager secret with eBay credentials
- [ ] Update Lambda functions to use Secrets Manager
- [ ] Add IAM permissions for Lambda to access secrets
- [ ] Update Lambda to handle auth URL generation
- [ ] Remove hardcoded credentials from frontend code
- [ ] Update `.env` file with Lambda endpoints
- [ ] Test OAuth flow in sandbox environment
- [ ] Test OAuth flow in production environment
- [ ] Delete old credentials from git history (if needed)

## Troubleshooting

### Common Issues

1. **"Failed to generate authorization URL"**
   - Check Lambda function logs
   - Verify Secrets Manager contains correct credentials
   - Ensure Lambda has IAM permissions

2. **"Token exchange failed"**
   - Verify redirect URI matches eBay app configuration
   - Check environment (sandbox vs production)
   - Ensure Lambda can access Secrets Manager

3. **"API calls failing"**
   - Check if tokens are expired
   - Verify Lambda proxy is correctly forwarding requests
   - Check eBay API rate limits

## Support

For issues with the secure setup, check:
1. AWS CloudWatch logs for Lambda functions
2. Browser console for frontend errors
3. Network tab for API request/response details