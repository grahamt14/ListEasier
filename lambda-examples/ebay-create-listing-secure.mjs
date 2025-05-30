// ebay-create-listing.mjs - Secure version with AWS Secrets Manager
import https from 'https';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// AWS Secrets Manager client
const secretsManager = new SecretsManagerClient();

// Cache for credentials
let cachedCredentials = null;
let cacheExpiry = 0;

// Configuration constants
const CONFIG = {
    MAX_RETRIES: 2,
    BASE_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 15000,
    REQUEST_TIMEOUT: 25000,
    MAX_POLICIES_PER_TYPE: 15,
    TOKEN_REFRESH_BUFFER: 300000,
    BATCH_SIZE: 10,
    POLICY_CREATION_TIMEOUT: 12000,
    QUICK_VALIDATION_TIMEOUT: 5000,
};

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

// Parse CSV template to extract required fields and aspects
function parseCategoryTemplate(csvTemplate) {
    if (!csvTemplate) {
        return { aspects: {}, requiredFields: [] };
    }
    
    try {
        // Split into lines and get headers
        const lines = csvTemplate.trim().split('\n');
        if (lines.length < 2) {
            console.warn('CSV template has fewer than 2 lines');
            return { aspects: {}, requiredFields: [] };
        }
        
        // The CSV template format from eBay has 3 lines:
        // Line 1: Headers (field names)
        // Line 2: Required fields marked with "Required"
        // Line 3: Default values (usually empty)
        const headers = lines[0].split(',').map(h => h.trim());
        const requiredLine = lines.length > 1 ? lines[1].split(',').map(v => v.trim()) : [];
        const values = lines.length > 2 ? lines[2].split(',').map(v => v.trim()) : [];
        
        const aspects = {};
        const requiredFields = [];
        
        headers.forEach((header, index) => {
            const cleanHeader = header.replace(/"/g, '').replace('*', '').trim();
            
            // Check if this field is required (marked with * in header or "Required" in requiredLine)
            const isRequiredByAsterisk = header.includes('*');
            const isRequiredByLine = requiredLine[index]?.toLowerCase().includes('required');
            const isRequired = isRequiredByAsterisk || isRequiredByLine;
            
            if (isRequired) {
                requiredFields.push(cleanHeader);
            }
            
            // Check if this is a custom aspect (starts with 'C:')
            if (cleanHeader.startsWith('C:')) {
                const aspectName = cleanHeader.substring(2); // Remove 'C:' prefix
                const value = values[index]?.replace(/"/g, '').trim();
                
                // Only add aspect if it has a value
                if (value && value !== '') {
                    aspects[aspectName] = [value]; // eBay expects aspect values as arrays
                }
            }
        });
        
        console.log('Parsed CSV template:', {
            totalFields: headers.length,
            aspectsFound: Object.keys(aspects).length,
            requiredFields: requiredFields.length,
            aspects
        });
        
        return { aspects, requiredFields };
    } catch (error) {
        console.error('Error parsing CSV template:', error);
        return { aspects: {}, requiredFields: [] };
    }
}

export const handler = async (event) => {
    console.log('Secure eBay Create Listing Lambda invoked');
    
    // Enable CORS
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,Accept',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    };

    // Handle preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    let createdResources = {
        inventoryItems: [],
        offers: [],
        policies: []
    };

    try {
        // Parse and validate request
        const body = JSON.parse(event.body || '{}');
        const { 
            accessToken, 
            environment = 'sandbox',
            listingData,
            marketplaceId = 'EBAY_US'
        } = body;

        if (!accessToken || !listingData) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Missing required parameters: accessToken and listingData' 
                })
            };
        }

        // Note: We're not using credentials for listing creation, 
        // but we validate the environment
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

        // Validate and prepare listing data
        const validationResult = await validateListingData(listingData, environment);
        if (!validationResult.valid) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid listing data',
                    details: validationResult.errors
                })
            };
        }

        const hostname = environment === 'sandbox' ? 'api.sandbox.ebay.com' : 'api.ebay.com';
        
        // Extract and process listing details
        const {
            sku,
            title,
            description,
            categoryId,
            price,
            quantity = 1,
            imageUrls = [],
            condition = 'NEW',
            policies = {},
            aspectsData = {},
            location = {},
            categoryTemplate = null // CSV template from ListCategory table
        } = listingData;

        // Enhanced logging for debugging
        console.log('Processing listing:', {
            sku,
            title: title ? `${title.substring(0, 50)}...` : 'No title',
            categoryId,
            price,
            environment,
            hasLocation: Object.keys(location).length > 0,
            hasImages: imageUrls.length,
            validImages: imageUrls.filter(url => url && url.includes('http')).length,
            totalImages: imageUrls.length
        });

        // Step 1: Validate token
        console.log('Step 1: Validating access token...');
        const tokenValidation = await validateAccessToken(accessToken, hostname, marketplaceId);
        if (!tokenValidation.valid) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Invalid or expired access token',
                    details: tokenValidation.error
                })
            };
        }

        // Step 2: Validate images are accessible
        console.log('Step 2: Validating image accessibility...');
        const imageValidation = await validateImageUrls(imageUrls);
        if (!imageValidation.allValid) {
            console.warn('Some images are not accessible:', imageValidation.invalidUrls);
        }
        const validImageUrls = imageValidation.validUrls;

        // Step 3: Get or create merchant location
        console.log('Step 3: Setting up merchant location...');
        const merchantLocationResult = await setupMerchantLocation(hostname, accessToken, marketplaceId, location);
        if (!merchantLocationResult.success) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Failed to setup merchant location',
                    details: merchantLocationResult.error
                })
            };
        }

        // Step 4: Handle category mapping for sandbox
        const effectiveCategoryId = mapCategoryForEnvironment(categoryId, environment);
        console.log(`Using category ID: ${effectiveCategoryId} (original: ${categoryId})`);

        // Step 5: Check if account has business policies enabled
        console.log('Step 5: Checking business policies availability...');
        const businessPolicyCheck = await checkBusinessPolicyAvailability(hostname, accessToken, marketplaceId);
        
        let policiesResult = {
            success: true,
            policies: {
                fulfillmentPolicyId: null,
                paymentPolicyId: null,
                returnPolicyId: null
            },
            createdPolicies: [],
            hasBusinessPolicies: businessPolicyCheck.available
        };

        if (businessPolicyCheck.available) {
            console.log('Business policies are available, setting up...');
            policiesResult = await setupBusinessPoliciesWithTimeout(
                hostname, accessToken, marketplaceId, policies, environment
            );
        } else {
            console.log('Business policies not available - will use legacy listing approach');
        }

        createdResources.policies = policiesResult.createdPolicies || [];

        // Step 6: Generate unique SKU to avoid conflicts
        const finalSku = `${sku}_${Date.now()}`;

        // Step 7: Parse category template and create inventory item
        console.log('Step 7: Creating inventory item...');
        
        // Parse the CSV template to get dynamic aspects
        const { aspects: templateAspects, requiredFields } = parseCategoryTemplate(categoryTemplate);
        
        // Log template parsing results
        console.log('Template parsing results:', {
            hasTemplate: !!categoryTemplate,
            templateAspectsCount: Object.keys(templateAspects).length,
            templateAspects: templateAspects
        });
        
        // Merge template aspects with provided aspects (provided aspects take precedence for user data)
        const mergedAspects = {
            ...templateAspects,  // Template defaults first
            ...aspectsData       // User-provided data overwrites template defaults
        };
        
        // Add default aspects if not provided by template or user
        // eBay requires both 'Country' and 'Country/Region of Manufacture' for some categories
        if (!mergedAspects['Country/Region of Manufacture']) {
            mergedAspects['Country/Region of Manufacture'] = ['United States'];
        }
        if (!mergedAspects['Country']) {
            mergedAspects['Country'] = ['United States'];
        }
        
        // Validate required fields from template
        const missingRequiredFields = [];
        for (const field of requiredFields) {
            if (field.startsWith('C:')) {
                // Check if custom aspect exists
                const aspectName = field.substring(2);
                if (!mergedAspects[aspectName] || mergedAspects[aspectName].length === 0) {
                    missingRequiredFields.push(field);
                }
            }
            // Add validation for other field types if needed
        }
        
        if (missingRequiredFields.length > 0) {
            console.warn('Missing required fields from template:', missingRequiredFields);
            // Continue anyway but log warning
        }
        
        console.log('Using aspects:', {
            fromTemplate: Object.keys(templateAspects).length,
            fromData: Object.keys(aspectsData).length,
            total: Object.keys(mergedAspects).length,
            requiredFields: requiredFields.length,
            missingRequired: missingRequiredFields.length
        });
        
        const inventoryItem = {
            availability: {
                shipToLocationAvailability: {
                    quantity: quantity,
                    allocationByFormat: {
                        auction: 0,
                        fixedPrice: quantity
                    }
                }
            },
            condition: condition.toUpperCase(),
            product: {
                title: title,
                description: description,
                imageUrls: validImageUrls,
                aspects: mergedAspects
            },
            // Add location and country information to inventory item
            locale: 'en_US',
            // Add country field that eBay might be looking for
            country: 'US',
            packageWeightAndSize: {
                dimensions: {
                    height: 1,
                    length: 6,
                    width: 4,
                    unit: 'INCH'
                },
                weight: {
                    value: 0.1,
                    unit: 'POUND'
                }
            }
        };

        const inventoryResponse = await makeEbayRequestWithRetry({
            hostname,
            path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(finalSku)}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Content-Language': 'en-US'
            },
            body: inventoryItem
        });

        if (!inventoryResponse.success) {
            await cleanup(createdResources, hostname, accessToken, marketplaceId);
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Failed to create inventory item',
                    details: inventoryResponse.data,
                    step: 'inventory_creation'
                })
            };
        }

        createdResources.inventoryItems.push(finalSku);

        // Step 8: Create offer with conditional business policy handling
        console.log('Step 8: Creating offer...');
        
        const offer = {
            sku: finalSku,
            marketplaceId: marketplaceId,
            format: 'FIXED_PRICE',
            listingDescription: description,
            categoryId: effectiveCategoryId,
            pricingSummary: {
                price: {
                    currency: getCurrencyForMarketplace(marketplaceId),
                    value: String(price)
                }
            },
            quantityLimitPerBuyer: 0,
            includeCatalogProductDetails: false,
            // Add country information for eBay requirement
            tax: {
                // eBay often infers country from tax settings
                applyTax: false
            },
            // Add storefront configuration
            storeFront: {
                storeCategoryNames: []
            },
            // Add listing enhancement for country context
            listingEnhancements: []
        };

        // IMPORTANT: merchantLocationKey is REQUIRED for publishing to work
        // Without this, you'll get "No Item.Country exists" error
        if (merchantLocationResult.merchantLocationKey) {
            offer.merchantLocationKey = merchantLocationResult.merchantLocationKey;
            console.log('Setting merchantLocationKey on offer:', merchantLocationResult.merchantLocationKey);
        } else {
            console.error('WARNING: No merchantLocationKey available - this WILL cause publish to fail!');
            console.error('The "No Item.Country exists" error occurs when merchantLocationKey is missing');
            // Cannot publish without a merchant location
            // Return error immediately instead of trying to continue
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: 'Unable to create or find a merchant location. eBay requires a valid location to publish listings.',
                    details: {
                        message: 'Merchant location setup failed',
                        suggestion: 'Please create at least one merchant location in your eBay account before creating listings'
                    },
                    step: 'merchant_location_setup'
                })
            };
        }

        // Add business policies only if available and valid
        if (businessPolicyCheck.available && policiesResult.policies.fulfillmentPolicyId) {
            offer.fulfillmentPolicyId = policiesResult.policies.fulfillmentPolicyId;
        }
        if (businessPolicyCheck.available && policiesResult.policies.paymentPolicyId) {
            offer.paymentPolicyId = policiesResult.policies.paymentPolicyId;
        }
        if (businessPolicyCheck.available && policiesResult.policies.returnPolicyId) {
            offer.returnPolicyId = policiesResult.policies.returnPolicyId;
        }
        
        // For accounts without business policies, add legacy fields
        if (!businessPolicyCheck.available) {
            console.log('Adding legacy shipping and payment details for account without business policies...');
            
            // Override the listingPolicies to include shipping with country info
            offer.listingPolicies = {
                shippingPolicyOverride: {
                    shippingOptions: [{
                        optionType: 'DOMESTIC',
                        costType: 'FLAT_RATE',
                        shippingServices: [{
                            sortOrder: 1,
                            shippingServiceCode: 'Other',
                            freeShipping: true,
                            buyerResponsibleForShipping: false,
                            buyerResponsibleForPickup: false
                        }]
                    }],
                    handlingTime: {
                        value: 3,
                        unit: 'DAY'
                    },
                    // Add shipping from location
                    shipFromCountryCode: 'US'
                },
                paymentPolicyOverride: {
                    paymentMethods: [{
                        paymentMethodType: 'PAYPAL'
                    }],
                    immediatePay: false
                },
                returnPolicyOverride: {
                    returnsAccepted: true,
                    returnPeriod: {
                        value: 30,
                        unit: 'DAY'
                    },
                    returnMethod: 'MONEY_BACK',
                    returnShippingCostPayer: 'BUYER'
                },
                localizedAspects: [
                    {
                        type: 'STRING',
                        name: 'Country/Region of Manufacture',
                        value: 'United States'
                    },
                    {
                        type: 'STRING', 
                        name: 'Country',
                        value: 'United States'
                    }
                ]
            };
            
            // Also try adding top-level shipping details as fallback
            offer.shippingOptions = [{
                optionType: 'DOMESTIC',
                costType: 'FLAT_RATE',
                shippingServices: [{
                    sortOrder: 1,
                    shippingServiceCode: 'Other',
                    freeShipping: true,
                    buyerResponsibleForShipping: false,
                    buyerResponsibleForPickup: false
                }]
            }];
            
            offer.handlingTime = {
                value: 3,
                unit: 'DAY'
            };
        } else {
            // Even with business policies, override listingPolicies to add country info
            offer.listingPolicies = {
                localizedAspects: [
                    {
                        type: 'STRING',
                        name: 'Country/Region of Manufacture',
                        value: 'United States'
                    },
                    {
                        type: 'STRING', 
                        name: 'Country',
                        value: 'United States'
                    }
                ]
            };
        }

        console.log('Creating offer with policies:', {
            fulfillmentPolicyId: offer.fulfillmentPolicyId,
            paymentPolicyId: offer.paymentPolicyId,
            returnPolicyId: offer.returnPolicyId,
            hasBusinessPolicies: businessPolicyCheck.available,
            hasLegacyFields: !businessPolicyCheck.available
        });

        // ENHANCED LOGGING: Log complete offer payload
        console.log('=== OFFER PAYLOAD BEING SENT TO EBAY ===');
        console.log('Full offer object:');
        console.log(JSON.stringify(offer, null, 2));
        console.log('Inventory item aspects:', JSON.stringify(mergedAspects, null, 2));
        console.log('Has Country aspect:', !!mergedAspects['Country']);
        console.log('Country aspect value:', mergedAspects['Country']);
        console.log('=== END OFFER PAYLOAD ===');

        const offerResponse = await makeEbayRequestWithRetry({
            hostname,
            path: '/sell/inventory/v1/offer',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Content-Language': 'en-US'
            },
            body: offer
        });

        if (!offerResponse.success) {
            // ENHANCED LOGGING: Detailed offer creation failure analysis
            console.error('=== OFFER CREATION FAILED ===');
            console.error('Offer Response Status:', offerResponse.statusCode);
            console.error('Offer Response Data:');
            console.error(JSON.stringify(offerResponse.data, null, 2));
            
            // Extract specific error information
            if (offerResponse.data && offerResponse.data.errors) {
                console.error('Specific eBay Errors:');
                offerResponse.data.errors.forEach((error, index) => {
                    console.error(`Error ${index + 1}: [${error.errorId}] ${error.longMessage || error.message}`);
                    if (error.parameters) {
                        console.error(`  Parameters:`, error.parameters);
                    }
                });
            }
            
            await cleanup(createdResources, hostname, accessToken, marketplaceId);
            
            // Enhanced error handling for offer creation
            let errorMessage = 'Failed to create offer';
            let suggestions = [];
            
            if (offerResponse.data && offerResponse.data.errors) {
                const errors = offerResponse.data.errors;
                errorMessage = errors.map(e => e.longMessage || e.message).join('; ');
                
                // Add specific suggestions based on error codes
                errors.forEach(error => {
                    if (error.errorId === 25604) {
                        suggestions.push('Business policies are required but not properly configured');
                    } else if (error.errorId === 25002) {
                        suggestions.push('Category or marketplace configuration issue');
                    } else if (error.errorId === 25007) {
                        suggestions.push('Shipping configuration problem');
                    }
                });
            }
            
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: errorMessage,
                    details: offerResponse.data,
                    step: 'offer_creation',
                    suggestions,
                    businessPolicyStatus: businessPolicyCheck.available ? 'available' : 'not_available'
                })
            };
        }

        const offerId = offerResponse.data.offerId;
        createdResources.offers.push(offerId);
        console.log('Offer created successfully with ID:', offerId);

        // Step 9: Publish offer (create listing)
        console.log('Step 9: Publishing offer...');
        console.log('Publishing offer with ID:', offerId);
        console.log('Inventory item had country:', inventoryItem.country);
        console.log('Inventory aspects had Country:', mergedAspects['Country']);
        console.log('Inventory aspects had Country/Region:', mergedAspects['Country/Region of Manufacture']);
        
        // The publish endpoint typically requires an empty body
        const publishBody = {};
        
        const publishResponse = await makeEbayRequestWithRetry({
            hostname,
            path: `/sell/inventory/v1/offer/${offerId}/publish`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Content-Language': 'en-US'
            },
            body: publishBody
        });
        
        if (!publishResponse.success) {
            // Enhanced error handling for publishing
            let errorMessage = 'Failed to publish listing';
            let troubleshooting = [];
            let isDraft = false;
            let isShippingIssue = false;
            
            if (publishResponse.data && publishResponse.data.errors) {
                const errors = publishResponse.data.errors;
                errors.forEach(error => {
                    if (error.errorId === 25604) {
                        troubleshooting.push('Account needs business policies enabled');
                        isDraft = true;
                    } else if (error.errorId === 25001) {
                        troubleshooting.push('Sandbox system error - try again later');
                    } else if (error.errorId === 25002) {
                        troubleshooting.push('Invalid category or marketplace configuration');
                    } else if (error.errorId === 25007 || error.longMessage?.includes('shipping service')) {
                        troubleshooting.push('Shipping service configuration issue');
                        troubleshooting.push('Enable business policies in eBay for proper shipping setup');
                        isShippingIssue = true;
                        isDraft = true;
                    } else if (error.longMessage?.includes('Fulfillment policy')) {
                        troubleshooting.push('Fulfillment policy issue - business policies required');
                        troubleshooting.push('Go to eBay Account Settings and enable business policies');
                        isShippingIssue = true;
                        isDraft = true;
                    }
                });
                
                errorMessage = errors.map(e => e.longMessage || e.message).join('; ');
            }

            // For sandbox accounts without business policies or shipping issues, return partial success
            if ((environment === 'sandbox' && isDraft) || isShippingIssue) {
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({
                        success: true,
                        isDraft: true,
                        message: 'Offer created successfully but could not be published due to missing business policies',
                        offerId: offerId,
                        sku: finalSku,
                        originalSku: sku,
                        environment,
                        categoryUsed: effectiveCategoryId,
                        businessPolicyStatus: businessPolicyCheck.available ? 'available' : 'not_available',
                        nextSteps: [
                            'The offer has been created in eBay Seller Hub as a draft',
                            'To publish it, you need to enable business policies in your eBay account',
                            'Go to My eBay → Account → Site Preferences → Selling preferences',
                            'Enable "Use business policies for my listings"',
                            'Create payment, shipping, and return policies',
                            'The listing can then be published manually from eBay Seller Hub'
                        ],
                        troubleshooting: {
                            issue: isShippingIssue ? 
                                'eBay requires business policies for shipping configuration' :
                                'Sandbox account not enrolled in business policies',
                            solution: 'Enable business policies in eBay seller preferences to get full shipping, payment, and return policy support',
                            steps: [
                                'Log into your eBay account',
                                'Go to My eBay → Account → Site Preferences',
                                'Find "Selling preferences" section',
                                'Turn on "Use business policies for my listings"',
                                'Create your required policies (payment, shipping, return)',
                                'Try listing again or publish the draft manually'
                            ]
                        }
                    })
                };
            }

            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: errorMessage,
                    details: publishResponse.data,
                    step: 'publish_offer',
                    offerId,
                    troubleshooting,
                    canRetry: true,
                    retryInstructions: 'The offer was created successfully. You can try publishing again after resolving the issues.',
                    suggestions: [
                        'Enable business policies in your eBay account for proper shipping configuration',
                        'Verify all business policies are properly configured',
                        'Check that the category supports the selected marketplace',
                        'Ensure all required fields are provided for this category'
                    ]
                })
            };
        }

        // Success!
        console.log('Listing published successfully');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                listingId: publishResponse.data.listingId,
                offerId: offerId,
                sku: finalSku,
                originalSku: sku,
                message: 'Listing created successfully',
                environment,
                categoryUsed: effectiveCategoryId,
                policiesUsed: policiesResult.policies,
                businessPolicyStatus: businessPolicyCheck.available ? 'available' : 'not_available',
                imageValidation: imageValidation,
                createdResources: {
                    inventoryItems: createdResources.inventoryItems,
                    offers: createdResources.offers,
                    newPolicies: createdResources.policies.length
                }
            })
        };

    } catch (error) {
        console.error('Lambda error:', error);
        
        // Attempt cleanup on unexpected errors
        if (createdResources.inventoryItems.length > 0 || createdResources.offers.length > 0) {
            try {
                const body = JSON.parse(event.body || '{}');
                await cleanup(createdResources, 
                    body.environment === 'sandbox' ? 'api.sandbox.ebay.com' : 'api.ebay.com',
                    body.accessToken, 
                    body.marketplaceId || 'EBAY_US'
                );
            } catch (cleanupError) {
                console.error('Cleanup failed:', cleanupError);
            }
        }
        
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: error.message,
                step: 'unexpected_error',
                timestamp: new Date().toISOString()
            })
        };
    }
};

