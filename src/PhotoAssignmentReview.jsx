import React, { useState, useEffect, useRef } from 'react';
import { useAppState } from './StateContext';
import { useEbayAuth } from './EbayAuthContext';
import { getSelectedCategoryOptionsJSON } from './FormSection';
import { saveAs } from 'file-saver';
import EbayListingManager from './EbayListingManager';
import EbayAuth from './EbayAuth';
import { cacheService } from './CacheService';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-provider-cognito-identity';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { useAuth0 } from '@auth0/auth0-react';
import ListingQuotaDisplay from './ListingQuotaDisplay';
import { useQuota } from './QuotaContext';
import { listingQuotaService } from './ListingQuotaService';

function PhotoAssignmentReview({ 
  photoListings, 
  onBack, 
  currentBatch,
  categoryFields = [],
  aiResolveCategoryFields = false,
  generatedListings: initialGeneratedListings = [],
  onGeneratedListingsChange,
  category,
  subCategory,
  categoryID
}) {
  const [selectedListing, setSelectedListing] = useState(null);
  const [selectedListingIndex, setSelectedListingIndex] = useState(null);
  const [generatedListings, setGeneratedListings] = useState(initialGeneratedListings);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [error, setError] = useState(null);
  const [quotaNotification, setQuotaNotification] = useState(null);
  const [showEbayListingManager, setShowEbayListingManager] = useState(false);
  const [showEbayAuth, setShowEbayAuth] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [searchTerms, setSearchTerms] = useState({});
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState(null);
  const dropdownRefs = useRef({});
  
  const { state, dispatch } = useAppState();
  const { isAuthenticated: ebayAuthenticated, selectedPolicies } = useEbayAuth();
  const { user } = useAuth0();
  const { checkQuotaForGeneration, updateQuotaAfterGeneration, refreshQuota } = useQuota();
  
  // Ensure categoryID is set in the state when component mounts
  useEffect(() => {
    console.log('📋 PhotoAssignmentReview: Props received - categoryID:', categoryID, 'category:', category, 'subCategory:', subCategory);
    console.log('📋 PhotoAssignmentReview: Current state categoryID:', state.categoryID);
    
    if (categoryID && state.categoryID !== categoryID) {
      console.log('✅ PhotoAssignmentReview: Setting categoryID from props:', categoryID);
      dispatch({ type: 'SET_CATEGORY_ID', payload: categoryID });
    }
  }, [categoryID, state.categoryID, dispatch]);
  
  // Check quota on mount
  useEffect(() => {
    const checkInitialQuota = async () => {
      if (user?.sub && photoListings.length > 0) {
        const quotaCheck = await checkQuotaForGeneration(photoListings.length);
        setQuotaInfo(quotaCheck);
      }
    };
    checkInitialQuota();
  }, [user, photoListings.length]);
  
  // Function to fetch eBay category data including ID and CSV template
  const fetchEbayCategoryData = async (category, subCategory) => {
    if (!category || category === "--" || !subCategory || subCategory === "--") {
      return null;
    }
    
    try {
      const cacheKey = `ebay_category_data_${category}_${subCategory}`;
      const cachedCategoryData = cacheService.get(cacheKey);
      
      if (cachedCategoryData !== null) {
        return cachedCategoryData;
      }
      
      // AWS Configuration
      const REGION = "us-east-2";
      const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";
      
      const client = new DynamoDBClient({
        region: REGION,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region: REGION },
          identityPoolId: IDENTITY_POOL_ID,
        }),
      });
      
      const params = {
        TableName: 'ListCategory',
        KeyConditionExpression: 'Category = :cat AND SubCategory = :sub',
        ExpressionAttributeValues: {
          ':cat': { S: category },
          ':sub': { S: subCategory }
        }
      };
      
      const command = new QueryCommand(params);
      const result = await client.send(command);
      
      if (result.Items && result.Items.length > 0) {
        const item = unmarshall(result.Items[0]);
        const categoryData = {
          categoryID: item.EbayCategoryID || null,
          exportCSV: item.ExportCSV || null
        };
        
        // Cache for 1 hour
        cacheService.set(cacheKey, categoryData, 60 * 60 * 1000, 'ebayCategories');
        return categoryData;
      }
      
      // Fallback: try with just category
      const fallbackParams = {
        TableName: 'ListCategory',
        KeyConditionExpression: 'Category = :cat',
        ExpressionAttributeValues: {
          ':cat': { S: category }
        },
        Limit: 1
      };
      
      const fallbackCommand = new QueryCommand(fallbackParams);
      const fallbackResult = await client.send(fallbackCommand);
      
      if (fallbackResult.Items && fallbackResult.Items.length > 0) {
        const fallbackItem = unmarshall(fallbackResult.Items[0]);
        const fallbackCategoryData = {
          categoryID: fallbackItem.EbayCategoryID || null,
          exportCSV: fallbackItem.ExportCSV || null
        };
        cacheService.set(cacheKey, fallbackCategoryData, 60 * 60 * 1000, 'ebayCategories');
        return fallbackCategoryData;
      }
      
      cacheService.set(cacheKey, null, 60 * 60 * 1000, 'ebayCategories');
      return null;
    } catch (error) {
      console.error('Error in fetchEbayCategoryData:', error);
      throw error;
    }
  };
  
  // Fetch eBay category ID if not already set
  useEffect(() => {
    const updateCategoryID = async () => {
      if (category && subCategory && !state.categoryID) {
        console.log('🔍 PhotoAssignmentReview: Fetching eBay categoryID for:', category, subCategory);
        try {
          const categoryData = await fetchEbayCategoryData(category, subCategory);
          const fetchedCategoryID = categoryData?.categoryID;
          const categoryTemplate = categoryData?.exportCSV;
          if (fetchedCategoryID) {
            console.log('✅ PhotoAssignmentReview: Setting categoryID:', fetchedCategoryID);
            dispatch({ type: 'SET_CATEGORY_ID', payload: fetchedCategoryID });
          }
          if (categoryTemplate) {
            console.log('✅ PhotoAssignmentReview: Setting categoryTemplate');
            dispatch({ type: 'SET_CATEGORY_TEMPLATE', payload: categoryTemplate });
          }
        } catch (error) {
          console.error('Error fetching eBay category ID:', error);
        }
      }
    };
    updateCategoryID();
  }, [category, subCategory, state.categoryID, dispatch]);
  
  // Optimized image conversion function
  const convertImageToBase64Optimized = (photo) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        try {
          // Use regular canvas - OffscreenCanvas has compatibility issues
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Calculate optimal dimensions
          const maxSize = 800;
          let { width, height } = img;
          
          if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height);
            width *= ratio;
            height *= ratio;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          // Use better image rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with optimized quality
          const base64 = canvas.toDataURL('image/jpeg', 0.8);
          resolve(base64);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = photo.url;
    });
  };
  
  // Upload blob URL to S3
  const uploadBlobToS3 = async (blobUrl, fileName = 'image.jpg') => {
    try {
      // Fetch the blob from the blob URL
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      
      // Convert blob to array buffer
      const arrayBuffer = await blob.arrayBuffer();
      
      // Generate unique filename
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const s3Key = `uploads/${timestamp}_${randomId}_${fileName}`;
      
      // AWS Configuration
      const REGION = "us-east-2";
      const BUCKET_NAME = "listeasier";
      const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";
      
      // Create S3 client
      const s3Client = new S3Client({
        region: REGION,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region: REGION },
          identityPoolId: IDENTITY_POOL_ID,
        }),
      });
      
      // Upload to S3
      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: new Uint8Array(arrayBuffer),
        ContentType: blob.type || 'image/jpeg',
        ACL: "public-read",
        CacheControl: "max-age=31536000",
      };
      
      console.log('📤 Uploading blob to S3:', s3Key);
      const command = new PutObjectCommand(uploadParams);
      await s3Client.send(command);
      
      const s3Url = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${s3Key}`;
      console.log('✅ S3 upload successful:', s3Url);
      return s3Url;
    } catch (error) {
      console.error("❌ Error uploading blob to S3:", error);
      throw error;
    }
  };
  
  // Sync with initial generated listings when they change from parent
  useEffect(() => {
    if (initialGeneratedListings.length > 0 && initialGeneratedListings !== generatedListings) {
      setGeneratedListings(initialGeneratedListings);
      
      // Also sync s3ImageGroups if we have generated listings with photos
      const s3ImageGroups = initialGeneratedListings.map(listing => 
        listing.photos ? listing.photos.map(photo => photo.url) : []
      );
      if (s3ImageGroups.some(group => group.length > 0)) {
        console.log('📤 PhotoAssignmentReview: Setting initial s3ImageGroups with count:', s3ImageGroups.length);
        dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: s3ImageGroups });
      }
    }
  }, [initialGeneratedListings]);
  
  // Generate listings when component mounts or when photoListings change
  useEffect(() => {
    console.log('PhotoAssignmentReview mounted with categoryFields:', categoryFields);
    console.log('Initial generated listings:', initialGeneratedListings.length);
    console.log('Photo listings:', photoListings.length);
    
    // Set s3ImageGroups from photoListings if not already set
    if (photoListings.length > 0 && (!state.s3ImageGroups || state.s3ImageGroups.length === 0)) {
      const s3ImageGroups = photoListings.map(listing => 
        listing.photos ? listing.photos.map(photo => photo.url) : []
      );
      console.log('📤 PhotoAssignmentReview: Setting s3ImageGroups from photoListings:', s3ImageGroups.length);
      dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: s3ImageGroups });
    }
    
    // Check if we need to generate listings for new photoListings
    const existingListingIds = new Set(generatedListings.map(listing => listing.id));
    const newPhotoListings = photoListings.filter(photoListing => !existingListingIds.has(photoListing.id));
    
    if (newPhotoListings.length > 0) {
      generateListingsForNew(newPhotoListings);
    } else if (initialGeneratedListings.length === 0 && photoListings.length > 0) {
      generateListings();
    }
  }, [photoListings]);
  
  // Update parent when generatedListings change
  useEffect(() => {
    if (onGeneratedListingsChange && generatedListings.length > 0) {
      onGeneratedListingsChange(generatedListings);
    }
  }, [generatedListings, onGeneratedListingsChange]);
  
  // Select first listing by default when generated
  useEffect(() => {
    if (generatedListings.length > 0 && !selectedListing) {
      setSelectedListing(generatedListings[0]);
      setSelectedListingIndex(0);
    }
  }, [generatedListings]);
  
  // Generate listings for new photo listings (incremental)
  const generateRemainingListings = async () => {
    // Get the non-generated listings
    let remainingListings = photoListings.filter(listing => {
      return !generatedListings.some(gen => gen.id === listing.id);
    });
    
    if (remainingListings.length === 0) {
      alert('All listings have already been generated.');
      return;
    }
    
    // Check quota before generating
    if (user?.sub) {
      const quotaCheck = await checkQuotaForGeneration(remainingListings.length);
      setQuotaInfo(quotaCheck);
      
      if (!quotaCheck.allowed && !quotaCheck.canGeneratePartial) {
        setQuotaExceeded(true);
        setError(`Listing quota exceeded. You have ${quotaCheck.remaining} listings remaining ${quotaCheck.isLifetime ? '' : 'this month'}. Upgrade your plan to generate more listings.`);
        return;
      }
      
      // Handle partial generation automatically
      if (quotaCheck.canGeneratePartial) {
        // Show notification instead of confirmation dialog
        setQuotaNotification(`⚠️ Quota limit reached: Generating ${quotaCheck.remaining} out of ${remainingListings.length} remaining listings (remaining quota: ${quotaCheck.remaining}).`);
        
        // Only process the number of listings allowed by quota
        remainingListings = remainingListings.slice(0, quotaCheck.remaining);
      }
    }
    
    // Use the existing generateListingsForNew function
    await generateListingsForNew(remainingListings);
  };

  const generateListingsForNew = async (newPhotoListings) => {
    if (newPhotoListings.length === 0) return;
    
    // Check quota before generating
    if (user?.sub) {
      const quotaCheck = await listingQuotaService.canGenerateListings(user.sub, newPhotoListings.length);
      setQuotaInfo(quotaCheck);
      
      if (!quotaCheck.allowed) {
        setQuotaExceeded(true);
        setError(`Listing quota exceeded. You have ${quotaCheck.remaining} listings remaining ${quotaCheck.isLifetime ? '' : 'this month'}. Upgrade your plan to generate more listings.`);
        return;
      }
    }
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setError(null);
    setQuotaNotification(null);
    
    try {
      const newResults = [];
      const totalNewListings = newPhotoListings.length;
      
      // Prepare field selections with AI resolution if enabled
      const fieldSelections = state.fieldSelections || {};
      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections,
        state.price || currentBatch?.salePrice || '',
        '', // SKU will be set per listing
        ebayAuthenticated ? selectedPolicies : null
      );
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
        console.log('🤖 AI Category Fields enabled for new listings:', {
          aiResolveCategoryFields,
          categoryFieldsCount: categoryFields.length,
          selectedCategoryOptions
        });
      }
      
      // Process listings in batches for better performance
      // Adjust batch size based on total listings for optimal performance
      const BATCH_SIZE = Math.min(10, Math.max(3, Math.ceil(newPhotoListings.length / 10))); // 3-10 listings per batch
      const batches = [];
      
      // Group listings into batches
      for (let i = 0; i < newPhotoListings.length; i += BATCH_SIZE) {
        batches.push(newPhotoListings.slice(i, i + BATCH_SIZE));
      }
      
      let processedCount = 0;
      
      // Process each batch
      for (const batch of batches) {
        // Process all listings in the batch concurrently
        const batchPromises = batch.map(async (listing) => {
          try {
            // Convert photos to base64 using the optimized function
            const base64Images = await Promise.all(
              listing.photos.map(photo => convertImageToBase64Optimized(photo))
            );
            
            // Call API to generate listing
            const response = await fetch(
              "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  category: state.category || currentBatch?.category,
                  subCategory: state.subCategory || currentBatch?.subCategory,
                  Base64Key: [base64Images],
                  SelectedCategoryOptions: {
                    ...selectedCategoryOptions,
                    sku: listing.sku
                  }
                })
              }
            );
            
            if (!response.ok) {
              throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            let parsed = data.body;
            if (typeof parsed === "string") parsed = JSON.parse(parsed);
            
            const result = Array.isArray(parsed) ? parsed[0] : parsed;
            
            return { listing, result, base64Images };
          } catch (error) {
            console.error(`Error processing listing ${listing.sku}:`, error);
            return { listing, error: error.message };
          }
        });
        
        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises);
        
        // Process batch results
        console.log('🔄 PhotoAssignmentReview: Processing batch results, count:', batchResults.length);
        for (const { listing, result, base64Images, error } of batchResults) {
          processedCount++;
          setGenerationProgress(Math.round((processedCount / totalNewListings) * 100));
          
          if (error) {
            console.log('❌ PhotoAssignmentReview: Processing error for listing:', listing.sku, error);
            newResults.push({
              id: listing.id,
              title: 'Error generating title',
              description: error,
              price: currentBatch?.salePrice || '0.00',
              sku: listing.sku,
              photos: listing.photos,
              fieldSelections: {},
              aiResolvedFields: {},
              error: error
            });
            continue;
          }
          
          console.log('🔍 API Response for new listing:', {
            sku: listing.sku,
            title: result.title,
            description: result.description,
            fieldSelections: result.fieldSelections,
            aiResolvedFields: result.aiResolvedFields,
            fullResult: result
          });
          
          console.log('🔧 PhotoAssignmentReview: Starting field selection processing');
          // Start with batch category field selections, then merge AI resolved fields
          let finalFieldSelections = { ...fieldSelections };
          
          // Apply batch category field selections first (if available)
          if (currentBatch?.categoryFieldSelections) {
            Object.entries(currentBatch.categoryFieldSelections).forEach(([fieldName, batchValue]) => {
              // Only apply batch value if current field is empty and field is not omitted
              const isOmitted = currentBatch.omittedCategoryFields?.includes(fieldName);
              if (!isOmitted && batchValue && batchValue.trim() !== '') {
                const currentValue = fieldSelections[fieldName];
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  finalFieldSelections[fieldName] = batchValue.trim();
                }
              }
            });
          }
          
          // Then merge AI resolved fields (only for non-omitted fields)
          if (result.aiResolvedFields && aiResolveCategoryFields) {
            Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
              // Skip if field is omitted in batch settings
              const isOmitted = currentBatch?.omittedCategoryFields?.includes(fieldName);
              if (!isOmitted) {
                const currentValue = finalFieldSelections[fieldName];
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified") {
                    finalFieldSelections[fieldName] = aiValue.trim();
                  }
                }
              }
            });
          }
          
          // Remove omitted fields entirely
          if (currentBatch?.omittedCategoryFields) {
            currentBatch.omittedCategoryFields.forEach(fieldName => {
              delete finalFieldSelections[fieldName];
            });
          }
          
          console.log('🏗️ PhotoAssignmentReview: Creating listing object for:', listing.sku);
          // Create the listing object
          const generatedListing = {
            id: listing.id,
            title: result.title || `Listing for ${listing.sku}`,
            description: result.description || '',
            price: result.price || state.price || currentBatch?.salePrice || '',
            sku: listing.sku,
            photos: listing.photos,
            base64Images: base64Images,
            fieldSelections: finalFieldSelections,
            aiResolvedFields: result.aiResolvedFields || {},
            error: null
          };
          
          console.log('✅ PhotoAssignmentReview: Created listing object, adding to results');
          newResults.push(generatedListing);
        }
        console.log('🏁 PhotoAssignmentReview: Finished processing batch results for batch');
      }
      
      console.log('🏆 PhotoAssignmentReview: Completed all batches, newResults length:', newResults.length);
      // Merge new results with existing listings
      const mergedResults = [...generatedListings, ...newResults];
      console.log('🔄 PhotoAssignmentReview: Setting generated listings with merged results, count:', mergedResults.length);
      setGeneratedListings(mergedResults);
      console.log('🔄 PhotoAssignmentReview: Setting isGenerating to false');
      setIsGenerating(false);
      
      // Update app state with all listings
      const responseData = mergedResults.map(listing => ({
        title: listing.title,
        description: listing.description,
        price: listing.price,
        sku: listing.sku,
        storedFieldSelections: listing.fieldSelections,
        aiResolvedFields: listing.aiResolvedFields,
        error: listing.error
      }));
      
      console.log('📤 PhotoAssignmentReview: Dispatching SET_RESPONSE_DATA with count:', responseData.length);
      dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
      
      // Upload blob images to S3 and update s3ImageGroups
      console.log('🔄 PhotoAssignmentReview: Uploading images to S3...');
      const s3ImageGroups = [];
      
      for (const listing of mergedResults) {
        const s3Urls = [];
        if (listing.photos && listing.photos.length > 0) {
          for (const photo of listing.photos) {
            try {
              // Check if it's a blob URL that needs uploading
              if (photo.url && photo.url.startsWith('blob:')) {
                console.log(`📤 Uploading blob image for ${listing.sku}: ${photo.name}`);
                const s3Url = await uploadBlobToS3(photo.url, photo.name || 'photo.jpg');
                s3Urls.push(s3Url);
              } else if (photo.url && photo.url.includes('http')) {
                // Already an S3 URL
                s3Urls.push(photo.url);
              }
            } catch (error) {
              console.error(`❌ Failed to upload image for ${listing.sku}:`, error);
              // Continue with other images
            }
          }
        }
        s3ImageGroups.push(s3Urls);
      }
      
      console.log('📤 PhotoAssignmentReview: Setting s3ImageGroups with count:', s3ImageGroups.length);
      console.log('📤 PhotoAssignmentReview: First group S3 URLs:', s3ImageGroups[0]);
      dispatch({ type: 'SET_S3_IMAGE_GROUPS', payload: s3ImageGroups });
      
      // Also update the parent component
      console.log('👆 PhotoAssignmentReview: Calling onGeneratedListingsChange');
      if (onGeneratedListingsChange) {
        onGeneratedListingsChange(mergedResults);
      }
      console.log('✅ PhotoAssignmentReview: Listing generation completed successfully');
      
      // Increment quota after successful generation
      if (user?.sub && newResults.length > 0) {
        try {
          await updateQuotaAfterGeneration(newResults.length);
        } catch (quotaError) {
          console.error('Error updating listing quota:', quotaError);
        }
      }
      
    } catch (error) {
      console.error('Error generating new listings:', error);
      setError(error.message);
      setIsGenerating(false);
    }
  };
  
  const generateListings = async () => {
    // Check quota before generating
    if (user?.sub) {
      const quotaCheck = await checkQuotaForGeneration(photoListings.length);
      setQuotaInfo(quotaCheck);
      
      if (!quotaCheck.allowed && !quotaCheck.canGeneratePartial) {
        setQuotaExceeded(true);
        setError(`Listing quota exceeded. You have ${quotaCheck.remaining} listings remaining ${quotaCheck.isLifetime ? '' : 'this month'}. Upgrade your plan to generate more listings.`);
        return;
      }
      
      // Handle partial generation automatically
      if (quotaCheck.canGeneratePartial) {
        // Show notification instead of confirmation dialog
        setQuotaNotification(`⚠️ Quota limit reached: Generating ${quotaCheck.remaining} out of ${photoListings.length} listings (remaining quota: ${quotaCheck.remaining}).`);
        
        // Only process the number of listings allowed by quota
        const listingsToProcess = photoListings.slice(0, quotaCheck.remaining);
        photoListings = listingsToProcess;
      }
    }
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setError(null);
    setQuotaNotification(null);
    
    try {
      const results = [];
      const totalListings = photoListings.length;
      
      // Prepare field selections with AI resolution if enabled
      const fieldSelections = state.fieldSelections || {};
      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections,
        state.price || currentBatch?.salePrice || '',
        '', // SKU will be set per listing
        ebayAuthenticated ? selectedPolicies : null
      );
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
        console.log('🤖 AI Category Fields enabled for main generation:', {
          aiResolveCategoryFields,
          categoryFieldsCount: categoryFields.length,
          selectedCategoryOptions
        });
      }
      
      // Process listings in batches for better performance
      // Adjust batch size based on total listings for optimal performance
      const BATCH_SIZE = Math.min(10, Math.max(3, Math.ceil(photoListings.length / 10))); // 3-10 listings per batch
      const batches = [];
      
      // Group listings into batches
      for (let i = 0; i < photoListings.length; i += BATCH_SIZE) {
        batches.push(photoListings.slice(i, i + BATCH_SIZE));
      }
      
      let processedCount = 0;
      
      // Process each batch
      for (const batch of batches) {
        // Process all listings in the batch concurrently
        const batchPromises = batch.map(async (listing) => {
        try {
          // Optimized image conversion with Promise.all for parallel processing
          const base64Images = await Promise.all(
            listing.photos.map(photo => convertImageToBase64Optimized(photo))
          );
          
          // Call API to generate listing
          const response = await fetch(
            "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: state.category || currentBatch?.category,
                subCategory: state.subCategory || currentBatch?.subCategory,
                Base64Key: [base64Images],
                SelectedCategoryOptions: {
                  ...selectedCategoryOptions,
                  sku: listing.sku
                }
              })
            }
          );
          
          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }
          
          const data = await response.json();
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          const result = Array.isArray(parsed) ? parsed[0] : parsed;
          
          console.log('🔍 API Response for main listing:', {
            sku: listing.sku,
            title: result.title,
            description: result.description,
            fieldSelections: result.fieldSelections,
            aiResolvedFields: result.aiResolvedFields,
            fullResult: result
          });
          
          // Start with batch category field selections, then merge AI resolved fields
          let finalFieldSelections = { ...fieldSelections };
          
          // Apply batch category field selections first (if available)
          if (currentBatch?.categoryFieldSelections) {
            Object.entries(currentBatch.categoryFieldSelections).forEach(([fieldName, batchValue]) => {
              // Only apply batch value if current field is empty and field is not omitted
              const isOmitted = currentBatch.omittedCategoryFields?.includes(fieldName);
              if (!isOmitted && batchValue && batchValue.trim() !== '') {
                const currentValue = fieldSelections[fieldName];
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  finalFieldSelections[fieldName] = batchValue.trim();
                }
              }
            });
          }
          
          // Then merge AI resolved fields (only for non-omitted fields)
          if (result.aiResolvedFields && aiResolveCategoryFields) {
            Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
              // Skip if field is omitted in batch settings
              const isOmitted = currentBatch?.omittedCategoryFields?.includes(fieldName);
              if (!isOmitted) {
                const currentValue = finalFieldSelections[fieldName];
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified") {
                    finalFieldSelections[fieldName] = aiValue.trim();
                  }
                }
              }
            });
          }
          
          // Remove omitted fields entirely
          if (currentBatch?.omittedCategoryFields) {
            currentBatch.omittedCategoryFields.forEach(fieldName => {
              delete finalFieldSelections[fieldName];
            });
          }
          
          results.push({
            id: listing.id,
            sku: listing.sku,
            photos: listing.photos,
            base64Images: base64Images,
            title: result.title || `Listing ${i + 1}`,
            description: result.description || '',
            price: state.price || currentBatch?.salePrice || '',
            fieldSelections: finalFieldSelections,
            aiResolvedFields: result.aiResolvedFields || {},
            error: result.error || null
          });
          
          return { listing, result, base64Images, finalFieldSelections };
        } catch (error) {
          console.error(`Error processing listing ${listing.sku}:`, error);
          return { listing, error: error.message };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Process batch results
      for (const { listing, result, base64Images, finalFieldSelections, error } of batchResults) {
        processedCount++;
        setGenerationProgress(Math.round((processedCount / totalListings) * 100));
        
        if (error) {
          results.push({
            id: listing.id,
            sku: listing.sku,
            photos: listing.photos,
            title: `Error: Listing`,
            description: error,
            error: true
          });
          continue;
        }
        
        results.push({
          id: listing.id,
          sku: listing.sku,
          photos: listing.photos,
          base64Images: base64Images,
          title: result.title || `Listing`,
          description: result.description || '',
          price: state.price || currentBatch?.salePrice || '',
          fieldSelections: finalFieldSelections || {},
          aiResolvedFields: result.aiResolvedFields || {},
          error: result.error || null
        });
      }
    }
      
      console.log('🏁 PhotoAssignmentReview: Completed all batch processing loops');
      console.log('🔍 PhotoAssignmentReview: Finished processing all results, total:', results.length);
      console.log('🎉 PhotoAssignmentReview: Setting generated listings:', results.length);
      setGeneratedListings(results);
      console.log('🔄 PhotoAssignmentReview: Setting isGenerating to false');
      setIsGenerating(false);
      
      // Update app state with generated listings
      const responseData = results.map(listing => ({
        title: listing.title,
        description: listing.description,
        price: listing.price,
        sku: listing.sku,
        storedFieldSelections: listing.fieldSelections,
        aiResolvedFields: listing.aiResolvedFields,
        error: listing.error
      }));
      
      console.log('📤 PhotoAssignmentReview: Dispatching SET_RESPONSE_DATA');
      dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
      
      // Also update the parent component
      console.log('👆 PhotoAssignmentReview: Calling onGeneratedListingsChange');
      if (onGeneratedListingsChange) {
        onGeneratedListingsChange(results);
      }
      console.log('✅ PhotoAssignmentReview: Listing generation completed successfully');
      
      // Increment quota after successful generation
      if (user?.sub && results.length > 0) {
        try {
          const validResults = results.filter(r => !r.error);
          if (validResults.length > 0) {
            await updateQuotaAfterGeneration(validResults.length);
          }
        } catch (quotaError) {
          console.error('Error updating listing quota:', quotaError);
        }
      }
      
    } catch (error) {
      console.error('Error generating listings:', error);
      setError(error.message);
      setIsGenerating(false);
    }
  };
  
  const handleListingSelect = (listing, index) => {
    setSelectedListing(listing);
    setSelectedListingIndex(index);
  };
  
  const updateListing = (field, value) => {
    if (!selectedListing) return;
    
    const updatedListing = {
      ...selectedListing,
      [field]: value
    };
    
    const updatedListings = [...generatedListings];
    updatedListings[selectedListingIndex] = updatedListing;
    setGeneratedListings(updatedListings);
    setSelectedListing(updatedListing);
    
    // Update app state
    const responseData = updatedListings.map(listing => ({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      sku: listing.sku,
      storedFieldSelections: listing.fieldSelections,
      aiResolvedFields: listing.aiResolvedFields,
      error: listing.error
    }));
    
    dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
    
    // Also update the parent component
    if (onGeneratedListingsChange) {
      onGeneratedListingsChange(updatedListings);
    }
  };
  
  const updateFieldSelection = (field, value) => {
    if (!selectedListing) return;
    
    const updatedListing = {
      ...selectedListing,
      fieldSelections: {
        ...selectedListing.fieldSelections,
        [field]: value
      }
    };
    
    const updatedListings = [...generatedListings];
    updatedListings[selectedListingIndex] = updatedListing;
    setGeneratedListings(updatedListings);
    setSelectedListing(updatedListing);
    
    // Update app state
    const responseData = updatedListings.map(listing => ({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      sku: listing.sku,
      storedFieldSelections: listing.fieldSelections,
      aiResolvedFields: listing.aiResolvedFields,
      error: listing.error
    }));
    
    dispatch({ type: 'SET_RESPONSE_DATA', payload: responseData });
    
    // Also update the parent component
    if (onGeneratedListingsChange) {
      onGeneratedListingsChange(updatedListings);
    }
  };
  
  const downloadCSV = () => {
    if (generatedListings.length === 0) return;
    
    // Create CSV header
    const headers = ['Title', 'Description', 'Price', 'SKU'];
    
    // Add category field headers (exclude omitted fields)
    if (categoryFields.length > 0) {
      categoryFields
        .filter(field => !currentBatch?.omittedCategoryFields?.includes(field.FieldLabel))
        .forEach(field => {
          headers.push(field.FieldLabel);
        });
    }
    
    // Create CSV rows
    const rows = generatedListings.map(listing => {
      const row = [
        listing.title,
        listing.description.replace(/"/g, '""'), // Escape quotes
        listing.price,
        listing.sku
      ];
      
      // Add category field values (exclude omitted fields)
      if (categoryFields.length > 0) {
        categoryFields
          .filter(field => !currentBatch?.omittedCategoryFields?.includes(field.FieldLabel))
          .forEach(field => {
            const value = listing.fieldSelections[field.FieldLabel] || '';
            row.push(value);
          });
      }
      
      return row;
    });
    
    // Convert to CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    saveAs(blob, `${currentBatch?.name || 'listings'}_${new Date().toISOString().split('T')[0]}.csv`);
  };
  
  
  const handleEbayListingsCreated = (count) => {
    console.log(`${count} listings created on eBay`);
    // You can add additional handling here if needed
  };
  
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '15px'
      }}>
        <div>
          <h2 style={{ margin: '0 0 5px 0', color: '#333' }}>
            📋 Review & Finalize Listings
          </h2>
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
            {isGenerating 
              ? `Generating listings... ${generationProgress}%` 
              : `${generatedListings.length} of ${photoListings.length} listings generated`}
          </p>
          {quotaInfo && !quotaInfo.error && (
            <p style={{ margin: '5px 0 0 0', fontSize: '12px', color: quotaInfo.remaining < 5 ? '#dc3545' : '#666' }}>
              {quotaInfo.remaining} listings remaining {quotaInfo.isLifetime ? '' : 'this month'}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            ← Back to Photo Assignment
          </button>
          {!isGenerating && generatedListings.length < photoListings.length && (
            <button
              onClick={generateRemainingListings}
              style={{
                padding: '10px 20px',
                backgroundColor: '#ffc107',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              🔄 Generate Remaining ({photoListings.length - generatedListings.length})
            </button>
          )}
          {!isGenerating && generatedListings.length > 0 && (
            <>
              <button
                onClick={downloadCSV}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                📄 Download CSV
              </button>
              {ebayAuthenticated ? (
                <button
                  onClick={() => setShowEbayListingManager(true)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🛒 List on eBay
                </button>
              ) : (
                <button
                  onClick={() => setShowEbayAuth(true)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  🔗 Connect eBay Account
                </button>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      {quotaNotification && (
        <div style={{
          backgroundColor: '#fff3cd',
          color: '#856404',
          padding: '15px 20px',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #ffeaa7',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '20px' }}>⚠️</span>
          <span>{quotaNotification}</span>
        </div>
      )}
      {error ? (
        <div style={{
          backgroundColor: '#f8d7da',
          color: '#721c24',
          padding: '20px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <strong>Error:</strong> {error}
        </div>
      ) : isGenerating ? (
        <div style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'white',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ 
              marginBottom: '20px',
              display: 'inline-block'
            }}>
              <div style={{
                width: '60px',
                height: '60px',
                border: '6px solid #f3f3f3',
                borderTop: '6px solid #007bff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
            </div>
            <h3>Generating Listings...</h3>
            <div style={{
              width: '300px',
              height: '20px',
              backgroundColor: '#e0e0e0',
              borderRadius: '10px',
              overflow: 'hidden',
              marginTop: '20px'
            }}>
              <div style={{
                width: `${generationProgress}%`,
                height: '100%',
                backgroundColor: '#007bff',
                transition: 'width 0.3s ease'
              }} />
            </div>
            <p style={{ marginTop: '10px', color: '#666' }}>
              {generationProgress}% Complete
            </p>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '350px 1fr',
          gap: '20px',
          minHeight: 0
        }}>
          {/* Left Column - Listing List */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', color: '#333' }}>
              Listings
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {generatedListings.map((listing, index) => (
                <div
                  key={listing.id}
                  onClick={() => handleListingSelect(listing, index)}
                  style={{
                    padding: '15px',
                    border: `2px solid ${selectedListing?.id === listing.id ? '#007bff' : '#e0e0e0'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: selectedListing?.id === listing.id ? '#f0f8ff' : 'white',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Thumbnail */}
                    {listing.photos.length > 0 && (
                      <img
                        src={listing.photos[0].url}
                        alt="Listing thumbnail"
                        style={{
                          width: '60px',
                          height: '60px',
                          objectFit: 'cover',
                          borderRadius: '6px'
                        }}
                      />
                    )}
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h4 style={{
                        margin: '0 0 4px 0',
                        fontSize: '14px',
                        fontWeight: '600',
                        color: listing.error ? '#dc3545' : '#333',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {listing.title}
                      </h4>
                      <p style={{
                        margin: '0 0 4px 0',
                        fontSize: '12px',
                        color: '#666',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}>
                        {listing.description}
                      </p>
                      <div style={{ fontSize: '11px', color: '#999' }}>
                        SKU: {listing.sku} • ${listing.price} • {listing.photos.length} photos
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Right Column - Listing Details */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            overflowY: 'auto'
          }}>
            {selectedListing ? (
              <div>
                <h3 style={{ margin: '0 0 20px 0', fontSize: '24px', color: '#333' }}>
                  Listing Details
                </h3>
                
                {/* Images */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                    Images
                  </h4>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: '10px'
                  }}>
                    {selectedListing.photos.map((photo, index) => (
                      <img
                        key={photo.id}
                        src={photo.url}
                        alt={`Image ${index + 1}`}
                        style={{
                          width: '100%',
                          height: '120px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: '1px solid #e0e0e0'
                        }}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Title */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>Title</h4>
                  <input
                    type="text"
                    value={selectedListing.title}
                    onChange={(e) => updateListing('title', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      fontSize: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '6px'
                    }}
                  />
                </div>
                
                {/* Details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>SKU</h4>
                    <input
                      type="text"
                      value={selectedListing.sku}
                      onChange={(e) => updateListing('sku', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px',
                        fontSize: '14px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 5px 0', fontSize: '14px', color: '#666' }}>Price</h4>
                    <input
                      type="text"
                      value={selectedListing.price}
                      onChange={(e) => updateListing('price', e.target.value)}
                      placeholder="0.00"
                      style={{
                        width: '100%',
                        padding: '8px',
                        fontSize: '14px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                      }}
                    />
                  </div>
                </div>
                
                {/* Description */}
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                    Description
                  </h4>
                  <textarea
                    value={selectedListing.description}
                    onChange={(e) => updateListing('description', e.target.value)}
                    rows={10}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      resize: 'vertical'
                    }}
                  />
                </div>
                
                {/* Category Fields */}
                {categoryFields && categoryFields.length > 0 && (
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#555' }}>
                      Category Fields
                    </h4>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                      gap: '15px',
                      padding: '15px',
                      backgroundColor: '#34495e',
                      borderRadius: '6px',
                      border: '1px solid #555'
                    }}>
                      {categoryFields
                        .filter(field => !currentBatch?.omittedCategoryFields?.includes(field.FieldLabel))
                        .map((field) => {
                        const value = (selectedListing.fieldSelections && selectedListing.fieldSelections[field.FieldLabel]) || '';
                        const options = field.CategoryOptions ? field.CategoryOptions.split(';').map(opt => opt.trim()) : [];
                        
                        return (
                          <div key={field.FieldLabel}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px', fontWeight: '500', color: 'white' }}>
                              {field.FieldLabel}
                              {selectedListing.aiResolvedFields && 
                               selectedListing.aiResolvedFields[field.FieldLabel] && 
                               selectedListing.aiResolvedFields[field.FieldLabel] === value && (
                                <span style={{ marginLeft: '5px', color: '#007bff', fontSize: '12px' }}>
                                  (AI)
                                </span>
                              )}
                            </label>
                            {/* Custom Type-ahead Dropdown */}
                            <div style={{ position: 'relative' }}>
                              <input
                                ref={(el) => dropdownRefs.current[field.FieldLabel] = el}
                                type="text"
                                value={value}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  updateFieldSelection(field.FieldLabel, newValue);
                                  setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: newValue }));
                                  if (options.length > 0) {
                                    setOpenDropdown(field.FieldLabel);
                                  }
                                }}
                                onFocus={() => {
                                  if (options.length > 0) {
                                    setOpenDropdown(field.FieldLabel);
                                    setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: value }));
                                  }
                                }}
                                onBlur={() => {
                                  // Delay closing to allow for option selection
                                  setTimeout(() => setOpenDropdown(null), 150);
                                }}
                                placeholder={options.length > 0 ? "Type to search or select..." : "Enter value..."}
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  fontSize: '14px',
                                  border: '1px solid #555',
                                  borderRadius: '4px',
                                  backgroundColor: '#2c3e50',
                                  color: 'white',
                                  '::placeholder': {
                                    color: '#bdc3c7'
                                  }
                                }}
                              />
                              {options.length > 0 && openDropdown === field.FieldLabel && (
                                <div style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  maxHeight: '200px',
                                  overflowY: 'auto',
                                  backgroundColor: '#34495e',
                                  border: '1px solid #555',
                                  borderRadius: '4px',
                                  borderTop: 'none',
                                  zIndex: 1000,
                                  boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                                }}>
                                  {options
                                    .filter(opt => 
                                      opt.toLowerCase().includes((searchTerms[field.FieldLabel] || '').toLowerCase())
                                    )
                                    .map((opt, idx) => (
                                      <div
                                        key={idx}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          updateFieldSelection(field.FieldLabel, opt);
                                          setOpenDropdown(null);
                                          setSearchTerms(prev => ({ ...prev, [field.FieldLabel]: opt }));
                                        }}
                                        style={{
                                          padding: '8px 12px',
                                          cursor: 'pointer',
                                          backgroundColor: opt === value ? '#3498db' : 'transparent',
                                          color: 'white',
                                          fontSize: '14px',
                                          borderBottom: '1px solid #555'
                                        }}
                                        onMouseEnter={(e) => {
                                          e.target.style.backgroundColor = '#3498db';
                                        }}
                                        onMouseLeave={(e) => {
                                          e.target.style.backgroundColor = opt === value ? '#3498db' : 'transparent';
                                        }}
                                      >
                                        {opt}
                                      </div>
                                    ))
                                  }
                                  {options
                                    .filter(opt => 
                                      opt.toLowerCase().includes((searchTerms[field.FieldLabel] || '').toLowerCase())
                                    ).length === 0 && (
                                    <div style={{
                                      padding: '8px 12px',
                                      color: '#bdc3c7',
                                      fontSize: '14px',
                                      fontStyle: 'italic'
                                    }}>
                                      No matching options (you can still type your own value)
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: '#999'
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '10px' }}>📋</div>
                  <p>Select a listing to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* eBay Listing Manager Modal */}
      {showEbayListingManager && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <EbayListingManager 
              onClose={() => setShowEbayListingManager(false)}
              onListingsCreated={handleEbayListingsCreated}
            />
          </div>
        </div>
      )}
      
      {/* eBay Auth Modal */}
      {showEbayAuth && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1001
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            width: '90%',
            maxWidth: '600px',
            maxHeight: '90vh',
            overflow: 'auto',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowEbayAuth(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666'
              }}
            >
              ×
            </button>
            <h2 style={{ margin: '0 0 20px 0', color: '#333' }}>
              Connect Your eBay Account
            </h2>
            <EbayAuth 
              onAuthSuccess={() => {
                console.log('eBay authentication successful');
                setShowEbayAuth(false);
              }}
              onAuthError={(error) => {
                console.error('eBay authentication error:', error);
              }}
              redirectAfterAuth={window.location.pathname + window.location.search}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default PhotoAssignmentReview;