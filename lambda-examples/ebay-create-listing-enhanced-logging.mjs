// Enhanced version of your Lambda with detailed error logging
// Add this logging enhancement to your existing Lambda code

// In the makeEbayRequest function, replace the res.on('end') handler with this:

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

// ALSO ADD: Enhanced offer creation logging
// In your offer creation section, add this before the makeEbayRequestWithRetry call:

console.log('=== OFFER PAYLOAD BEING SENT TO EBAY ===');
console.log('Full offer object:');
console.log(JSON.stringify(offer, null, 2));
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

// And add this right after the offer response:
if (!offerResponse.success) {
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
}