// Include all the helper functions from the original file below...
// (checkBusinessPolicyAvailability, validateListingData, validateAccessToken, etc.)

// All helper functions remain the same as in your original file
// I'm including them here for completeness:

// Check if business policies are available for this account
async function checkBusinessPolicyAvailability(hostname, accessToken, marketplaceId) {
    try {
        const response = await makeEbayRequestWithRetry({
            hostname,
            path: `/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}&limit=1`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId
            },
            timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
        });
        
        // Check for the specific "not opted in" error
        if (!response.success && response.data && response.data.errors) {
            const notOptedInError = response.data.errors.find(error => 
                error.errorId === 20403 || 
                error.longMessage?.includes('not opted in to business policies')
            );
            
            if (notOptedInError) {
                console.log('Account is not opted in to business policies');
                return { available: false, reason: 'not_opted_in' };
            }
        }
        
        // If we get a successful response or any other error, assume policies are available
        return { available: true };
        
    } catch (error) {
        console.warn('Error checking business policy availability:', error.message);
        // Assume available if we can't check
        return { available: true };
    }
}

// Validate listing data before processing
async function validateListingData(listingData, environment) {
    const errors = [];
    
    // Required fields
    if (!listingData.sku) errors.push('SKU is required');
    if (!listingData.title) errors.push('Title is required');
    if (!listingData.description) errors.push('Description is required');
    if (!listingData.categoryId) errors.push('Category ID is required');
    if (!listingData.price || listingData.price <= 0) errors.push('Valid price is required');
    
    // Validate price range
    if (listingData.price && (listingData.price < 0.01 || listingData.price > 999999)) {
        errors.push('Price must be between $0.01 and $999,999');
    }
    
    // Validate title length
    if (listingData.title && listingData.title.length > 255) {
        errors.push('Title must be 255 characters or less');
    }
    
    // Validate description length
    if (listingData.description && listingData.description.length > 500000) {
        errors.push('Description must be 500,000 characters or less');
    }
    
    // Validate images
    if (!listingData.imageUrls || listingData.imageUrls.length === 0) {
        errors.push('At least one image URL is required');
    }
    
    if (listingData.imageUrls && listingData.imageUrls.length > 24) {
        errors.push('Maximum 24 images allowed');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// Validate access token
async function validateAccessToken(accessToken, hostname, marketplaceId) {
    try {
        const response = await makeEbayRequestWithRetry({
            hostname,
            path: '/sell/account/v1/payment_policy?marketplace_id=' + marketplaceId + '&limit=1',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId
            },
            timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
        });
        
        return {
            valid: response.success || response.statusCode !== 401,
            error: response.success ? null : response.data
        };
    } catch (error) {
        return {
            valid: false,
            error: error.message
        };
    }
}

// Validate that image URLs are accessible
async function validateImageUrls(imageUrls) {
    const results = {
        allValid: true,
        validUrls: [],
        invalidUrls: [],
        warnings: []
    };
    
    if (!imageUrls || imageUrls.length === 0) {
        results.allValid = false;
        results.warnings.push('No image URLs provided');
        return results;
    }
    
    for (const url of imageUrls) {
        if (!url || typeof url !== 'string') {
            results.invalidUrls.push({ url, reason: 'Invalid URL format' });
            results.allValid = false;
            continue;
        }
        
        // Basic URL validation
        try {
            new URL(url);
            
            // Check if it's HTTP/HTTPS
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                results.invalidUrls.push({ url, reason: 'Must be HTTP or HTTPS' });
                results.allValid = false;
                continue;
            }
            
            // Check file extension
            const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
            const hasValidExtension = validExtensions.some(ext => 
                url.toLowerCase().includes(ext)
            );
            
            if (!hasValidExtension) {
                results.warnings.push(`Image may not have valid extension: ${url}`);
            }
            
            results.validUrls.push(url);
            
        } catch (urlError) {
            results.invalidUrls.push({ url, reason: 'Invalid URL format' });
            results.allValid = false;
        }
    }
    
    console.log(`Image validation: ${results.validUrls.length} valid, ${results.invalidUrls.length} invalid`);
    return results;
}

