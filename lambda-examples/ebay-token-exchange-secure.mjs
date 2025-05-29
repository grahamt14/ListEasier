// index.mjs - Secure AWS Lambda function for eBay OAuth token exchange
import https from 'https';
import { URLSearchParams } from 'url';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// AWS Secrets Manager client
const secretsManager = new SecretsManagerClient();

// Cache for credentials
let cachedCredentials = null;
let cacheExpiry = 0;

/**
 * Get eBay credentials from AWS Secrets Manager
 */
async function getEbayCredentials(environment) {
    // Check cache first
    if (cachedCredentials && Date.now() < cacheExpiry) {
        return cachedCredentials[environment];
    }

    try {
        const command = new GetSecretValueCommand({
            SecretId: process.env.EBAY_CREDENTIALS_SECRET_NAME || 'ebay-api-credentials'
        });
        
        console.log('Retrieving credentials from Secrets Manager...');
        const data = await secretsManager.send(command);
        const credentials = JSON.parse(data.SecretString);
        
        // Cache for 5 minutes
        cachedCredentials = credentials;
        cacheExpiry = Date.now() + (5 * 60 * 1000);
        
        if (!credentials[environment]) {
            throw new Error(`No credentials found for environment: ${environment}`);
        }
        
        return credentials[environment];
    } catch (error) {
        console.error('Error retrieving credentials from Secrets Manager:', error);
        throw new Error('Failed to retrieve credentials');
    }
}

/**
 * Lambda function to handle eBay OAuth token exchange and auth URL generation
 */
