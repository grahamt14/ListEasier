import https from 'https';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// AWS Secrets Manager client
const secretsManager = new SecretsManagerClient();

// Cache for credentials
let cachedCredentials = null;
let cacheExpiry = 0;

// Create persistent HTTPS agent for connection pooling
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000,
    freeSocketTimeout: 15000
});

// Connection pool for different eBay environments
const connectionPools = {
    sandbox: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 25,
        maxFreeSockets: 5,
        timeout: 30000
    }),
    production: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 30000
    })
};

// Get eBay credentials from Secrets Manager
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
        
        return credentials[environment];
    } catch (error) {
        console.error('Error retrieving credentials from Secrets Manager:', error);
        throw new Error('Failed to retrieve credentials');
    }
}

export const handler = async (event) => {
    console.log('eBay API Proxy with secure credentials');
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept',
        'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE'
    };

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { 
            endpoint, 
            method = 'GET', 
            accessToken, 
            environment = 'sandbox',
            requestBody,
            headers: customHeaders = {},
            queryParams = {}
        } = body;

        if (!endpoint || !accessToken) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Missing required parameters' 
                })
            };
        }

        // Note: API proxy doesn't need credentials, but we validate environment
        const validEnvironments = ['sandbox', 'production'];
        if (!validEnvironments.includes(environment)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Invalid environment. Must be sandbox or production' 
                })
            };
        }

        const apiUrls = {
            sandbox: 'api.sandbox.ebay.com',
            production: 'api.ebay.com'
        };

        const hostname = apiUrls[environment];
        const marketplaceId = customHeaders['X-EBAY-C-MARKETPLACE-ID'] || 'EBAY_US';
        
        // Build query string
        let queryString = '';
        const finalQueryParams = { ...queryParams };
        
        const needsMarketplace = [
            '/sell/account/v1/payment_policy',
            '/sell/account/v1/fulfillment_policy',
            '/sell/account/v1/return_policy'
        ];
        
        if (needsMarketplace.some(path => endpoint.startsWith(path))) {
            finalQueryParams.marketplace_id = marketplaceId;
        }
        
        if (Object.keys(finalQueryParams).length > 0) {
            queryString = '?' + new URLSearchParams(finalQueryParams).toString();
        }
        
        const fullPath = endpoint + queryString;
        
        const defaultHeaders = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
            'User-Agent': 'ListEasier/1.0',
            'Connection': 'keep-alive',
            ...customHeaders
        };

        // Use appropriate connection pool based on environment
        const agent = connectionPools[environment] || httpsAgent;

        const options = {
            hostname: hostname,
            port: 443,
            path: fullPath,
            method: method,
            headers: defaultHeaders,
            agent: agent,
            timeout: 30000
        };

        console.log(`Proxying ${environment} request to: ${hostname}${fullPath}`);

        const ebayResponse = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseBody = '';

                res.on('data', (chunk) => {
                    responseBody += chunk;
                });

                res.on('end', () => {
                    console.log('eBay API response status:', res.statusCode);
                    
                    let responseData;
                    const contentType = res.headers['content-type'] || '';
                    
                    if (contentType.includes('application/json')) {
                        try {
                            responseData = JSON.parse(responseBody);
                        } catch (parseError) {
                            console.error('Failed to parse JSON response:', parseError);
                            responseData = responseBody;
                        }
                    } else {
                        responseData = responseBody;
                    }
                    
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: responseData
                    });
                });
            });

            req.on('error', (error) => {
                console.error('HTTPS request error:', error);
                reject(error);
            });

            req.setTimeout(30000, () => {
                console.error('Request timeout after 30 seconds');
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (requestBody && method !== 'GET') {
                const bodyData = JSON.stringify(requestBody);
                req.write(bodyData);
            }

            req.end();
        });

        const responseBody = {
            success: ebayResponse.statusCode >= 200 && ebayResponse.statusCode < 300,
            statusCode: ebayResponse.statusCode,
            data: ebayResponse.data
        };

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(responseBody)
        };

    } catch (error) {
        console.error('Lambda error:', error);
        
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

// Graceful cleanup on Lambda termination
process.on('beforeExit', () => {
    console.log('Cleaning up connection pools...');
    httpsAgent.destroy();
    Object.values(connectionPools).forEach(agent => agent.destroy());
});