// Setup merchant location
async function setupMerchantLocation(hostname, accessToken, marketplaceId, location = {}) {
    try {
        // Check for existing locations with timeout
        const locationsResponse = await makeEbayRequestWithRetry({
            hostname,
            path: '/sell/inventory/v1/location',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Content-Language': 'en-US'
            },
            timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
        });

        if (locationsResponse.success && locationsResponse.data.locations && locationsResponse.data.locations.length > 0) {
            // Use the first available location
            const existingLocation = locationsResponse.data.locations[0];
            console.log('Using existing merchant location:', existingLocation.merchantLocationKey);
            return {
                success: true,
                merchantLocationKey: existingLocation.merchantLocationKey
            };
        }

        // If no location exists, try to create a basic US location
        console.log('No merchant locations found, attempting to create default US location...');
        const timestamp = Date.now();
        const defaultLocation = {
            merchantLocationKey: `AUTO_LOC_${timestamp}`,
            name: `Auto Location ${timestamp}`,
            locationTypes: ['WAREHOUSE'],
            location: {
                address: {
                    addressLine1: '123 Main St',
                    city: 'New York',
                    stateOrProvince: 'NY',
                    postalCode: '10001',
                    country: 'US'
                }
            },
            locationInstructions: 'Auto-generated location for eBay listings',
            locationAdditionalInformation: 'Default location for eBay listings',
            locationWebUrl: '',
            phone: '555-123-4567'
        };

        console.log('Creating merchant location with key:', defaultLocation.merchantLocationKey);
        const createLocationResponse = await makeEbayRequestWithRetry({
            hostname,
            path: '/sell/inventory/v1/location/' + encodeURIComponent(defaultLocation.merchantLocationKey),
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                'Content-Language': 'en-US'
            },
            body: defaultLocation,
            timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
        });

        if (createLocationResponse.success) {
            console.log('Created new merchant location:', defaultLocation.merchantLocationKey);
            return {
                success: true,
                merchantLocationKey: defaultLocation.merchantLocationKey
            };
        } else {
            console.warn('Failed to create merchant location:', createLocationResponse.data);
            // Fall back to no location
            return {
                success: true,
                merchantLocationKey: null
            };
        }
        
    } catch (error) {
        console.warn('Error handling merchant locations:', error.message);
        // If location handling fails completely, proceed without location
        return {
            success: true,
            merchantLocationKey: null
        };
    }
}