export const handler = async (event) => {
    console.log('Secure eBay OAuth Lambda function invoked');
    console.log('Event HTTP method:', event.httpMethod);
    
    // Enable CORS for all requests
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Cache-Control,Accept',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        console.log(`Invalid HTTP method: ${event.httpMethod}`);
        return {
            statusCode: 405,
            headers: corsHeaders,
            body: JSON.stringify({ success: false, error: 'Method not allowed' })
        };
    }

    try {
        // Parse the request body
        let body;
        try {
            body = JSON.parse(event.body);
            console.log('Parsed request body successfully');
            console.log('Action:', body.action);
            console.log('Environment:', body.environment);
        } catch (parseError) {
            console.error('Error parsing request body:', parseError);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Invalid JSON in request body',
                    details: parseError.message
                })
            };
        }
        
        const { environment = 'sandbox' } = body;

        // Get credentials from Secrets Manager
        const credentials = await getEbayCredentials(environment);
        console.log('Retrieved credentials for environment:', environment);
        console.log('Client ID:', credentials.clientId ? `${credentials.clientId.substring(0, 10)}...` : 'Not set');

        // Handle different actions
        if (body.action === 'getAuthUrl') {
            // Generate OAuth authorization URL
            const { redirectUri, scopes, state } = body;
            
            if (!redirectUri || !scopes) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        success: false, 
                        error: 'Missing required parameters: redirectUri and scopes' 
                    })
                };
            }

            const authUrls = {
                sandbox: 'https://auth.sandbox.ebay.com/oauth2/authorize',
                production: 'https://auth.ebay.com/oauth2/authorize'
            };

            const params = new URLSearchParams({
                client_id: credentials.clientId,
                redirect_uri: redirectUri,
                response_type: 'code',
                scope: scopes.join(' ')
            });
            
            if (state) {
                params.append('state', state);
            }
            
            const authUrl = `${authUrls[environment]}?${params.toString()}`;
            
            console.log('Generated auth URL successfully');
            
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: true,
                    authUrl: authUrl 
                })
            };
        }
        
        // Handle token exchange
        if (body.authorizationCode) {
            const { authorizationCode, timestamp } = body;

            console.log('Processing token exchange request');
            console.log('Auth code preview:', 
                `${authorizationCode.substring(0, 10)}...${authorizationCode.substring(authorizationCode.length - 10)}`
            );
            console.log('Request timestamp:', timestamp);

            // Use redirect URI from credentials or from request
            const redirectUri = body.redirectUri || credentials.redirectUri;
            
            if (!redirectUri) {
                return {
                    statusCode: 400,
                    headers: corsHeaders,
                    body: JSON.stringify({ 
                        success: false, 
                        error: 'Redirect URI not found in request or credentials' 
                    })
                };
            }

            console.log('Using redirect URI:', redirectUri);

            // eBay API endpoints
            const tokenUrls = {
                sandbox: 'api.sandbox.ebay.com',
                production: 'api.ebay.com'
            };

            const tokenPath = '/identity/v1/oauth2/token';
            const hostname = tokenUrls[environment];

            // Prepare the request data
            const params = new URLSearchParams();
            params.append('grant_type', 'authorization_code');
            params.append('code', authorizationCode);
            params.append('redirect_uri', redirectUri);
            
            const postData = params.toString();
            console.log('Request body length:', postData.length);

            // Prepare authorization header
            const authString = `${credentials.clientId}:${credentials.clientSecret}`;
            const base64Auth = Buffer.from(authString).toString('base64');

            // Prepare request options
            const options = {
                hostname: hostname,
                port: 443,
                path: tokenPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${base64Auth}`,
                    'Accept': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'User-Agent': 'ListEasier/1.0'
                }
            };

            console.log('Making eBay token exchange request...');
            console.log('Target URL:', `https://${hostname}${tokenPath}`);

            // Make the request to eBay
            const tokenData = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let responseBody = '';

                    res.on('data', (chunk) => {
                        responseBody += chunk;
                    });

                    res.on('end', () => {
                        console.log('eBay response status:', res.statusCode);
                        
                        if (res.statusCode === 200) {
                            console.log('Token exchange successful');
                            try {
                                const tokenData = JSON.parse(responseBody);
                                console.log('Token type:', tokenData.token_type);
                                console.log('Expires in:', tokenData.expires_in);
                                console.log('Has access token:', !!tokenData.access_token);
                                console.log('Has refresh token:', !!tokenData.refresh_token);
                                resolve(tokenData);
                            } catch (parseError) {
                                console.error('Failed to parse success response:', parseError);
                                reject(new Error(`Invalid JSON response from eBay: ${responseBody}`));
                            }
                        } else {
                            console.error('eBay API error response:', responseBody);
                            
                            try {
                                const errorData = JSON.parse(responseBody);
                                console.error('Error code:', errorData.error);
                                console.error('Error description:', errorData.error_description);
                                
                                if (errorData.error === 'invalid_grant') {
                                    console.error('Invalid grant - possible causes:');
                                    console.error('1. Authorization code already used');
                                    console.error('2. Authorization code expired (>5 minutes old)');
                                    console.error('3. Redirect URI mismatch');
                                    console.error('4. Wrong environment (sandbox vs production)');
                                }
                            } catch (e) {
                                console.error('Could not parse error response');
                            }
                            
                            reject(new Error(`eBay API error: ${res.statusCode} - ${responseBody}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('HTTPS request error:', error);
                    reject(error);
                });

                req.setTimeout(10000, () => {
                    console.error('Request timeout after 10 seconds');
                    req.destroy();
                    reject(new Error('Request timeout'));
                });

                req.write(postData);
                req.end();
            });

            console.log('Returning success response to client');
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    tokenData: tokenData,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Handle token refresh
        if (body.refreshToken) {
            const { refreshToken, scopes } = body;
            
            console.log('Processing token refresh request');

            const tokenUrls = {
                sandbox: 'api.sandbox.ebay.com',
                production: 'api.ebay.com'
            };

            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', refreshToken);
            params.append('scope', scopes.join(' '));
            
            const postData = params.toString();
            const authString = `${credentials.clientId}:${credentials.clientSecret}`;
            const base64Auth = Buffer.from(authString).toString('base64');

            const options = {
                hostname: tokenUrls[environment],
                port: 443,
                path: '/identity/v1/oauth2/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${base64Auth}`,
                    'Accept': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const tokenData = await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    let responseBody = '';
                    res.on('data', chunk => responseBody += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(responseBody));
                        } else {
                            reject(new Error(`Token refresh failed: ${res.statusCode} - ${responseBody}`));
                        }
                    });
                });

                req.on('error', reject);
                req.write(postData);
                req.end();
            });

            return {
                statusCode: 200,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: true,
                    tokenData: tokenData,
                    timestamp: new Date().toISOString()
                })
            };
        }

        // Invalid request
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
                success: false, 
                error: 'Invalid request. Specify action, authorizationCode, or refreshToken.' 
            })
        };
        
    } catch (error) {
        console.error('Lambda error:', error);
        console.error('Error stack:', error.stack);
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
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