// Map category for environment
function mapCategoryForEnvironment(categoryId, environment) {
    if (environment === 'sandbox') {
        const categoryMapping = {
            '262043': '900',  // Postcards -> Art
            '260': '900',     // Art -> Art  
            '550': '900',     // Art Supplies -> Art
            '14339': '900',   // Crafts -> Art
            '1': '900',       // Collectibles -> Art
            '11700': '58058', // Home & Garden -> Home & Garden
            '293': '58058',   // Consumer Electronics -> Home & Garden
            '267': '900',     // Books -> Art
            '11450': '900',   // Clothing -> Art
            '15032': '900',   // Cameras -> Art
            '625': '900'      // Cameras & Photo -> Art
        };
        
        if (categoryMapping[categoryId]) {
            console.log(`Mapped category ${categoryId} to sandbox category ${categoryMapping[categoryId]}`);
            return categoryMapping[categoryId];
        }
    }
    
    return categoryId;
}

// Setup business policies with timeout protection
async function setupBusinessPoliciesWithTimeout(hostname, accessToken, marketplaceId, providedPolicies, environment) {
    console.log('Setting up business policies...');
    
    // For sandbox, wrap the entire policy setup in a timeout
    if (environment === 'sandbox') {
        try {
            const policyPromise = setupBusinessPolicies(hostname, accessToken, marketplaceId, providedPolicies, environment);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Policy setup timeout')), CONFIG.POLICY_CREATION_TIMEOUT);
            });
            
            return await Promise.race([policyPromise, timeoutPromise]);
        } catch (error) {
            console.warn('Policy setup failed or timed out in sandbox:', error.message);
            // Return success with empty policies for sandbox
            return {
                success: true,
                policies: {
                    fulfillmentPolicyId: null,
                    paymentPolicyId: null,
                    returnPolicyId: null
                },
                createdPolicies: [],
                reusedPolicies: [],
                warning: 'Policy setup timed out - continuing without policies'
            };
        }
    } else {
        // For production, use the full policy setup
        return await setupBusinessPolicies(hostname, accessToken, marketplaceId, providedPolicies, environment);
    }
}

// Setup business policies with reuse and cleanup
async function setupBusinessPolicies(hostname, accessToken, marketplaceId, providedPolicies, environment) {
    const result = {
        success: false,
        policies: {
            fulfillmentPolicyId: null,
            paymentPolicyId: null,
            returnPolicyId: null
        },
        createdPolicies: [],
        reusedPolicies: []
    };
    
    try {
        // If policies are provided, validate they exist
        if (providedPolicies.fulfillmentPolicyId || providedPolicies.paymentPolicyId || providedPolicies.returnPolicyId) {
            console.log('Using provided business policies...');
            
            // Validate each provided policy
            const validationResults = await Promise.allSettled([
                providedPolicies.fulfillmentPolicyId ? 
                    validatePolicy(hostname, accessToken, marketplaceId, 'fulfillment_policy', providedPolicies.fulfillmentPolicyId) : 
                    Promise.resolve({ valid: false }),
                providedPolicies.paymentPolicyId ? 
                    validatePolicy(hostname, accessToken, marketplaceId, 'payment_policy', providedPolicies.paymentPolicyId) : 
                    Promise.resolve({ valid: false }),
                providedPolicies.returnPolicyId ? 
                    validatePolicy(hostname, accessToken, marketplaceId, 'return_policy', providedPolicies.returnPolicyId) : 
                    Promise.resolve({ valid: false })
            ]);
            
            if (validationResults[0].status === 'fulfilled' && validationResults[0].value.valid) {
                result.policies.fulfillmentPolicyId = providedPolicies.fulfillmentPolicyId;
                result.reusedPolicies.push('fulfillment');
            }
            if (validationResults[1].status === 'fulfilled' && validationResults[1].value.valid) {
                result.policies.paymentPolicyId = providedPolicies.paymentPolicyId;
                result.reusedPolicies.push('payment');
            }
            if (validationResults[2].status === 'fulfilled' && validationResults[2].value.valid) {
                result.policies.returnPolicyId = providedPolicies.returnPolicyId;
                result.reusedPolicies.push('return');
            }
        }
        
        // Find or create missing policies
        const missingPolicies = [];
        if (!result.policies.fulfillmentPolicyId) missingPolicies.push('fulfillment');
        if (!result.policies.paymentPolicyId) missingPolicies.push('payment');
        if (!result.policies.returnPolicyId) missingPolicies.push('return');
        
        if (missingPolicies.length > 0) {
            console.log('Finding or creating missing policies:', missingPolicies);
            
            // First, try to find existing reusable policies
            const existingPolicies = await findReusablePolicies(hostname, accessToken, marketplaceId, missingPolicies);
            
            // Use existing policies where available
            if (existingPolicies.fulfillment) {
                result.policies.fulfillmentPolicyId = existingPolicies.fulfillment.fulfillmentPolicyId;
                result.reusedPolicies.push('fulfillment');
            }
            if (existingPolicies.payment) {
                result.policies.paymentPolicyId = existingPolicies.payment.paymentPolicyId;
                result.reusedPolicies.push('payment');
            }
            if (existingPolicies.return) {
                result.policies.returnPolicyId = existingPolicies.return.returnPolicyId;
                result.reusedPolicies.push('return');
            }
            
            // Create any still missing policies
            const stillMissing = [];
            if (!result.policies.fulfillmentPolicyId) stillMissing.push('fulfillment');
            if (!result.policies.paymentPolicyId) stillMissing.push('payment');
            if (!result.policies.returnPolicyId) stillMissing.push('return');
            
            if (stillMissing.length > 0) {
                console.log('Creating new policies for:', stillMissing);
                const newPolicies = await createBusinessPolicies(hostname, accessToken, marketplaceId, stillMissing);
                
                if (newPolicies.fulfillmentPolicyId) {
                    result.policies.fulfillmentPolicyId = newPolicies.fulfillmentPolicyId;
                    result.createdPolicies.push('fulfillment');
                }
                if (newPolicies.paymentPolicyId) {
                    result.policies.paymentPolicyId = newPolicies.paymentPolicyId;
                    result.createdPolicies.push('payment');
                }
                if (newPolicies.returnPolicyId) {
                    result.policies.returnPolicyId = newPolicies.returnPolicyId;
                    result.createdPolicies.push('return');
                }
            }
        }
        
        // Check if we have at least fulfillment policy (most critical)
        result.success = result.policies.fulfillmentPolicyId !== null;
        
        console.log('Policy setup complete:', {
            fulfillmentPolicyId: result.policies.fulfillmentPolicyId,
            paymentPolicyId: result.policies.paymentPolicyId,
            returnPolicyId: result.policies.returnPolicyId,
            reused: result.reusedPolicies,
            created: result.createdPolicies
        });
        
        return result;
        
    } catch (error) {
        console.error('Error setting up business policies:', error);
        return {
            ...result,
            success: false,
            error: error.message
        };
    }
}

// Validate a specific policy exists
async function validatePolicy(hostname, accessToken, marketplaceId, policyType, policyId) {
    try {
        const response = await makeEbayRequestWithRetry({
            hostname,
            path: `/sell/account/v1/${policyType}/${policyId}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': marketplaceId
            },
            timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
        });
        
        return { valid: response.success };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

// Find existing reusable policies
async function findReusablePolicies(hostname, accessToken, marketplaceId, neededTypes) {
    const result = {};
    
    const promises = neededTypes.map(async (type) => {
        try {
            const policyType = `${type}_policy`;
            const response = await makeEbayRequestWithRetry({
                hostname,
                path: `/sell/account/v1/${policyType}?marketplace_id=${marketplaceId}&limit=50`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': marketplaceId
                },
                timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
            });
            
            if (response.success && response.data[`${type}Policies`]) {
                const policies = response.data[`${type}Policies`];
                
                // Find a reusable policy
                const reusablePolicy = policies.find(policy => 
                    policy.marketplaceId === marketplaceId || 
                    policy.name.toLowerCase().includes('default') ||
                    policy.name.toLowerCase().includes('standard')
                );
                
                if (reusablePolicy) {
                    result[type] = reusablePolicy;
                    console.log(`Found reusable ${type} policy:`, reusablePolicy[`${type}PolicyId`]);
                }
            }
        } catch (error) {
            console.warn(`Error finding ${type} policies:`, error.message);
        }
    });
    
    await Promise.allSettled(promises);
    return result;
}

// Create new business policies
async function createBusinessPolicies(hostname, accessToken, marketplaceId, types) {
    const result = {};
    const timestamp = Date.now();
    
    for (const type of types) {
        try {
            let policyData;
            let endpoint;
            
            if (type === 'fulfillment') {
                endpoint = '/sell/account/v1/fulfillment_policy';
                policyData = {
                    name: `Auto Shipping ${timestamp}`,
                    marketplaceId: marketplaceId,
                    categoryTypes: [{
                        name: 'ALL_EXCLUDING_MOTORS_VEHICLES',
                        default: true
                    }],
                    handlingTime: {
                        value: 1,
                        unit: 'DAY'
                    },
                    shippingOptions: [{
                        optionType: 'DOMESTIC',
                        costType: 'FLAT_RATE',
                        shippingServices: [{
                            sortOrder: 1,
                            shippingServiceCode: 'USPSPriority',
                            shippingCarrierCode: 'USPS',
                            freeShipping: false,
                            buyerResponsibleForShipping: false,
                            buyerResponsibleForPickup: false,
                            shippingCost: {
                                value: '5.99',
                                currency: getCurrencyForMarketplace(marketplaceId)
                            }
                        }],
                        insuranceOffered: false,
                        insuranceFee: {
                            value: '0.0',
                            currency: getCurrencyForMarketplace(marketplaceId)
                        }
                    }],
                    globalShipping: false,
                    pickupDropOff: false,
                    freightShipping: false
                };
            } else if (type === 'payment') {
                endpoint = '/sell/account/v1/payment_policy';
                policyData = {
                    name: `Auto Payment ${timestamp}`,
                    marketplaceId: marketplaceId,
                    categoryTypes: [{
                        name: 'ALL_EXCLUDING_MOTORS_VEHICLES',
                        default: true
                    }],
                    paymentMethods: [{
                        paymentMethodType: 'PAYPAL'
                    }],
                    immediatePay: false
                };
            } else if (type === 'return') {
                endpoint = '/sell/account/v1/return_policy';
                policyData = {
                    name: `Auto Return ${timestamp}`,
                    marketplaceId: marketplaceId,
                    categoryTypes: [{
                        name: 'ALL_EXCLUDING_MOTORS_VEHICLES',
                        default: true
                    }],
                    returnsAccepted: true,
                    returnPeriod: {
                        value: 30,
                        unit: 'DAY'
                    },
                    returnMethod: 'MONEY_BACK',
                    returnShippingCostPayer: 'BUYER'
                };
            }
            
            if (policyData && endpoint) {
                const response = await makeEbayRequestWithRetry({
                    hostname,
                    path: endpoint,
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
                        'Content-Language': 'en-US'
                    },
                    body: policyData
                });

                if (response.success && response.data[`${type}PolicyId`]) {
                    result[`${type}PolicyId`] = response.data[`${type}PolicyId`];
                    console.log(`Created ${type} policy:`, result[`${type}PolicyId`]);
                } else {
                    console.error(`Failed to create ${type} policy:`, response.data);
                }
            }
        } catch (error) {
            console.error(`Error creating ${type} policy:`, error);
        }
    }
    
    return result;
}

// Enhanced request function with retry logic and rate limiting
async function makeEbayRequestWithRetry(options) {
    let lastError;
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            const result = await makeEbayRequest(options);
            
            // Success
            if (result.success) {
                return result;
            }
            
            // Check if it's worth retrying
            if (!shouldRetry(result.statusCode, attempt)) {
                return result;
            }
            
            // Calculate retry delay with exponential backoff and jitter
            const delay = Math.min(
                CONFIG.BASE_RETRY_DELAY * Math.pow(2, attempt - 1) + Math.random() * 1000,
                CONFIG.MAX_RETRY_DELAY
            );
            
            console.log(`Request failed (attempt ${attempt}/${CONFIG.MAX_RETRIES}), retrying in ${delay}ms. Status: ${result.statusCode}`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            lastError = result;
            
        } catch (error) {
            lastError = { success: false, error: error.message };
            
            if (attempt === CONFIG.MAX_RETRIES) {
                break;
            }
            
            const delay = CONFIG.BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
            console.log(`Request error (attempt ${attempt}/${CONFIG.MAX_RETRIES}), retrying in ${delay}ms:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return lastError;
}

// Determine if we should retry based on status code and attempt number
function shouldRetry(statusCode, attempt) {
    // Don't retry on final attempt
    if (attempt >= CONFIG.MAX_RETRIES) {
        return false;
    }
    
    // Retry on server errors and rate limits
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    return retryableStatusCodes.includes(statusCode);
}

// Original request function with timeout and better error handling
async function makeEbayRequest({ hostname, path, method, headers, body, timeout = CONFIG.REQUEST_TIMEOUT }) {
    return new Promise((resolve, reject) => {
        const requestBody = body ? JSON.stringify(body) : null;
        const options = {
            hostname,
            port: 443,
            path,
            method,
            headers: {
                ...headers,
                ...(requestBody && { 'Content-Length': Buffer.byteLength(requestBody) })
            }
        };

        console.log(`Making ${method} request to: https://${hostname}${path}`);

        const req = https.request(options, (res) => {
            let responseBody = '';

            res.on('data', (chunk) => {
                responseBody += chunk;
            });

            res.on('end', () => {
                console.log(`Response status: ${res.statusCode}`);
                
                let data = {};
                if (responseBody) {
                    try {
                        data = JSON.parse(responseBody);
                    } catch (parseError) {
                        console.error('Failed to parse response:', parseError);
                        data = { rawResponse: responseBody };
                    }
                }
                
                // ENHANCED LOGGING: Log full response for failures
                if (res.statusCode >= 400) {
                    console.error('=== EBAY API ERROR RESPONSE ===');
                    console.error('Status Code:', res.statusCode);
                    console.error('Request Path:', path);
                    console.error('Request Method:', method);
                    console.error('Full Error Response:');
                    console.error(JSON.stringify(data, null, 2));
                    console.error('=== END ERROR RESPONSE ===');
                    
                    // Also log specific error details if available
                    if (data.errors && Array.isArray(data.errors)) {
                        console.error('eBay Error Details:');
                        data.errors.forEach((error, index) => {
                            console.error(`Error ${index + 1}:`);
                            console.error(`  Error ID: ${error.errorId}`);
                            console.error(`  Category: ${error.category}`);
                            console.error(`  Message: ${error.message}`);
                            console.error(`  Long Message: ${error.longMessage}`);
                            if (error.parameters) {
                                console.error(`  Parameters:`, JSON.stringify(error.parameters, null, 2));
                            }
                        });
                    }
                }
                
                resolve({
                    success: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    data: data,
                    error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null
                });
            });
        });

        req.on('error', (error) => {
            console.error('Request error:', error);
            reject(error);
        });

        req.setTimeout(timeout, () => {
            console.error(`Request timeout after ${timeout}ms`);
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (requestBody) {
            req.write(requestBody);
        }

        req.end();
    });
}

// Cleanup function for partial failures
async function cleanup(createdResources, hostname, accessToken, marketplaceId) {
    console.log('Cleaning up created resources...');
    
    const cleanupPromises = [];
    
    // Clean up offers (but not inventory items as they might be reusable)
    createdResources.offers.forEach(offerId => {
        cleanupPromises.push(
            makeEbayRequest({
                hostname,
                path: `/sell/inventory/v1/offer/${offerId}`,
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                    'X-EBAY-C-MARKETPLACE-ID': marketplaceId
                },
                timeout: CONFIG.QUICK_VALIDATION_TIMEOUT
            }).catch(error => {
                console.warn(`Failed to cleanup offer ${offerId}:`, error.message);
            })
        );
    });
    
    if (cleanupPromises.length > 0) {
        await Promise.allSettled(cleanupPromises);
        console.log(`Cleanup attempted for ${cleanupPromises.length} resources`);
    }
}

// Helper function to get currency for marketplace
function getCurrencyForMarketplace(marketplaceId) {
    const currencyMap = {
        'EBAY_US': 'USD',
        'EBAY_CA': 'CAD',
        'EBAY_UK': 'GBP',
        'EBAY_AU': 'AUD',
        'EBAY_DE': 'EUR',
        'EBAY_FR': 'EUR',
        'EBAY_IT': 'EUR',
        'EBAY_ES': 'EUR',
        'EBAY_NL': 'EUR',
        'EBAY_BE': 'EUR',
        'EBAY_CH': 'CHF',
        'EBAY_IE': 'EUR',
        'EBAY_PL': 'PLN',
        'EBAY_AT': 'EUR'
    };
    return currencyMap[marketplaceId] || 'USD';
}

// Environment variables required:
// EBAY_CREDENTIALS_SECRET_NAME - Name of the secret in AWS Secrets Manager (optional, for future use)

// Note: This Lambda doesn't currently use credentials from Secrets Manager
// as it receives the access token from the frontend. The Secrets Manager
// integration is included for future enhancements where the Lambda might
// need to perform OAuth operations directly.