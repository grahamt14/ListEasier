// App.jsx - Complete Auth0 Integration with All Components
import React, { useState, useEffect, useRef, useMemo, createContext, useContext, useReducer } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import './App.css';
import './LandingPage.css';
import './LoadingSpinner.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient, QueryCommand, ScanCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AppStateProvider, useAppState } from './StateContext';
import { EbayAuthProvider, useEbayAuth } from './EbayAuthContext';
import { CategoryProvider, useCategories } from './CategoryContext';
import EbayListingManager from './EbayListingManager';
import BatchPreviewSection from './BatchPreviewSection';
import { cacheService } from './CacheService';
import AuthenticationWrapper from './AuthenticationWrapper';
import LandingPage from './LandingPage';
import LoadingSpinner from './LoadingSpinner';
import PhotoAssignmentReview from './PhotoAssignmentReview';

// Auth0 Configuration
const AUTH0_DOMAIN = process.env.REACT_APP_AUTH0_DOMAIN || 'listeasier.us.auth0.com';
const AUTH0_CLIENT_ID = process.env.REACT_APP_AUTH0_CLIENT_ID || '0atdS2Je85AOVcuc9rqkidq0ga2GGVYD';
const AUTH0_AUDIENCE = process.env.REACT_APP_AUTH0_AUDIENCE; // Optional API identifier

const BatchContext = createContext();

const initialBatchState = {
  batches: [],
  templates: [],
  currentBatch: null,
  currentStep: 0,
  viewMode: 'overview', // 'overview', 'create', 'edit'
  statusFilter: 'all', // 'all', 'open', 'closed'
  sidebarCollapsed: false
};

function batchReducer(state, action) {
  switch (action.type) {
    case 'LOAD_BATCHES':
      return { ...state, batches: action.payload };
    case 'CREATE_BATCH':
      return { 
        ...state, 
        batches: [...state.batches, action.payload],
        currentBatch: action.payload,
        viewMode: 'edit'
      };
    case 'UPDATE_BATCH':
      return {
        ...state,
        batches: state.batches.map(batch => 
          batch.id === action.payload.id ? action.payload : batch
        ),
        currentBatch: action.payload
      };
    case 'DELETE_BATCH':
      const remainingBatches = state.batches.filter(batch => batch.id !== action.payload);
      return {
        ...state,
        batches: remainingBatches,
        currentBatch: state.currentBatch?.id === action.payload ? null : state.currentBatch,
        viewMode: state.currentBatch?.id === action.payload ? 'overview' : state.viewMode
      };
    case 'SET_CURRENT_BATCH':
      return { ...state, currentBatch: action.payload, viewMode: 'edit' };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };
    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.payload };
    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'LOAD_TEMPLATES':
      return { ...state, templates: action.payload };
    case 'ADD_TEMPLATE':
      return { 
        ...state, 
        templates: [...state.templates, action.payload]
      };
    case 'UPDATE_TEMPLATE':
      return {
        ...state,
        templates: state.templates.map(template => 
          template.id === action.payload.id ? action.payload : template
        )
      };
    case 'DELETE_TEMPLATE':
      return {
        ...state,
        templates: state.templates.filter(template => template.id !== action.payload)
      };
    default:
      return state;
  }
}

// Enhanced BatchProvider with user-scoped DynamoDB storage
function BatchProvider({ children }) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const [isLoading, setIsLoading] = useState(false);
  const updateTimeouts = new Map();
  const { user, isAuthenticated } = useAuth0();
  
  console.log('🔧 BatchProvider: Initializing with user:', user?.sub);
  
  // AWS Configuration
  const REGION = "us-east-2";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  // Initialize DynamoDB clients
  const dynamoClient = useMemo(() => {
    console.log('🔧 BatchProvider: Creating DynamoDB client...');
    try {
      const client = new DynamoDBClient({
        region: REGION,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region: REGION },
          identityPoolId: IDENTITY_POOL_ID,
        }),
      });
      console.log('✅ BatchProvider: DynamoDB client created successfully');
      return client;
    } catch (error) {
      console.error('❌ BatchProvider: Error creating DynamoDB client:', error);
      throw error;
    }
  }, []);

  const docClient = useMemo(() => {
    console.log('🔧 BatchProvider: Creating DynamoDB Document client...');
    try {
      const client = DynamoDBDocumentClient.from(dynamoClient);
      console.log('✅ BatchProvider: DynamoDB Document client created successfully');
      return client;
    } catch (error) {
      console.error('❌ BatchProvider: Error creating DynamoDB Document client:', error);
      throw error;
    }
  }, [dynamoClient]);

  // Load batches and templates when user is authenticated
  useEffect(() => {
    if (isAuthenticated && user?.sub) {
      console.log('🚀 BatchProvider: User authenticated, loading data for:', user.sub);
      loadBatchesFromDynamoDB();
      loadTemplatesFromDynamoDB();
    }
  }, [isAuthenticated, user?.sub]);

  // Get user ID from Auth0
  const getUserId = () => {
    if (!user?.sub) {
      console.warn('⚠️ BatchProvider: No user ID available');
      return null;
    }
    return user.sub;
  };

 // In App.jsx, replace the compressBatchForStorage function with this optimized version:

// Helper function to compress base64 images for storage
const compressBase64Images = (imageGroups) => {
  if (!imageGroups || imageGroups.length === 0) return [];
  
  return imageGroups.map(group => {
    if (!Array.isArray(group) || group.length === 0) return group;
    
    return group.map(base64 => {
      if (!base64 || typeof base64 !== 'string') return base64;
      
      try {
        // Create a compressed version of the image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        return new Promise((resolve) => {
          img.onload = () => {
            // Reduce dimensions for storage (max 400px width)
            const maxWidth = 400;
            const ratio = Math.min(maxWidth / img.width, maxWidth / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            // Use lower quality for storage
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
            resolve(compressedBase64);
          };
          img.onerror = () => resolve(base64); // Fallback to original
          img.src = base64;
        });
      } catch (error) {
        console.warn('Error compressing image for storage:', error);
        return base64; // Fallback to original
      }
    });
  });
};

const compressBatchForStorage = (batch) => {
  console.log('🗜️ BatchProvider: Compressing batch for storage:', batch.id);
  
  // Ensure responseData is properly preserved with all listing details
  const responseData = batch.appState.responseData || [];
  const preservedResponseData = responseData.map(item => {
    if (!item) return null;
    
    // Preserve essential listing data, compress descriptions
    const compressedDescription = item.description ? 
      item.description.substring(0, 2000) : ''; // Limit description length
    
    return {
      title: item.title || '',
      description: compressedDescription,
      price: item.price || batch.appState.price || '',
      sku: item.sku || batch.appState.sku || '',
      // Preserve category fields and stored selections
      storedFieldSelections: item.storedFieldSelections || {},
      fieldSelections: item.fieldSelections || item.storedFieldSelections || {},
      // Preserve any AI resolved fields
      aiResolvedFields: item.aiResolvedFields || {},
      // Keep error info if present but compress it
      error: item.error || null
      // Remove raw_content - not needed for restoration
    };
  });
  
  // Count valid listings for logging
  const validListingsCount = preservedResponseData.filter(item => item && !item.error).length;
  
  const compressed = {
    ...batch,
    appState: {
      ...batch.appState,
      // Keep compressed images for display - users need to see their uploaded images
      filesBase64: batch.appState.filesBase64 || [],
      rawFiles: [], // Remove heavy raw files
      imageGroups: batch.appState.imageGroups || [[]],
      s3ImageGroups: batch.appState.s3ImageGroups || [[]],
      responseData: preservedResponseData,
      groupMetadata: batch.appState.groupMetadata || [],
      fieldSelections: batch.appState.fieldSelections || {},
      processedGroupIndices: batch.appState.processedGroupIndices || [],
      category: batch.appState.category,
      subCategory: batch.appState.subCategory,
      price: batch.appState.price,
      sku: batch.appState.sku,
      categoryID: batch.appState.categoryID,
      // Reset transient state
      isLoading: false,
      isDirty: false,
      totalChunks: batch.appState.totalChunks || 0,
      completedChunks: batch.appState.completedChunks || 0,
      processingGroups: [], // Always reset to empty array
      errorMessages: [], // Don't save error messages
      imageRotations: batch.appState.imageRotations || {}, // Keep rotations
      selectedImages: [], // Reset selection state
      uploadStatus: {
        isUploading: false,
        uploadProgress: 0,
        uploadTotal: 0,
        uploadCompleted: 0,
        uploadStage: '',
        currentFileIndex: 0
      },
      processingStatus: {
        isProcessing: false,
        processTotal: 0,
        processCompleted: 0,
        processStage: '',
        currentGroup: 0
      }
    }
  };
  
  // Calculate approximate size for logging
  const sizeEstimate = JSON.stringify(compressed).length;
  console.log('✅ BatchProvider: Batch compressed successfully');
  console.log('📊 BatchProvider: Preserved', validListingsCount, 'valid listings');
  console.log('💾 BatchProvider: Estimated size:', Math.round(sizeEstimate / 1024), 'KB');
  
  // DynamoDB has a 400KB limit, so we need to be more aggressive with compression
  if (sizeEstimate > 350000) { // 350KB threshold - leave buffer for DynamoDB overhead
    console.warn('⚠️ BatchProvider: Batch too large, applying aggressive compression');
    
    // Remove base64 images from the pool - these are typically not organized yet
    compressed.appState.filesBase64 = [];
    
    // Compress image groups - only keep S3 URLs if available
    if (compressed.appState.s3ImageGroups && compressed.appState.s3ImageGroups.length > 0) {
      // If we have S3 URLs, we can safely remove base64 data from imageGroups
      compressed.appState.imageGroups = compressed.appState.imageGroups.map((group, index) => {
        const s3Group = compressed.appState.s3ImageGroups[index];
        if (s3Group && s3Group.length > 0) {
          // Return placeholder array of same length - we'll restore from S3
          return new Array(group.length).fill('[S3]');
        }
        return group;
      });
    }
    
    // Further compress response data if needed
    let newSizeEstimate = JSON.stringify(compressed).length;
    if (newSizeEstimate > 380000) {
      console.warn('⚠️ BatchProvider: Still too large, truncating descriptions');
      compressed.appState.responseData = compressed.appState.responseData.map(item => {
        if (!item) return null;
        return {
          ...item,
          description: item.description ? item.description.substring(0, 500) : ''
        };
      });
    }
    
    newSizeEstimate = JSON.stringify(compressed).length;
    console.log('💾 BatchProvider: Size after aggressive compression:', Math.round(newSizeEstimate / 1024), 'KB');
    
    // If STILL too large, we need to remove some data
    if (newSizeEstimate > 390000) {
      console.error('❌ BatchProvider: Batch still too large after compression');
      // Remove imageGroups entirely - rely on S3 URLs
      compressed.appState.imageGroups = [[]];
    }
  }
  
  return compressed;
};
  
  const loadBatchesFromDynamoDB = async () => {
    console.log('📥 BatchProvider: Starting to load batches from DynamoDB (multi-item)...');
    setIsLoading(true);
    try {
      const userId = getUserId();
      if (!userId) {
        console.warn('⚠️ BatchProvider: No user ID, skipping batch load');
        setIsLoading(false);
        return;
      }
      
      // Query for all items belonging to this user
      const queryParams = {
        TableName: 'ListEasierBatches',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: marshall({
          ':userId': userId
        })
      };
      
      console.log('🔍 BatchProvider: Querying all user items...');
      const command = new QueryCommand(queryParams);
      const response = await dynamoClient.send(command);
      const marshalledItems = response.Items || [];
      
      console.log('📦 BatchProvider: Found', marshalledItems.length, 'items for user');
      
      // Unmarshall all items
      const allItems = marshalledItems.map(item => unmarshall(item));
      
      // Group items by batch
      const itemsByBatch = {};
      
      allItems.forEach(item => {
        // Skip archive items
        if (item.batchId.startsWith('archive#')) return;
        
        // Extract the base batch ID (remove suffixes like #images#0, #settings, etc.)
        const baseBatchId = item.batchId.split('#')[0];
        
        if (!itemsByBatch[baseBatchId]) {
          itemsByBatch[baseBatchId] = {
            main: null,
            images: [],
            listings: [],
            settings: null
          };
        }
        
        // Categorize items by type
        if (item.itemType === 'batch_main') {
          itemsByBatch[baseBatchId].main = item;
        } else if (item.itemType === 'image_chunk') {
          itemsByBatch[baseBatchId].images.push(item);
        } else if (item.itemType === 'listing_chunk') {
          itemsByBatch[baseBatchId].listings.push(item);
        } else if (item.itemType === 'batch_settings') {
          itemsByBatch[baseBatchId].settings = item;
        }
      });
      
      // Assemble complete batches
      const batches = [];
      
      for (const [batchId, items] of Object.entries(itemsByBatch)) {
        if (!items.main) {
          console.warn('⚠️ BatchProvider: Missing main item for batch:', batchId);
          continue;
        }
        
        console.log(`🔄 BatchProvider: Assembling batch ${batchId}...`);
        
        // Start with main batch data - ensure string fields
        const batch = {
          ...items.main,
          id: batchId,
          category: typeof items.main.category === 'string' ? items.main.category : String(items.main.category || '--'),
          subCategory: typeof items.main.subCategory === 'string' ? items.main.subCategory : String(items.main.subCategory || '--'),
          name: typeof items.main.name === 'string' ? items.main.name : String(items.main.name || 'Unnamed Batch'),
          status: typeof items.main.status === 'string' ? items.main.status : String(items.main.status || 'draft'),
          appState: {
            // Initialize empty state
            filesBase64: [],
            rawFiles: [],
            imageGroups: [],
            s3ImageGroups: [],
            responseData: [],
            groupMetadata: [],
            fieldSelections: {},
            processedGroupIndices: [],
            imageRotations: {},
            // Copy basic fields - ensure they're strings
            category: typeof items.main.category === 'string' ? items.main.category : String(items.main.category || '--'),
            subCategory: typeof items.main.subCategory === 'string' ? items.main.subCategory : String(items.main.subCategory || '--'),
            price: typeof items.main.salePrice === 'string' ? items.main.salePrice : String(items.main.salePrice || ''),
            sku: typeof items.main.sku === 'string' ? items.main.sku : String(items.main.sku || ''),
            categoryID: null,
            // Reset status fields
            isLoading: false,
            isDirty: false,
            totalChunks: 0,
            completedChunks: 0,
            processingGroups: [],
            errorMessages: [],
            selectedImages: [],
            uploadStatus: {
              isUploading: false,
              uploadProgress: 0,
              uploadTotal: 0,
              uploadCompleted: 0,
              uploadStage: '',
              currentFileIndex: 0
            },
            processingStatus: {
              isProcessing: false,
              processTotal: 0,
              processCompleted: 0,
              processStage: '',
              currentGroup: 0
            }
          }
        };
        
        // Load image chunks
        if (items.images.length > 0) {
          // Sort by chunk index
          items.images.sort((a, b) => a.chunkIndex - b.chunkIndex);
          
          items.images.forEach(chunk => {
            // Add image groups
            if (chunk.imageGroups) {
              batch.appState.imageGroups.push(...chunk.imageGroups);
            }
            if (chunk.s3ImageGroups) {
              batch.appState.s3ImageGroups.push(...chunk.s3ImageGroups);
            }
            // Add pool images
            if (chunk.filesBase64) {
              batch.appState.filesBase64.push(...chunk.filesBase64);
            }
          });
        }
        
        // Load listing chunks
        if (items.listings.length > 0) {
          // Sort by chunk index
          items.listings.sort((a, b) => a.chunkIndex - b.chunkIndex);
          
          items.listings.forEach(chunk => {
            if (chunk.responseData) {
              batch.appState.responseData.push(...chunk.responseData);
            }
            if (chunk.groupMetadata) {
              batch.appState.groupMetadata.push(...chunk.groupMetadata);
            }
          });
        }
        
        // Load settings
        if (items.settings) {
          batch.appState.fieldSelections = items.settings.fieldSelections || {};
          batch.appState.processedGroupIndices = items.settings.processedGroupIndices || [];
          batch.appState.categoryID = items.settings.categoryID || null;
          batch.appState.imageRotations = items.settings.imageRotations || {};
        }
        
        // Ensure at least one empty image group
        if (batch.appState.imageGroups.length === 0) {
          batch.appState.imageGroups.push([]);
          batch.appState.s3ImageGroups.push([]);
        }
        
        batches.push(batch);
      }
      
      console.log('✅ BatchProvider: Loaded', batches.length, 'batches from DynamoDB');
      
      // Sort batches by creation date (newest first)
      batches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      dispatch({ type: 'LOAD_BATCHES', payload: batches });
    } catch (error) {
      console.error('❌ BatchProvider: Failed to load batches:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTemplatesFromDynamoDB = async () => {
    console.log('📥 BatchProvider: Starting to load templates from DynamoDB...');
    try {
      const userId = getUserId();
      if (!userId) {
        console.warn('⚠️ BatchProvider: No user ID, skipping template load');
        return;
      }
      
      const scanParams = {
        TableName: 'ListEasierBatches',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': { S: userId }
        }
      };

      console.log('🔍 BatchProvider: Template scan parameters:', scanParams);
      const command = new ScanCommand(scanParams);
      const response = await dynamoClient.send(command);
      
      const allItems = (response.Items || []).map(item => unmarshall(item));
      
      // Filter templates on the client side
      const templates = allItems.filter(item => 
        item.batchId && item.batchId.startsWith('template_')
      );
      
      console.log('✅ BatchProvider: Loaded templates:', templates.length);
      dispatch({ type: 'LOAD_TEMPLATES', payload: templates });
      
    } catch (error) {
      console.error('❌ BatchProvider: Error loading templates from DynamoDB:', error);
      dispatch({ type: 'LOAD_TEMPLATES', payload: [] });
    }
  };

 const updateBatch = (batchData, forceSave = false) => {
  console.log('🔄 BatchProvider: Updating batch:', batchData.id, forceSave ? '(force save)' : '');
  
  const safeStringConvert = (value, defaultValue = '--') => {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      console.warn('⚠️ BatchProvider: Converting object to string:', value);
      return defaultValue;
    }
    return String(value);
  };
  
  const updatedBatch = {
    ...batchData,
    category: safeStringConvert(batchData.category, '--'),
    subCategory: safeStringConvert(batchData.subCategory, '--'),
    name: safeStringConvert(batchData.name, `Batch ${batchData.id}`),
    id: safeStringConvert(batchData.id),
    salePrice: safeStringConvert(batchData.salePrice, ''),
    sku: safeStringConvert(batchData.sku, ''),
    updatedAt: new Date().toISOString(),
    appState: {
      ...batchData.appState,
      category: safeStringConvert(batchData.appState?.category || batchData.category, '--'),
      subCategory: safeStringConvert(batchData.appState?.subCategory || batchData.subCategory, '--'),
      price: safeStringConvert(batchData.appState?.price || batchData.salePrice, ''),
      sku: safeStringConvert(batchData.appState?.sku || batchData.sku, '')
    }
  };
  
  console.log('✅ BatchProvider: Updated batch object created with proper string conversion');
  dispatch({ type: 'UPDATE_BATCH', payload: updatedBatch });
  
  // Check for significant changes that should trigger immediate save
  const hasNewListings = updatedBatch.appState?.responseData?.some(item => item && !item.error);
  const hasImages = updatedBatch.appState?.imageGroups?.some(group => group && group.length > 0);
  
  if (forceSave || hasNewListings || hasImages) {
    // Immediate save for important changes
    console.log('💾 BatchProvider: Immediate save triggered for significant changes');
    saveBatchToDynamoDB(updatedBatch, true).catch(error => {
      console.error('❌ BatchProvider: Failed to immediately save batch:', error);
    });
  } else {
    // Throttled save for minor changes
    const batchId = updatedBatch.id;
    
    if (updateTimeouts.has(batchId)) {
      clearTimeout(updateTimeouts.get(batchId));
    }
    
    const timeoutId = setTimeout(() => {
      updateTimeouts.delete(batchId);
      saveBatchToDynamoDB(updatedBatch).catch(error => {
        console.error('❌ BatchProvider: Failed to update batch in DynamoDB:', error);
      });
    }, 3000); // Reduced from 5000ms
    
    updateTimeouts.set(batchId, timeoutId);
  }
};

  const createBatch = (batchData) => {
    console.log('🆕 BatchProvider: Creating new batch with data:', batchData);
    
    const newBatch = {
      id: String(Date.now()),
      ...batchData,
      category: String(batchData.category || '--'),
      subCategory: String(batchData.subCategory || '--'),
      name: String(batchData.name || `Batch ${Date.now()}`),
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
      totalItems: 0,
      csvDownloads: 0,
      ebayListingsCreated: 0,
      lastCsvDownload: null,
      lastEbayListingCreated: null,
      salePrice: String(batchData.salePrice || ''),
      sku: String(batchData.sku || ''),
      appState: {
        filesBase64: [],
        rawFiles: [],
        imageGroups: [[]],
        s3ImageGroups: [[]],
        responseData: [],
        groupMetadata: [],
        fieldSelections: {},
        processedGroupIndices: [],
        category: String(batchData.category || '--'),
        subCategory: String(batchData.subCategory || '--'),
        price: String(batchData.salePrice || ''),
        sku: String(batchData.sku || ''),
        categoryID: null,
        isLoading: false,
        isDirty: false,
        totalChunks: 0,
        completedChunks: 0,
        processingGroups: [],
        errorMessages: [],
        uploadStatus: {
          isUploading: false,
          uploadProgress: 0,
          uploadTotal: 0,
          uploadCompleted: 0,
          uploadStage: '',
          currentFileIndex: 0
        },
        processingStatus: {
          isProcessing: false,
          processTotal: 0,
          processCompleted: 0,
          processStage: '',
          currentGroup: 0
        }
      }
    };
    
    console.log('✅ BatchProvider: Created new batch object:', {
      id: newBatch.id,
      name: newBatch.name,
      category: newBatch.category,
      subCategory: newBatch.subCategory,
      status: newBatch.status
    });
    
    dispatch({ type: 'CREATE_BATCH', payload: newBatch });
    
    // Save to DynamoDB (async, don't block UI)
    saveBatchToDynamoDB(newBatch).catch(error => {
      console.error('❌ BatchProvider: Failed to save new batch to DynamoDB:', error);
    });
    
    return newBatch;
  };

 const saveBatchToDynamoDB = async (batch, force = false) => {
  console.log('💾 BatchProvider: Saving batch to DynamoDB:', batch.id, force ? '(forced)' : '');
  try {
    const userId = getUserId();
    if (!userId) {
      console.warn('⚠️ BatchProvider: No user ID, cannot save batch');
      return false;
    }
    
    // Calculate stats for the main record
    const appState = batch.appState || {};
    let totalImages = 0;
    let totalListings = 0;
    
    // Check if this batch has photo assignment data
    const photoAssignmentState = batch.photoAssignmentState;
    if (photoAssignmentState && photoAssignmentState.photoListings) {
      // Photo Assignment mode - count from photoListings
      photoAssignmentState.photoListings.forEach(listing => {
        if (listing.photos && listing.photos.length > 0) {
          totalImages += listing.photos.length;
          totalListings += 1;
        }
      });
    } else {
      // Traditional mode - count from imageGroups
      const imageGroups = appState.imageGroups || [];
      imageGroups.forEach(group => {
        if (Array.isArray(group)) totalImages += group.length;
      });
      if (appState.filesBase64?.length) totalImages += appState.filesBase64.length;
      totalListings = imageGroups.filter(g => g && g.length > 0).length;
    }
    
    const totalProcessed = appState.responseData?.filter(item => item && !item.error).length || 0;
    
    // Prepare items to save
    const itemsToSave = [];
    
    // 1. Main batch item
    const mainItem = {
      userId,
      batchId: String(batch.id),
      itemType: 'batch_main',
      name: batch.name,
      category: batch.category,
      subCategory: batch.subCategory,
      status: batch.status,
      condition: batch.condition,
      purchaseDate: batch.purchaseDate,
      purchasePrice: batch.purchasePrice,
      salePrice: batch.salePrice,
      sku: batch.sku,
      descriptionTemplate: batch.descriptionTemplate,
      batchDescription: batch.batchDescription,
      createdAt: batch.createdAt,
      updatedAt: new Date().toISOString(),
      // Stats
      totalImages,
      totalListings,
      totalProcessed,
      csvDownloads: batch.csvDownloads || 0,
      ebayListingsCreated: batch.ebayListingsCreated || 0,
      lastCsvDownload: batch.lastCsvDownload || null,
      lastEbayListingCreated: batch.lastEbayListingCreated || null,
      // Reference counts
      imageChunks: 0,
      listingChunks: 0,
      hasSettings: false,
      ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
      version: (batch.version || 0) + 1
    };
    
    itemsToSave.push({
      PutRequest: {
        Item: marshall(mainItem)
      }
    });
    
    // 2. Image chunk items - split images into chunks of ~300KB each
    const CHUNK_SIZE_LIMIT = 300000; // 300KB per chunk
    let imageChunkIndex = 0;
    
    // Process image groups
    if (imageGroups.length > 0 || appState.filesBase64?.length > 0) {
      let currentChunk = {
        imageGroups: [],
        s3ImageGroups: [],
        filesBase64: []
      };
      let currentChunkSize = 0;
      
      // Add image groups
      imageGroups.forEach((group, groupIndex) => {
        if (group && group.length > 0) {
          const groupData = {
            images: group,
            s3Urls: appState.s3ImageGroups?.[groupIndex] || []
          };
          const groupSize = JSON.stringify(groupData).length;
          
          if (currentChunkSize + groupSize > CHUNK_SIZE_LIMIT && currentChunk.imageGroups.length > 0) {
            // Save current chunk
            itemsToSave.push({
              PutRequest: {
                Item: marshall({
                  userId,
                  batchId: `${batch.id}#images#${imageChunkIndex}`,
                  itemType: 'image_chunk',
                  chunkIndex: imageChunkIndex,
                  ...currentChunk,
                  ttl: mainItem.ttl
                })
              }
            });
            imageChunkIndex++;
            currentChunk = { imageGroups: [], s3ImageGroups: [], filesBase64: [] };
            currentChunkSize = 0;
          }
          
          currentChunk.imageGroups.push(group);
          currentChunk.s3ImageGroups.push(appState.s3ImageGroups?.[groupIndex] || []);
          currentChunkSize += groupSize;
        }
      });
      
      // Add filesBase64 (pool images)
      if (appState.filesBase64?.length > 0) {
        appState.filesBase64.forEach(file => {
          const fileSize = file.length;
          if (currentChunkSize + fileSize > CHUNK_SIZE_LIMIT && 
              (currentChunk.imageGroups.length > 0 || currentChunk.filesBase64.length > 0)) {
            // Save current chunk
            itemsToSave.push({
              PutRequest: {
                Item: marshall({
                  userId,
                  batchId: `${batch.id}#images#${imageChunkIndex}`,
                  itemType: 'image_chunk',
                  chunkIndex: imageChunkIndex,
                  ...currentChunk,
                  ttl: mainItem.ttl
                })
              }
            });
            imageChunkIndex++;
            currentChunk = { imageGroups: [], s3ImageGroups: [], filesBase64: [] };
            currentChunkSize = 0;
          }
          
          currentChunk.filesBase64.push(file);
          currentChunkSize += fileSize;
        });
      }
      
      // Save last chunk if it has data
      if (currentChunk.imageGroups.length > 0 || currentChunk.filesBase64.length > 0) {
        itemsToSave.push({
          PutRequest: {
            Item: marshall({
              userId,
              batchId: `${batch.id}#images#${imageChunkIndex}`,
              itemType: 'image_chunk',
              chunkIndex: imageChunkIndex,
              ...currentChunk,
              ttl: mainItem.ttl
            })
          }
        });
        imageChunkIndex++;
      }
    }
    
    mainItem.imageChunks = imageChunkIndex;
    
    // 3. Listing chunk items
    let listingChunkIndex = 0;
    if (appState.responseData?.length > 0) {
      const LISTINGS_PER_CHUNK = 50; // Reasonable number of listings per chunk
      
      for (let i = 0; i < appState.responseData.length; i += LISTINGS_PER_CHUNK) {
        const listings = appState.responseData.slice(i, i + LISTINGS_PER_CHUNK);
        const metadata = appState.groupMetadata?.slice(i, i + LISTINGS_PER_CHUNK) || [];
        
        itemsToSave.push({
          PutRequest: {
            Item: marshall({
              userId,
              batchId: `${batch.id}#listings#${listingChunkIndex}`,
              itemType: 'listing_chunk',
              chunkIndex: listingChunkIndex,
              responseData: listings,
              groupMetadata: metadata,
              ttl: mainItem.ttl
            })
          }
        });
        listingChunkIndex++;
      }
    }
    
    mainItem.listingChunks = listingChunkIndex;
    
    // 4. Settings item (if we have settings data)
    if (appState.fieldSelections && Object.keys(appState.fieldSelections).length > 0) {
      itemsToSave.push({
        PutRequest: {
          Item: marshall({
            userId,
            batchId: `${batch.id}#settings`,
            itemType: 'batch_settings',
            fieldSelections: appState.fieldSelections,
            processedGroupIndices: appState.processedGroupIndices || [],
            categoryID: appState.categoryID || null,
            imageRotations: appState.imageRotations || {},
            ttl: mainItem.ttl
          })
        }
      });
      mainItem.hasSettings = true;
    }
    
    // Delete old items first (if updating)
    await deleteOldBatchItems(userId, batch.id);
    
    // Use BatchWriteItem to save all items
    const BATCH_WRITE_LIMIT = 25; // DynamoDB limit
    for (let i = 0; i < itemsToSave.length; i += BATCH_WRITE_LIMIT) {
      const batch = itemsToSave.slice(i, i + BATCH_WRITE_LIMIT);
      const batchWriteParams = {
        RequestItems: {
          'ListEasierBatches': batch
        }
      };
      
      console.log(`💾 BatchProvider: Writing batch ${Math.floor(i/BATCH_WRITE_LIMIT) + 1}/${Math.ceil(itemsToSave.length/BATCH_WRITE_LIMIT)}`);
      const command = new BatchWriteItemCommand(batchWriteParams);
      await dynamoClient.send(command);
    }
    
    console.log('✅ BatchProvider: Batch saved successfully with', itemsToSave.length, 'items');
    console.log('📊 BatchProvider: Stats - Images:', totalImages, 'Listings:', totalListings, 'Chunks:', imageChunkIndex + listingChunkIndex);
    
    // Archive completed batch if it has been used
    if (batch.csvDownloads > 0 || batch.ebayListingsCreated > 0) {
      await archiveCompletedBatch(batch, mainItem);
    }
    
    return true;
  } catch (error) {
    console.error('❌ BatchProvider: Error saving batch to DynamoDB:', error);
    return false;
  }
};

// Delete old batch items when updating
const deleteOldBatchItems = async (userId, batchId) => {
  console.log('🗑️ BatchProvider: Deleting old batch items for:', batchId);
  try {
    // Query all items for this batch
    const queryParams = {
      TableName: 'ListEasierBatches',
      KeyConditionExpression: 'userId = :userId AND begins_with(batchId, :batchId)',
      ExpressionAttributeValues: marshall({
        ':userId': userId,
        ':batchId': String(batchId)
      })
    };
    
    const queryCommand = new QueryCommand(queryParams);
    const response = await dynamoClient.send(queryCommand);
    
    if (response.Items && response.Items.length > 0) {
      // Delete all items in batches
      const deleteRequests = response.Items.map(item => {
        // Items from query are already marshalled, so we just need the key fields
        return {
          DeleteRequest: {
            Key: {
              userId: item.userId,
              batchId: item.batchId
            }
          }
        };
      });
      
      // BatchWrite has a limit of 25 items
      for (let i = 0; i < deleteRequests.length; i += 25) {
        const batch = deleteRequests.slice(i, i + 25);
        const batchWriteParams = {
          RequestItems: {
            'ListEasierBatches': batch
          }
        };
        
        const command = new BatchWriteItemCommand(batchWriteParams);
        await dynamoClient.send(command);
      }
      
      console.log('✅ BatchProvider: Deleted', deleteRequests.length, 'old items');
    }
  } catch (error) {
    console.error('❌ BatchProvider: Error deleting old batch items:', error);
  }
};

// Archive completed batches for historical records
const archiveCompletedBatch = async (batch, mainItem) => {
  console.log('📦 BatchProvider: Archiving completed batch:', batch.id);
  try {
    const archiveItem = {
      userId: mainItem.userId,
      batchId: `archive#${batch.id}#${Date.now()}`,
      itemType: 'batch_archive',
      originalBatchId: batch.id,
      name: batch.name,
      category: batch.category,
      subCategory: batch.subCategory,
      createdAt: batch.createdAt,
      completedAt: new Date().toISOString(),
      totalImages: mainItem.totalImages,
      totalListings: mainItem.totalListings,
      totalProcessed: mainItem.totalProcessed,
      csvDownloads: batch.csvDownloads,
      ebayListingsCreated: batch.ebayListingsCreated,
      lastCsvDownload: batch.lastCsvDownload,
      lastEbayListingCreated: batch.lastEbayListingCreated,
      // Don't set TTL on archives - keep them permanently
    };
    
    const putParams = {
      TableName: 'ListEasierBatches',
      Item: archiveItem
    };
    
    const command = new PutCommand(putParams);
    await docClient.send(command);
    
    console.log('✅ BatchProvider: Batch archived successfully');
  } catch (error) {
    console.error('❌ BatchProvider: Error archiving batch:', error);
  }
};



  const deleteBatch = (batchId) => {
    console.log('🗑️ BatchProvider: Deleting batch:', batchId);
    dispatch({ type: 'DELETE_BATCH', payload: String(batchId) });
    
    deleteBatchFromDynamoDB(String(batchId)).catch(error => {
      console.error('❌ BatchProvider: Failed to delete batch from DynamoDB:', error);
    });
  };

  const deleteBatchFromDynamoDB = async (batchId) => {
    console.log('💾 BatchProvider: Deleting batch from DynamoDB:', batchId);
    try {
      const userId = getUserId();
      if (!userId) {
        console.warn('⚠️ BatchProvider: No user ID, cannot delete batch');
        return false;
      }
      
      // Use the deleteOldBatchItems function which handles multi-item deletion
      await deleteOldBatchItems(userId, batchId);
      
      console.log('✅ BatchProvider: Batch deleted successfully from DynamoDB');
      return true;
    } catch (error) {
      console.error('❌ BatchProvider: Error deleting batch from DynamoDB:', error);
      return false;
    }
  };

  const markCsvDownloaded = (batchId) => {
    console.log('📥 BatchProvider: Marking CSV downloaded for batch:', batchId);
    const batch = state.batches.find(b => b.id === String(batchId));
    if (batch) {
      const updatedBatch = {
        ...batch,
        csvDownloads: (batch.csvDownloads || 0) + 1,
        lastCsvDownload: new Date().toISOString(),
        status: determineBatchStatus(batch, { csvDownloaded: true }),
        updatedAt: new Date().toISOString()
      };
      updateBatch(updatedBatch);
    }
  };

  const markEbayListingsCreated = (batchId, listingsCount = 1) => {
    console.log('🏪 BatchProvider: Marking eBay listings created for batch:', batchId, 'count:', listingsCount);
    const batch = state.batches.find(b => b.id === String(batchId));
    if (batch) {
      const updatedBatch = {
        ...batch,
        ebayListingsCreated: (batch.ebayListingsCreated || 0) + listingsCount,
        lastEbayListingCreated: new Date().toISOString(),
        status: determineBatchStatus(batch, { ebayListingsCreated: listingsCount }),
        updatedAt: new Date().toISOString()
      };
      updateBatch(updatedBatch);
    }
  };

  const determineBatchStatus = (batch, newActivity = {}) => {
    const hasValidListings = batch.appState?.responseData?.some(item => item && !item.error) || false;
    const totalValidListings = batch.appState?.responseData?.filter(item => item && !item.error).length || 0;
    
    if (!hasValidListings || totalValidListings === 0) {
      return 'draft';
    }

    const totalCsvDownloads = (batch.csvDownloads || 0) + (newActivity.csvDownloaded ? 1 : 0);
    const totalEbayListings = (batch.ebayListingsCreated || 0) + (newActivity.ebayListingsCreated || 0);
    
    if (totalCsvDownloads > 0 || totalEbayListings > 0) {
      return 'completed';
    }

    return 'ready';
  };

  // Template management functions
  const createTemplate = (templateData) => {
    console.log('📝 BatchProvider: Creating template:', templateData.name);
    const newTemplate = {
      id: String(Date.now()),
      ...templateData,
      name: String(templateData.name || 'Untitled Template'),
      createdAt: new Date().toISOString()
    };
    
    dispatch({ type: 'ADD_TEMPLATE', payload: newTemplate });
    
    saveTemplateToDynamoDB(newTemplate).catch(error => {
      console.error('❌ BatchProvider: Failed to save template to DynamoDB:', error);
    });
    
    return newTemplate;
  };

  const saveTemplateToDynamoDB = async (template) => {
    console.log('💾 BatchProvider: Saving template to DynamoDB:', template.id);
    try {
      const userId = getUserId();
      if (!userId) {
        console.warn('⚠️ BatchProvider: No user ID, cannot save template');
        return false;
      }
      
      const item = {
        userId, // Use userId instead of sessionId
        batchId: `template_${template.id}`,
        ...template,
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
      };

      const command = new PutCommand({
        TableName: 'ListEasierBatches',
        Item: item
      });

      await docClient.send(command);
      console.log('✅ BatchProvider: Template saved successfully to DynamoDB');
      return true;
    } catch (error) {
      console.error('❌ BatchProvider: Error saving template to DynamoDB:', error);
      return false;
    }
  };

  const updateTemplate = (templateData) => {
    console.log('🔄 BatchProvider: Updating template:', templateData.id);
    const updatedTemplate = {
      ...templateData,
      id: String(templateData.id),
      name: String(templateData.name || 'Untitled Template')
    };
    
    dispatch({ type: 'UPDATE_TEMPLATE', payload: updatedTemplate });
    saveTemplateToDynamoDB(updatedTemplate).catch(error => {
      console.error('❌ BatchProvider: Failed to update template in DynamoDB:', error);
    });
  };

  const deleteTemplate = (templateId) => {
    console.log('🗑️ BatchProvider: Deleting template:', templateId);
    dispatch({ type: 'DELETE_TEMPLATE', payload: String(templateId) });
    deleteBatchFromDynamoDB(`template_${templateId}`).catch(error => {
      console.error('❌ BatchProvider: Failed to delete template from DynamoDB:', error);
    });
  };

  const contextValue = {
    ...state,
    dispatch,
    createBatch,
    updateBatch,
    deleteBatch,
    markCsvDownloaded,
    markEbayListingsCreated,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    isLoading,
    user // Provide user context to components
  };

  console.log('🎯 BatchProvider: Context value prepared with batch count:', state.batches.length);

  return (
    <BatchContext.Provider value={contextValue}>
      {children}
    </BatchContext.Provider>
  );
}

function useBatch() {
  const context = useContext(BatchContext);
  if (!context) {
    throw new Error('useBatch must be used within a BatchProvider');
  }
  return context;
}

// WYSIWYG Editor Component
function WYSIWYGEditor({ value, onChange, placeholder = "Enter description..." }) {
  const editorRef = React.useRef(null);

  const handleCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleInput = () => {
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  return (
    <div className="wysiwyg-container">
      <div className="wysiwyg-toolbar">
        <button 
          type="button"
          onClick={() => handleCommand('bold')}
          className="toolbar-btn"
          title="Bold"
        >
          <strong>B</strong>
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('italic')}
          className="toolbar-btn"
          title="Italic"
        >
          <em>I</em>
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('underline')}
          className="toolbar-btn"
          title="Underline"
        >
          <u>U</u>
        </button>
        <div className="toolbar-separator"></div>
        <button 
          type="button"
          onClick={() => handleCommand('insertUnorderedList')}
          className="toolbar-btn"
          title="Bullet List"
        >
          •
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('insertOrderedList')}
          className="toolbar-btn"
          title="Numbered List"
        >
          1.
        </button>
        <div className="toolbar-separator"></div>
        <button 
          type="button"
          onClick={() => handleCommand('removeFormat')}
          className="toolbar-btn"
          title="Clear Formatting"
        >
          ✕
        </button>
      </div>
      <div
        ref={editorRef}
        className="wysiwyg-editor"
        contentEditable
        onInput={handleInput}
        style={{
          minHeight: '120px',
          padding: '12px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#fff',
          color: '#000'
        }}
        data-placeholder={placeholder}
      />
    </div>
  );
}

// Template Management Modal
function TemplateModal({ isOpen, onClose, template, category, subCategory }) {
  const { createTemplate, updateTemplate } = useBatch();
  const [formData, setFormData] = useState({
    name: '',
    content: '',
    category: category || '',
    subCategory: subCategory || ''
  });

  useEffect(() => {
    if (template) {
      setFormData(template);
    } else {
      setFormData({
        name: '',
        content: '',
        category: category || '',
        subCategory: subCategory || ''
      });
    }
  }, [template, category, subCategory]);

  const handleSave = () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      alert('Please fill in all required fields');
      return;
    }

    if (template) {
      updateTemplate(formData);
    } else {
      createTemplate(formData);
    }
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="modal-header">
          <h3>{template ? 'Edit Template' : 'Create Template'}</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Template Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="Enter template name"
              className="form-control"
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
                placeholder="Category"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>SubCategory</label>
              <input
                type="text"
                value={formData.subCategory}
                onChange={(e) => setFormData({...formData, subCategory: e.target.value})}
                placeholder="SubCategory"
                className="form-control"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Template Content *</label>
            <WYSIWYGEditor
              value={formData.content}
              onChange={(content) => setFormData({...formData, content})}
              placeholder="Create your description template..."
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">
            {template ? 'Update' : 'Create'} Template
          </button>
        </div>
      </div>
    </div>
  );
}

// Delete Confirmation Modal
function DeleteBatchModal({ isOpen, onClose, onConfirm, batchName }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '500px', width: '90%' }}>
        <div className="modal-header">
          <h3>Delete Batch</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        
        <div className="modal-body">
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h4 style={{ color: '#dc3545', marginBottom: '1rem' }}>
              Are you sure you want to delete this batch?
            </h4>
            <p style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
              <strong>"{batchName}"</strong>
            </p>
            <p style={{ color: '#666', marginBottom: '0' }}>
              This action cannot be undone. All data associated with this batch will be permanently deleted from the system.
            </p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button 
            onClick={onConfirm} 
            className="btn"
            style={{
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none'
            }}
          >
            Delete Batch
          </button>
        </div>
      </div>
    </div>
  );
}

// Updated Sidebar Component with user info
function Sidebar() {
  const { batches, dispatch, statusFilter, sidebarCollapsed, viewMode, user } = useBatch();
  const { logout } = useAuth0();
  
  const getFilterCounts = () => {
    const open = batches.filter(batch => 
      batch.status === 'draft' || batch.status === 'ready' || batch.status === 'error'
    ).length;
    const closed = batches.filter(batch => batch.status === 'completed').length;
    
    return { all: batches.length, open, closed };
  };

  const filterCounts = getFilterCounts();

  const handleFilterChange = (newFilter) => {
    dispatch({ type: 'SET_STATUS_FILTER', payload: newFilter });
    if (viewMode !== 'overview') {
      dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
    }
  };

  const handleCreateBatch = () => {
    dispatch({ type: 'SET_VIEW_MODE', payload: 'create' });
  };

  const handleLogout = () => {
    logout({
      logoutParams: {
        returnTo: window.location.origin
      }
    });
  };

  return (
    <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-brand">
        <img 
          src="/ListEasier.png" 
          alt="ListEasier Logo" 
          className="brand-logo-only"
        />
      </div>

      {/* User Info */}
      {!sidebarCollapsed && user && (
        <div className="user-info">
          <div className="user-avatar">
            {user.picture ? (
              <img src={user.picture} alt={user.name} />
            ) : (
              <div className="avatar-placeholder">
                {(user.name || user.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="user-details">
            <div className="user-name">{user.name || 'User'}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button onClick={handleLogout} className="logout-button" title="Logout">
            🚪
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Overview Section */}
        <div className="nav-section">
          <div className="nav-section-header">
            {!sidebarCollapsed && <span>Overview</span>}
          </div>
          <ul className="nav-list">
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => handleFilterChange('all')}
                title="All Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>All Batches</span>
                    <span className="nav-badge">{filterCounts.all}</span>
                  </>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'open' ? 'active' : ''}`}
                onClick={() => handleFilterChange('open')}
                title="Open Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>Open</span>
                    <span className="nav-badge">{filterCounts.open}</span>
                  </>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'closed' ? 'active' : ''}`}
                onClick={() => handleFilterChange('closed')}
                title="Completed Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>Completed</span>
                    <span className="nav-badge">{filterCounts.closed}</span>
                  </>
                )}
              </button>
            </li>
          </ul>
        </div>

        {/* Actions Section */}
        <div className="nav-section">
          <div className="nav-section-header">
            {!sidebarCollapsed && <span>Actions</span>}
          </div>
          <ul className="nav-list">
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'create' ? 'active' : ''}`}
                onClick={handleCreateBatch}
                title="Create New Batch"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                {!sidebarCollapsed && <span>New Batch</span>}
              </button>
            </li>
          </ul>
        </div>

        {/* Recent Batches */}
        {!sidebarCollapsed && batches.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-header">
              <span>Recent Batches</span>
            </div>
            <ul className="nav-list">
              {batches.slice(0, 5).map(batch => (
                <li key={batch.id} className="nav-item">
                  <button 
                    className="nav-link batch-link"
                    onClick={() => dispatch({ type: 'SET_CURRENT_BATCH', payload: batch })}
                    title={batch.name}
                  >
                    <div className="batch-thumbnail">
                      {batch.category && batch.category.charAt(0)}
                    </div>
                    <div className="batch-info">
                      <span className="batch-name">{batch.name}</span>
                      <span className={`batch-status status-${batch.status}`}>
                        {batch.status}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Logout button for collapsed sidebar */}
        {sidebarCollapsed && user && (
          <div className="nav-section">
            <ul className="nav-list">
              <li className="nav-item">
                <button 
                  onClick={handleLogout}
                  className="nav-link"
                  title="Logout"
                >
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                  </svg>
                </button>
              </li>
            </ul>
          </div>
        )}
      </nav>
    </div>
  );
}

// Main Header Component
function MainHeader() {
  const { dispatch, sidebarCollapsed, viewMode, currentBatch } = useBatch();

  const toggleSidebar = () => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  };

  const getPageTitle = () => {
    if (viewMode === 'create') return 'Create New Batch';
    if (viewMode === 'edit' && currentBatch) return currentBatch.name;
    return 'Your Batches';
  };

  return (
    <header className="main-header">
      <div className="header-left">
        <button 
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
        <h1 className="page-title">{getPageTitle()}</h1>
      </div>
      <div className="header-right">
        {viewMode === 'overview' && (
          <button 
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'create' })}
            className="btn btn-primary"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.9rem',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span>+</span> Create Batch
          </button>
        )}
      </div>
    </header>
  );
}

// Batch Overview Component
function BatchOverview() {
  const { batches, dispatch, deleteBatch, statusFilter, isLoading } = useBatch();
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, batch: null });

  console.log('🎨 BatchOverview: Rendering with data:', {
    batchCount: batches?.length || 0,
    statusFilter,
    isLoading,
    batchesType: typeof batches,
    batchesIsArray: Array.isArray(batches)
  });

  const getStatusColor = (status) => {
    const colors = {
      'draft': '#6c757d',
      'ready': '#007bff',
      'completed': '#28a745',
      'error': '#dc3545'
    };
    return colors[status] || '#6c757d';
  };

  const getStatusLabel = (status) => {
    const labels = {
      'draft': 'Draft',
      'ready': 'Ready',
      'completed': 'Completed',
      'error': 'Error'
    };
    return labels[status] || String(status || 'Unknown');
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('❌ BatchOverview: Error formatting date:', error);
      return 'Invalid Date';
    }
  };

  const handleEditBatch = (batch) => {
    console.log('✏️ BatchOverview: Editing batch:', batch);
    if (!batch || !batch.id) {
      console.error('❌ BatchOverview: Invalid batch for editing:', batch);
      return;
    }
    dispatch({ type: 'SET_CURRENT_BATCH', payload: batch });
  };

  const handleDeleteBatch = (batch) => {
    console.log('🗑️ BatchOverview: Delete requested for batch:', batch);
    setDeleteModal({ isOpen: true, batch });
  };

  const confirmDeleteBatch = () => {
    console.log('✅ BatchOverview: Confirming delete for batch:', deleteModal.batch);
    if (deleteModal.batch && deleteModal.batch.id) {
      deleteBatch(deleteModal.batch.id);
      setDeleteModal({ isOpen: false, batch: null });
    }
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, batch: null });
  };

  const getBatchStats = (batch) => {
    const appState = batch?.appState || {};
    
    // Calculate total images across all groups
    let totalImages = 0;
    if (appState.imageGroups) {
      appState.imageGroups.forEach(group => {
        if (Array.isArray(group)) {
          totalImages += group.length;
        }
      });
    }
    
    // Add images from the pool (filesBase64)
    if (appState.filesBase64 && Array.isArray(appState.filesBase64)) {
      totalImages += appState.filesBase64.length;
    }
    
    return {
      totalListings: appState.imageGroups?.filter(g => g && g.length > 0).length || 0,
      totalImages: totalImages,
      generatedListings: appState.responseData?.filter(item => item && !item.error).length || 0
    };
  };

  const getFilteredBatches = () => {
    if (!Array.isArray(batches)) {
      console.warn('⚠️ BatchOverview: Batches is not an array:', typeof batches, batches);
      return [];
    }

    let filtered;
    if (statusFilter === 'all') {
      filtered = batches;
    } else if (statusFilter === 'open') {
      filtered = batches.filter(batch => 
        batch.status === 'draft' || batch.status === 'ready' || batch.status === 'error'
      );
    } else if (statusFilter === 'closed') {
      filtered = batches.filter(batch => batch.status === 'completed');
    } else {
      filtered = batches;
    }
    
    return filtered;
  };

  const filteredBatches = getFilteredBatches();

  if (isLoading) {
    return (
      <div className="batch-overview-content">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          height: '200px',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div className="spinner">
            <div className="spinner-circle"></div>
          </div>
          <p>Loading your batches...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="batch-overview-content">
      {/* Batch legend */}
      <div className="batch-legend" style={{
        background: '#f8f9fa',
        border: '1px solid #e9ecef',
        borderRadius: '8px',
        padding: '15px',
        marginBottom: '20px',
        fontSize: '0.9rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#333', fontSize: '1rem' }}>
              Batch Preview:
            </h4>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>🖼️</span>
                <span style={{ color: '#333' }}>Total Images</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>📋</span>
                <span style={{ color: '#333' }}>Total Listings (Image Groups)</span>
              </div>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#333', fontSize: '1rem' }}>
              Batch Status:
            </h4>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#6c757d', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Draft - In progress</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#007bff', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Ready - Available for use</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#28a745', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Completed - CSV downloaded or eBay listings created</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="batch-table">
        <div className="table-header">
          <div className="th">Batch Name</div>
          <div className="th">Status</div>
          <div className="th">Batch Preview</div>
          <div className="th">Date Created</div>
          <div className="th">Actions</div>
        </div>

        {filteredBatches.length === 0 ? (
          <div className="empty-state">
            <h3>
              {statusFilter === 'all' ? 'No batches yet' : 
               statusFilter === 'open' ? 'No open batches' : 
               'No closed batches'}
            </h3>
            <p>
              {statusFilter === 'all' ? 'Create your first batch to get started' :
               statusFilter === 'open' ? 'All your batches have been completed' :
               'No batches have been completed yet'}
            </p>
            {statusFilter === 'all' && (
              <button 
                onClick={() => {
                  dispatch({ type: 'SET_VIEW_MODE', payload: 'create' });
                }}
                className="btn btn-primary"
              >
                Create Batch
              </button>
            )}
          </div>
        ) : (
          filteredBatches.map((batch, index) => {
            if (!batch) {
              console.error('❌ BatchOverview: Null batch at index', index);
              return null;
            }

            const stats = getBatchStats(batch);
            const batchName = String(batch.name || `Batch ${batch.id || 'Unknown'}`);
            const batchCategory = String(batch.category || 'No Category');
            const batchSubCategory = String(batch.subCategory || 'No SubCategory');
            const batchStatus = String(batch.status || 'draft');
            const batchId = String(batch.id || Date.now());
            
            return (
              <div key={batchId} className="table-row">
                <div className="td">
                  <div className="batch-name-cell">
                    <div className="batch-thumbnail">
                      {batchCategory && batchCategory !== 'No Category' ? batchCategory.charAt(0) : 'B'}
                    </div>
                    <div>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                        {batchName}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#666' }}>
                        {batchCategory} / {batchSubCategory}
                      </div>
                      {batchStatus === 'completed' && (
                        <div style={{ fontSize: '0.75rem', color: '#28a745', marginTop: '2px' }}>
                          {batch.csvDownloads > 0 && `${batch.csvDownloads} CSV download${batch.csvDownloads > 1 ? 's' : ''}`}
                          {batch.csvDownloads > 0 && batch.ebayListingsCreated > 0 && ' • '}
                          {batch.ebayListingsCreated > 0 && `${batch.ebayListingsCreated} eBay listing${batch.ebayListingsCreated > 1 ? 's' : ''}`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="td">
                  <span 
                    className="status-badge" 
                    style={{ backgroundColor: getStatusColor(batchStatus) }}
                  >
                    {getStatusLabel(batchStatus)}
                  </span>
                </div>
                <div className="td">
                  <div className="batch-preview">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="preview-icon" title="Total Images">🖼️</span> 
                      <span>{stats.totalImages}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="preview-icon" title="Total Listings">📋</span> 
                      <span>{stats.totalListings}</span>
                    </div>
                  </div>
                </div>
                <div className="td">
                  <div>{formatDate(batch.createdAt)}</div>
                  {batch.updatedAt !== batch.createdAt && (
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Updated: {formatDate(batch.updatedAt)}
                    </div>
                  )}
                </div>
                <div className="td">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={() => handleEditBatch(batch)}
                      className="btn btn-sm btn-outline"
                    >
                      Open
                    </button>
                    <button 
                      onClick={() => handleDeleteBatch(batch)}
                      className="btn btn-sm"
                      style={{
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none'
                      }}
                      title="Delete batch"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <DeleteBatchModal
        isOpen={deleteModal.isOpen}
        onClose={closeDeleteModal}
        onConfirm={confirmDeleteBatch}
        batchName={deleteModal.batch?.name || ''}
      />
    </div>
  );
}

// Batch Wizard Component
function BatchWizard() {
  const { createBatch, templates, dispatch } = useBatch();
  const { dispatch: appDispatch } = useAppState();
  const [currentStep, setCurrentStep] = useState(0);
  const [batchData, setBatchData] = useState({
    name: '',
    category: '--',
    subCategory: '--',
    descriptionTemplate: 'ai_generate',
    condition: 'NEW',
    purchaseDate: '',
    purchasePrice: '',
    salePrice: '',
    sku: '',
    batchDescription: ''
  });

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  
  // Use global categories from context
  const { categories, categoriesLoading } = useCategories();

  const subcategories = categories[batchData.category] || ['--'];

  // Auto-select first subcategory when category changes
  useEffect(() => {
    if (batchData.category !== '--' && categories[batchData.category]) {
      const availableSubcategories = categories[batchData.category];
      if (availableSubcategories.length > 0 && availableSubcategories[0] !== '--') {
        setBatchData(prev => ({
          ...prev,
          subCategory: availableSubcategories[0]
        }));
      } else if (availableSubcategories.length > 1) {
        setBatchData(prev => ({
          ...prev,
          subCategory: availableSubcategories[1]
        }));
      }
    }
  }, [batchData.category, categories]);

  const filteredTemplates = templates.filter(template => 
    (!template.category || template.category === batchData.category) &&
    (!template.subCategory || template.subCategory === batchData.subCategory)
  );

  const handleNext = () => {
    if (currentStep < 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Clear app state before creating new batch
      console.log('🧹 BatchWizard: Clearing app state for new batch');
      appDispatch({ type: 'CLEAR_ALL_FOR_NEW_BATCH' });
      
      // Save batch and switch to edit mode - ensure all fields are strings
      const sanitizedBatchData = {
        ...batchData,
        name: String(batchData.name || ''),
        category: String(batchData.category || '--'),
        subCategory: String(batchData.subCategory || '--'),
        salePrice: String(batchData.salePrice || ''),
        sku: String(batchData.sku || ''),
        batchDescription: String(batchData.batchDescription || '')
      };
      
      const newBatch = createBatch(sanitizedBatchData);
      dispatch({ type: 'SET_CURRENT_BATCH', payload: newBatch });
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = () => {
    // Clear app state when canceling
    console.log('🧹 BatchWizard: Clearing app state on cancel');
    appDispatch({ type: 'CLEAR_ALL_FOR_NEW_BATCH' });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        const hasName = batchData.name && batchData.name.trim().length > 0;
        const hasCategory = batchData.category && batchData.category !== '--';
        const hasSubCategory = batchData.subCategory && batchData.subCategory !== '--';
        
        return hasName && hasCategory && hasSubCategory;
      case 1:
        return true; // Optional step
      default:
        return false;
    }
  };

  return (
    <div className="batch-wizard-content">
      <div className="wizard-card">
        <div className="wizard-header">
          <h2>Create a new batch</h2>
          <button onClick={handleCancel} className="modal-close">×</button>
        </div>

        <div className="wizard-steps">
          <div className={`step ${currentStep >= 0 ? 'active' : ''} ${currentStep > 0 ? 'completed' : ''}`}>
            <span className="step-number">1</span>
            <span>General Settings</span>
          </div>
          <div className={`step ${currentStep >= 1 ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <span>Additional Details</span>
          </div>
        </div>

        <div className="wizard-content">
          {currentStep === 0 && (
            <div className="step-content">
              <h3>General Settings</h3>
              
              <div className="form-group">
                <label>Batch Name *</label>
                <input
                  type="text"
                  value={batchData.name}
                  onChange={(e) => setBatchData({...batchData, name: e.target.value})}
                  placeholder="Enter batch name"
                  className="form-control"
                  style={{
                    borderColor: batchData.name.trim() ? '#28a745' : '#ccc'
                  }}
                />
                {!batchData.name.trim() && (
                  <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                    Batch name is required
                  </small>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  {categoriesLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="spinner">
                        <div className="spinner-circle"></div>
                      </div>
                      <span>Loading categories...</span>
                    </div>
                  ) : (
                    <>
                      <select
                        value={batchData.category}
                        onChange={(e) => {
                          const newCategory = e.target.value;
                          setBatchData({
                            ...batchData, 
                            category: newCategory,
                            subCategory: '--'
                          });
                        }}
                        className="form-control"
                        style={{
                          borderColor: batchData.category !== '--' ? '#28a745' : '#ccc'
                        }}
                      >
                        {Object.keys(categories).map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      {batchData.category === '--' && (
                        <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                          Please select a category
                        </small>
                      )}
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>SubCategory *</label>
                  <select
                    value={batchData.subCategory}
                    onChange={(e) => {
                      const newSubCategory = e.target.value;
                      setBatchData({
                        ...batchData, 
                        subCategory: newSubCategory
                      });
                    }}
                    className="form-control"
                    disabled={categoriesLoading || batchData.category === '--'}
                    style={{
                      borderColor: batchData.subCategory !== '--' ? '#28a745' : '#ccc'
                    }}
                  >
                    {subcategories.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                  {batchData.subCategory === '--' && batchData.category !== '--' && (
                    <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                      Please select a subcategory
                    </small>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>Description Template</label>
                <select
                  value={batchData.descriptionTemplate}
                  onChange={(e) => setBatchData({...batchData, descriptionTemplate: e.target.value})}
                  className="form-control"
                >
                  <option value="ai_generate">Let AI Generate Description</option>
                  {filteredTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button 
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="btn btn-sm btn-outline mt-2"
                >
                  + Create New Template
                </button>
              </div>

              {/* Validation Summary */}
              <div style={{ 
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                border: '1px solid #e9ecef'
              }}>
                <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#495057' }}>
                  Required Fields:
                </h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.name.trim() ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.name.trim() ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>Batch Name</span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.category !== '--' ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.category !== '--' ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>Category</span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.subCategory !== '--' ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.subCategory !== '--' ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>SubCategory</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="step-content">
              <h3>Additional Bulk Settings</h3>
              <p>Attributes selected below will be applied to all items added in your batch. Don't worry, you can always make changes later.</p>

              <div className="form-row">
                <div className="form-group">
                  <label>Condition</label>
                  <select
                    value={batchData.condition}
                    onChange={(e) => setBatchData({...batchData, condition: e.target.value})}
                    className="form-control"
                  >
                    <option value="NEW">New</option>
                    <option value="USED_EXCELLENT">Used - Excellent</option>
                    <option value="USED_GOOD">Used - Good</option>
                    <option value="USED_FAIR">Used - Fair</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={batchData.purchaseDate}
                    onChange={(e) => setBatchData({...batchData, purchaseDate: e.target.value})}
                    className="form-control"
                  />
                </div>
              </div>

              <div className="form-row price-row">
                <div className="form-group">
                  <label>Purchase Price</label>
                  <div className="input-group">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={batchData.purchasePrice}
                      onChange={(e) => setBatchData({...batchData, purchasePrice: e.target.value})}
                      placeholder="0.00"
                      className="form-control"
                      style={{ paddingLeft: '2rem' }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Sale Price</label>
                  <div className="input-group">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={batchData.salePrice}
                      onChange={(e) => setBatchData({...batchData, salePrice: e.target.value})}
                      placeholder="0.00"
                      className="form-control"
                      style={{ paddingLeft: '2rem' }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>Default SKU</label>
                <input
                  type="text"
                  value={batchData.sku}
                  onChange={(e) => setBatchData({...batchData, sku: e.target.value})}
                  placeholder="Enter default SKU for this batch"
                  className="form-control"
                />
                <small style={{ color: '#666', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
                  This will be the default SKU for all items in this batch. You can modify individual SKUs later.
                </small>
              </div>

              <div className="form-group">
                <label>Batch Description</label>
                <textarea
                  value={batchData.batchDescription}
                  onChange={(e) => setBatchData({...batchData, batchDescription: e.target.value})}
                  placeholder="Optional description for this batch"
                  className="form-control"
                  rows="4"
                />
              </div>
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <button 
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="btn btn-secondary"
          >
            Previous
          </button>
          <button 
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn btn-primary"
          >
            {currentStep === 1 ? 'Create Batch' : 'Continue'}
          </button>
        </div>
      </div>

      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        category={batchData.category}
        subCategory={batchData.subCategory}
      />
    </div>
  );
}

// Batch Editor Component
function BatchEditor() {
  const { currentBatch, updateBatch, dispatch, markCsvDownloaded, markEbayListingsCreated } = useBatch();
  const [showListingManager, setShowListingManager] = useState(false);
  const { state, dispatch: appDispatch } = useAppState();
  
  // Photo assignment interface states
  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [photoListings, setPhotoListings] = useState([]);
  const [autoAssignCount, setAutoAssignCount] = useState(4);
  const [draggedPhoto, setDraggedPhoto] = useState(null);
  const [draggedFromListing, setDraggedFromListing] = useState(null);
  const [currentSku, setCurrentSku] = useState('');
  const [showSkuDialog, setShowSkuDialog] = useState(false);
  const [viewMode, setViewMode] = useState('assignment'); // 'traditional', 'assignment', or 'review'
  const [showPhotoReview, setShowPhotoReview] = useState(false);
  const [aiResolveCategoryFields, setAiResolveCategoryFields] = useState(false);
  const [categoryFields, setCategoryFields] = useState([]);
  const [generatedListings, setGeneratedListings] = useState([]);
  const fileInputRef = useRef(null);
  
  // Existing BatchEditor states and refs
  const updateTimeoutRef = useRef(null);
  const lastUpdateRef = useRef(null);
  const lastSaveTimeRef = useRef(0);
  const SAVE_THROTTLE_MS = 10000;

  // Initialize current SKU from batch data
  useEffect(() => {
    if (currentBatch && !currentSku) {
      setCurrentSku(currentBatch.sku || currentBatch.appState?.sku || '');
    }
  }, [currentBatch, currentSku]);

  // Load batch state into app state when component mounts or batch changes
  useEffect(() => {
    if (currentBatch && currentBatch.appState) {
      console.log('🔄 BatchEditor: Loading batch state from:', currentBatch.name);
      
      // Load the entire appState from the saved batch
      appDispatch({ type: 'LOAD_BATCH_STATE', payload: currentBatch.appState });
    }
    
    // Restore photo assignment state if it exists
    if (currentBatch && currentBatch.photoAssignmentState) {
      console.log('🔄 BatchEditor: Restoring photo assignment state');
      const { 
        uploadedPhotos: savedUploadedPhotos, 
        photoListings: savedPhotoListings,
        viewMode: savedViewMode,
        showPhotoReview: savedShowPhotoReview,
        currentSku: savedCurrentSku,
        aiResolveCategoryFields: savedAiResolveCategoryFields,
        generatedListings: savedGeneratedListings
      } = currentBatch.photoAssignmentState;
      
      if (savedUploadedPhotos) setUploadedPhotos(savedUploadedPhotos);
      if (savedPhotoListings) setPhotoListings(savedPhotoListings);
      if (savedCurrentSku) setCurrentSku(savedCurrentSku);
      if (savedAiResolveCategoryFields !== undefined) setAiResolveCategoryFields(savedAiResolveCategoryFields);
      if (savedGeneratedListings) setGeneratedListings(savedGeneratedListings);
      
      // Restore the view mode to where the user left off
      if (currentBatch.lastViewMode === 'review') {
        setViewMode('assignment');
        setShowPhotoReview(true);
      } else if (savedViewMode) {
        setViewMode(savedViewMode);
        setShowPhotoReview(false);
      }
    }
  }, [currentBatch?.id]); // Only run when batch ID changes

  // Load batch state into app state
 useEffect(() => {
  if (currentBatch) {
    const hasValidListings = state.responseData.some(item => item && !item.error);
    
    let newStatus = currentBatch.status;
    if (hasValidListings && currentBatch.status === 'draft') {
      newStatus = 'ready';
    }
    
    const safeStringConvert = (value, defaultValue = '') => {
      if (value === null || value === undefined) return defaultValue;
      if (typeof value === 'string') return value;
      if (typeof value === 'object') {
        console.warn('⚠️ BatchEditor: Converting object to string in update:', value);
        return defaultValue;
      }
      return String(value);
    };
    
    const updatedBatch = {
      ...currentBatch,
      appState: {
        ...state, // Use entire state instead of cherry-picking
        // Ensure strings are properly converted
        category: safeStringConvert(state.category),
        subCategory: safeStringConvert(state.subCategory),
        price: safeStringConvert(state.price),
        sku: safeStringConvert(state.sku)
      },
      totalItems: state.responseData.filter(item => item && !item.error).length,
      status: newStatus,
      salePrice: safeStringConvert(state.price || currentBatch.salePrice),
      sku: safeStringConvert(state.sku || currentBatch.sku)
    };
    
    const currentDataString = JSON.stringify({
      appState: updatedBatch.appState,
      totalItems: updatedBatch.totalItems,
      status: updatedBatch.status,
      salePrice: updatedBatch.salePrice,
      sku: updatedBatch.sku
    });
    
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    
    // FIXED: Always save when listings are generated or significant changes occur
    const hasSignificantChange = (
      updatedBatch.totalItems !== currentBatch.totalItems ||
      updatedBatch.status !== currentBatch.status ||
      (state.responseData.length > 0 && state.responseData.some(item => item && !item.error)) ||
      state.imageGroups.some(group => group && group.length > 0) // Save when images are present
    );
    
    if (lastUpdateRef.current !== currentDataString) {
      lastUpdateRef.current = currentDataString;
      
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      // FIXED: Use shorter delay for significant changes, immediate save for new listings
      const delay = hasSignificantChange ? 500 : 3000; // Reduced delay
      
      updateTimeoutRef.current = setTimeout(() => {
        console.log('💾 BatchEditor: Saving batch update - significant change:', hasSignificantChange);
        lastSaveTimeRef.current = Date.now();
        updateBatch(updatedBatch);
      }, delay);
    }
  }
  
  return () => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
  };
}, [state, currentBatch, updateBatch]); // Watch entire state, not just selected fields

  // Save photo assignment state when it changes
  useEffect(() => {
    if (currentBatch && (uploadedPhotos.length > 0 || photoListings.length > 0 || generatedListings.length > 0)) {
      const photoAssignmentState = {
        uploadedPhotos,
        photoListings,
        viewMode,
        showPhotoReview,
        currentSku,
        aiResolveCategoryFields,
        generatedListings
      };
      
      // Update batch with photo assignment state
      const updatedBatch = {
        ...currentBatch,
        photoAssignmentState,
        lastViewMode: showPhotoReview ? 'review' : viewMode
      };
      
      // Debounce the update
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      
      updateTimeoutRef.current = setTimeout(() => {
        console.log('💾 BatchEditor: Saving photo assignment state');
        updateBatch(updatedBatch);
      }, 1000);
    }
  }, [uploadedPhotos, photoListings, viewMode, showPhotoReview, currentSku, aiResolveCategoryFields, generatedListings, currentBatch]);

  // Throttled batch update logic
  useEffect(() => {
    if (currentBatch) {
      const hasValidListings = state.responseData.some(item => item && !item.error);
      
      let newStatus = currentBatch.status;
      if (hasValidListings && currentBatch.status === 'draft') {
        newStatus = 'ready';
      }
      
      const safeStringConvert = (value, defaultValue = '') => {
        if (value === null || value === undefined) return defaultValue;
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
          console.warn('⚠️ BatchEditor: Converting object to string in update:', value);
          return defaultValue;
        }
        return String(value);
      };
      
      const updatedBatch = {
        ...currentBatch,
        appState: {
          filesBase64: state.filesBase64,
          rawFiles: state.rawFiles,
          imageGroups: state.imageGroups,
          s3ImageGroups: state.s3ImageGroups,
          responseData: state.responseData,
          groupMetadata: state.groupMetadata,
          fieldSelections: state.fieldSelections,
          processedGroupIndices: state.processedGroupIndices,
          category: safeStringConvert(state.category),
          subCategory: safeStringConvert(state.subCategory),
          price: safeStringConvert(state.price),
          sku: safeStringConvert(state.sku),
          categoryID: state.categoryID,
          // Also preserve state-level data
          imageRotations: state.imageRotations || {},
          selectedImages: state.selectedImages || [],
          totalChunks: state.totalChunks || 0,
          completedChunks: state.completedChunks || 0,
          processingGroups: state.processingGroups || [],
          errorMessages: state.errorMessages || []
        },
        totalItems: state.responseData.filter(item => item && !item.error).length,
        status: newStatus,
        salePrice: safeStringConvert(state.price || currentBatch.salePrice),
        sku: safeStringConvert(state.sku || currentBatch.sku)
      };
      
      const currentDataString = JSON.stringify({
        appState: updatedBatch.appState,
        totalItems: updatedBatch.totalItems,
        status: updatedBatch.status,
        salePrice: updatedBatch.salePrice,
        sku: updatedBatch.sku
      });
      
      const now = Date.now();
      const timeSinceLastSave = now - lastSaveTimeRef.current;
      
      if (lastUpdateRef.current !== currentDataString && timeSinceLastSave >= SAVE_THROTTLE_MS) {
        lastUpdateRef.current = currentDataString;
        
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }
        
        const hasSignificantChange = (
          updatedBatch.totalItems !== currentBatch.totalItems ||
          updatedBatch.status !== currentBatch.status ||
          (state.responseData.length > 0 && state.responseData.some(item => item && !item.error))
        );
        
        const delay = hasSignificantChange ? 1000 : 5000;
        
        updateTimeoutRef.current = setTimeout(() => {
          console.log('💾 BatchEditor: Saving batch update after throttle delay');
          lastSaveTimeRef.current = Date.now();
          updateBatch(updatedBatch);
        }, delay);
      } else if (lastUpdateRef.current !== currentDataString) {
        lastUpdateRef.current = currentDataString;
        
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }
        
        const remainingThrottleTime = SAVE_THROTTLE_MS - timeSinceLastSave;
        updateTimeoutRef.current = setTimeout(() => {
          console.log('💾 BatchEditor: Saving batch update after throttle period');
          lastSaveTimeRef.current = Date.now();
          updateBatch(updatedBatch);
        }, Math.max(remainingThrottleTime, 1000));
      }
    }
    
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [state, currentBatch, updateBatch]);

  // Fetch category fields for Photo Assignment mode
  useEffect(() => {
    const fetchCategoryFields = async () => {
      if (!currentBatch || !currentBatch.category || !currentBatch.subCategory) {
        setCategoryFields([]);
        return;
      }
      
      if (currentBatch.category === '--' || currentBatch.subCategory === '--') {
        setCategoryFields([]);
        return;
      }
      
      try {
        // AWS Configuration (same as FormSection)
        const REGION = "us-east-2";
        const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";
        
        const client = new DynamoDBClient({
          region: REGION,
          credentials: fromCognitoIdentityPool({
            clientConfig: { region: REGION },
            identityPoolId: IDENTITY_POOL_ID,
          }),
        });
        
        // Check cache first
        const cachedFields = cacheService.getCategoryFields(currentBatch.category, currentBatch.subCategory);
        if (cachedFields) {
          setCategoryFields(cachedFields);
          return;
        }
        
        // Fetch from DynamoDB
        const dynamoQuery = {
          TableName: "CategoryFields",
          KeyConditionExpression: "SubCategoryType = :sub",
          ExpressionAttributeValues: {
            ":sub": { S: currentBatch.subCategory }
          },
        };
        
        const command = new QueryCommand(dynamoQuery);
        const response = await client.send(command);
        const items = response.Items?.map(item => unmarshall(item)) || [];
        
        // Cache the result
        cacheService.setCategoryFields(currentBatch.category, currentBatch.subCategory, items);
        setCategoryFields(items);
        
        // Initialize field selections
        const initialSelections = {};
        items.forEach(item => {
          initialSelections[item.FieldLabel] = "";
        });
        dispatch({ type: 'SET_FIELD_SELECTIONS', payload: initialSelections });
        
      } catch (error) {
        console.error('Error fetching category fields for Photo Assignment:', error);
        setCategoryFields([]);
        dispatch({ type: 'SET_FIELD_SELECTIONS', payload: {} });
      }
    };
    
    // Only fetch category fields when in Photo Assignment mode
    if (viewMode === 'assignment' && currentBatch) {
      fetchCategoryFields();
    }
  }, [currentBatch?.category, currentBatch?.subCategory, viewMode, dispatch]);

  // Photo assignment interface methods
  const handleFileUpload = (files) => {
    const newPhotos = Array.from(files).map((file, index) => ({
      id: `photo-${Date.now()}-${index}`,
      file,
      url: URL.createObjectURL(file),
      name: file.name
    }));
    setUploadedPhotos(prev => [...prev, ...newPhotos]);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
  };

  const autoAssignPhotos = () => {
    if (uploadedPhotos.length === 0) return;

    const newListings = [];
    for (let i = 0; i < uploadedPhotos.length; i += autoAssignCount) {
      const photos = uploadedPhotos.slice(i, i + autoAssignCount);
      newListings.push({
        id: `listing-${Date.now()}-${i}`,
        photos: photos,
        sku: currentSku || `${currentBatch?.sku || 'ITEM'}-${photoListings.length + newListings.length + 1}`,
        title: `Auto-generated Listing ${photoListings.length + newListings.length + 1}`,
        isGenerated: false
      });
    }

    setPhotoListings(prev => [...prev, ...newListings]);
    setUploadedPhotos([]);
  };

  const createEmptyListing = () => {
    const newListing = {
      id: `listing-${Date.now()}`,
      photos: [],
      sku: currentSku || `${currentBatch?.sku || 'ITEM'}-${photoListings.length + 1}`,
      title: `Listing ${photoListings.length + 1}`,
      isGenerated: false
    };
    setPhotoListings(prev => [...prev, newListing]);
  };

  const handlePhotoDragStart = (photo, fromListingId = null) => {
    setDraggedPhoto(photo);
    setDraggedFromListing(fromListingId);
  };

  const handleListingDrop = (e, listingId) => {
    e.preventDefault();
    if (!draggedPhoto) return;

    if (draggedFromListing) {
      setPhotoListings(prev => prev.map(listing => 
        listing.id === draggedFromListing 
          ? { ...listing, photos: listing.photos.filter(p => p.id !== draggedPhoto.id) }
          : listing
      ));
    } else {
      setUploadedPhotos(prev => prev.filter(p => p.id !== draggedPhoto.id));
    }

    setPhotoListings(prev => prev.map(listing => 
      listing.id === listingId 
        ? { ...listing, photos: [...listing.photos, draggedPhoto] }
        : listing
    ));

    setDraggedPhoto(null);
    setDraggedFromListing(null);
  };

  const deleteListing = (listingId) => {
    const listing = photoListings.find(l => l.id === listingId);
    if (listing) {
      setUploadedPhotos(prev => [...prev, ...listing.photos]);
      setPhotoListings(prev => prev.filter(l => l.id !== listingId));
    }
  };

  // Convert photo listings to traditional format and integrate with existing system
  const convertPhotoListingsToTraditional = async () => {
    if (photoListings.length === 0) {
      alert("No photo listings to convert");
      return;
    }

    try {
      // Convert photos to base64 and add to existing image groups
      const newImageGroups = [];
      const newFilesBase64 = [];

      for (const listing of photoListings) {
        if (listing.photos.length > 0) {
          const base64Group = [];
          
          for (const photo of listing.photos) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            await new Promise((resolve) => {
              img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                base64Group.push(base64);
                newFilesBase64.push(base64);
                resolve();
              };
              img.src = photo.url;
            });
          }
          
          newImageGroups.push(base64Group);
        }
      }

      // Update app state with new image groups
      const currentImageGroups = [...state.imageGroups];
      
      // Remove empty groups and add new ones
      const filteredGroups = currentImageGroups.filter(group => group && group.length > 0);
      const updatedGroups = [...filteredGroups, ...newImageGroups];
      
      // Add empty group at the end
      updatedGroups.push([]);

      appDispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
      appDispatch({ type: 'SET_FILES_BASE64', payload: [...state.filesBase64, ...newFilesBase64] });

      // Update group metadata with SKUs and prices
      const updatedMetadata = [...(state.groupMetadata || [])];
      
      photoListings.forEach((listing, index) => {
        const groupIndex = filteredGroups.length + index;
        while (updatedMetadata.length <= groupIndex) {
          updatedMetadata.push(null);
        }
        updatedMetadata[groupIndex] = {
          price: state.price || currentBatch?.salePrice || '',
          sku: listing.sku,
          fieldSelections: { ...state.fieldSelections }
        };
      });

      appDispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });

      // Clear photo assignment interface
      setUploadedPhotos([]);
      setPhotoListings([]);
      
      // Switch back to traditional view
      setViewMode('traditional');

      alert(`Successfully converted ${photoListings.length} photo listings to traditional format`);
      
    } catch (error) {
      console.error('Error converting photo listings:', error);
      alert('Error converting photo listings. Please try again.');
    }
  };

  // Generate listing method (same as original)
  const handleGenerateListing = async (aiResolveCategoryFields = false, categoryFields = []) => {
    try {
      const { imageGroups, filesBase64, batchSize, processedGroupIndices, fieldSelections } = state;
   
      const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

      if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
        return;
      }

      appDispatch({ type: 'SET_IS_LOADING', payload: true });

      const newGroupsToProcess = nonEmptyGroups.filter((group, idx) => {
        const originalIndex = imageGroups.findIndex(g => g === group);
        return !processedGroupIndices || !processedGroupIndices.includes(originalIndex);
      });
      
      const newGroupIndices = newGroupsToProcess.map(group => {
        return imageGroups.findIndex(g => g === group);
      });
      
      let allGroupsToProcess = [...newGroupsToProcess];
      let newPoolGroupIndices = [];
      
      if (filesBase64.length > 0 && batchSize > 0) {
        const poolGroups = [];
        for (let i = 0; i < filesBase64.length; i += batchSize) {
          poolGroups.push(filesBase64.slice(i, i + batchSize));
        }
        
        allGroupsToProcess = [...newGroupsToProcess, ...poolGroups];
        
        let updatedGroups = [...imageGroups];
        
        const firstEmptyGroupIndex = updatedGroups.findIndex(g => g.length === 0);
        let insertIndex = firstEmptyGroupIndex !== -1 ? firstEmptyGroupIndex : updatedGroups.length;
        
        const updatedMetadata = [...state.groupMetadata || []];
        
        poolGroups.forEach(group => {
          updatedGroups.splice(insertIndex, 0, group);
          newPoolGroupIndices.push(insertIndex);
          
          while (updatedMetadata.length <= insertIndex) {
            updatedMetadata.push(null);
          }
          updatedMetadata[insertIndex] = { 
            price: state.price || currentBatch?.salePrice || '', 
            sku: state.sku || currentBatch?.sku || '',
            fieldSelections: { ...fieldSelections }
          };
          
          insertIndex++;
        });
        
        appDispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
        
        if (updatedGroups[updatedGroups.length - 1]?.length !== 0) {
          updatedGroups.push([]);
        }
        
        appDispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
      }

      if (allGroupsToProcess.length === 0) {
        alert("No new images to process. All existing groups have already been generated.");
        appDispatch({ type: 'SET_IS_LOADING', payload: false });
        return;
      }

      const totalGroups = allGroupsToProcess.length;
      
      const processingStatus = {
        isProcessing: true,
        processTotal: totalGroups,
        processCompleted: 0
      };
      
      appDispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: processingStatus
      });
      
      appDispatch({ type: 'SET_TOTAL_CHUNKS', payload: totalGroups });
      appDispatch({ type: 'SET_COMPLETED_CHUNKS', payload: 0 });
      
      const updatedResponseData = [...state.responseData];
      const updatedProcessingGroups = [...state.processingGroups];
      
      [...newGroupIndices, ...newPoolGroupIndices].forEach(index => {
        while (updatedResponseData.length <= index) {
          updatedResponseData.push(null);
        }
        
        while (updatedProcessingGroups.length <= index) {
          updatedProcessingGroups.push(false);
        }
        
        updatedResponseData[index] = null;
        updatedProcessingGroups[index] = true;
      });
      
      appDispatch({ type: 'SET_RESPONSE_DATA', payload: updatedResponseData });
      appDispatch({ type: 'SET_IS_DIRTY', payload: false });
      appDispatch({ type: 'SET_PROCESSING_GROUPS', payload: updatedProcessingGroups });

      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections, 
        state.price, 
        state.sku, 
        {}
      );   
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
      }
      
      const currentFieldSelections = {...fieldSelections};
      const processedIndices = [];
      
      const PROCESSING_BATCH_SIZE = 40;
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 2000;
      
      const processGroupWithRetry = async (group, actualIndex, retryCount = 0) => {
        try {
          const response = await fetch(
            "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: state.category,
                subCategory: state.subCategory,
                Base64Key: [group],
                SelectedCategoryOptions: selectedCategoryOptions
              })
            }
          );
          
          if (!response.ok) {
            if (response.status === 504 && retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
              return processGroupWithRetry(group, actualIndex, retryCount + 1);
            }
            
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          return { 
            index: actualIndex, 
            result: Array.isArray(parsed) ? parsed[0] : parsed,
            success: true
          };
        } catch (err) {
          return { 
            index: actualIndex, 
            error: true, 
            result: { 
              error: "Failed to fetch listing data", 
              raw_content: err.message 
            },
            success: false
          };
        }
      };
      
      const results = [];
      
      for (let batchStart = 0; batchStart < allGroupsToProcess.length; batchStart += PROCESSING_BATCH_SIZE) {
        const currentBatch = allGroupsToProcess.slice(batchStart, batchStart + PROCESSING_BATCH_SIZE);
        const batchIndices = [];
        
        for (let i = 0; i < currentBatch.length; i++) {
          const batchItemIndex = batchStart + i;
          let actualIndex;
          
          if (batchItemIndex < newGroupIndices.length) {
            actualIndex = newGroupIndices[batchItemIndex];
          } else {
            const poolArrayIndex = batchItemIndex - newGroupIndices.length;
            actualIndex = newPoolGroupIndices[poolArrayIndex];
          }
          
          batchIndices.push(actualIndex);
          processedIndices.push(actualIndex);
        }
        
        processingStatus.currentGroup = batchStart + 1;
        appDispatch({ 
          type: 'SET_PROCESSING_STATUS', 
          payload: { ...processingStatus }
        });
        
        const batchPromises = currentBatch.map((group, idx) => 
          processGroupWithRetry(group, batchIndices[idx])
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        const completedCount = Math.min(batchStart + PROCESSING_BATCH_SIZE, allGroupsToProcess.length);
        processingStatus.processCompleted = completedCount;
        appDispatch({ 
          type: 'SET_PROCESSING_STATUS', 
          payload: { ...processingStatus }
        });
        
        batchResults.forEach(({ index, result, error, success }) => {
          let finalStoredSelections = { ...currentFieldSelections };
          
          if (aiResolveCategoryFields && success && result && typeof result === 'object' && result.aiResolvedFields) {
            try {
              const merged = { ...currentFieldSelections };
              
              Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
                const currentValue = currentFieldSelections[fieldName];
                
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified" && aiValue.trim() !== "") {
                    merged[fieldName] = aiValue.trim();
                  }
                }
              });

              finalStoredSelections = merged;
            } catch (mergeError) {
              console.error(`Error merging AI fields for group ${index}:`, mergeError);
            }
          }
          
          const safeResult = result || { 
            error: error ? "Processing failed" : "Unknown error",
            title: "",
            description: ""
          };
          
          appDispatch({
            type: 'UPDATE_RESPONSE_DATA',
            payload: { 
              index, 
              value: {
                ...safeResult,
                storedFieldSelections: finalStoredSelections
              }
            }
          });
          
          appDispatch({
            type: 'UPDATE_PROCESSING_GROUP',
            payload: { index, value: false }
          });
        });
        
        if (batchStart + PROCESSING_BATCH_SIZE < allGroupsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      processingStatus.processCompleted = totalGroups;
      processingStatus.currentGroup = totalGroups;
      
      appDispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: processingStatus
      });
      
      appDispatch({ type: 'SET_COMPLETED_CHUNKS', payload: totalGroups });
      appDispatch({ type: 'MARK_GROUPS_AS_PROCESSED', payload: processedIndices });
      
      if (filesBase64.length > 0) {
        appDispatch({ type: 'SET_FILES_BASE64', payload: [] });
      }
      
      if (aiResolveCategoryFields) {
        try {
          const aiResolvedCount = results.filter(r => 
            r && r.success && r.result && r.result.aiResolvedFields && 
            Object.keys(r.result.aiResolvedFields).length > 0
          ).length;
          
          if (aiResolvedCount > 0) {
            setTimeout(() => {
              alert(`🤖 AI successfully resolved category fields across ${aiResolvedCount} listings.`);
            }, 1000);
          }
        } catch (summaryError) {
          console.error('Error generating AI resolution summary:', summaryError);
        }
      }
      
      setTimeout(() => {
        appDispatch({ type: 'RESET_STATUS' });
        appDispatch({ type: 'SET_IS_LOADING', payload: false });
      }, 500);
      
      return true;
      
    } catch (error) {
      console.error("Error in generate listing process:", error);
      alert(`An error occurred: ${error.message}`);
      appDispatch({ type: 'RESET_STATUS' });
      appDispatch({ type: 'SET_IS_LOADING', payload: false });
      throw error;
    }
  };

  const handleBackToOverview = () => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    // Save current photo assignment state before leaving
    if (currentBatch && (uploadedPhotos.length > 0 || photoListings.length > 0 || generatedListings.length > 0)) {
      const photoAssignmentState = {
        uploadedPhotos,
        photoListings,
        viewMode,
        showPhotoReview,
        currentSku,
        aiResolveCategoryFields,
        generatedListings
      };
      
      const updatedBatch = {
        ...currentBatch,
        photoAssignmentState,
        lastViewMode: showPhotoReview ? 'review' : viewMode
      };
      
      updateBatch(updatedBatch);
    }
    
    console.log('🧹 BatchEditor: Clearing app state on back to overview');
    appDispatch({ type: 'CLEAR_ALL_FOR_NEW_BATCH' });
    
    dispatch({ type: 'SET_CURRENT_BATCH', payload: null });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
  };

  const handleCsvDownload = () => {
    if (currentBatch) {
      markCsvDownloaded(currentBatch.id);
    }
  };

  const handleEbayListingsCreated = (listingsCount) => {
    console.log('handleEbayListingsCreated called with count:', listingsCount);
    if (currentBatch) {
      markEbayListingsCreated(currentBatch.id, listingsCount);
    }
  };

  const handleShowEbayListingManager = () => {
    console.log('BatchEditor: Showing eBay listing manager');
    setShowListingManager(true);
  };

  const handleCloseEbayListingManager = () => {
    console.log('BatchEditor: Closing eBay listing manager');
    setShowListingManager(false);
  };

  if (!currentBatch) {
    return null;
  }

  // Render view mode selector
  const ViewModeSelector = () => showPhotoReview ? null : (
    <div style={{
      display: 'flex',
      gap: '10px',
      marginBottom: '20px',
      padding: '15px',
      backgroundColor: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
    }}>
      <button
        onClick={() => {
          setViewMode('traditional');
          setShowPhotoReview(false);
        }}
        style={{
          padding: '10px 20px',
          backgroundColor: viewMode === 'traditional' ? '#007bff' : '#f8f9fa',
          color: viewMode === 'traditional' ? 'white' : '#333',
          border: '1px solid #ddd',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '500'
        }}
      >
        📋 Traditional View
      </button>
      <button
        onClick={() => {
          setViewMode('assignment');
          setShowPhotoReview(false);
        }}
        style={{
          padding: '10px 20px',
          backgroundColor: viewMode === 'assignment' ? '#007bff' : '#f8f9fa',
          color: viewMode === 'assignment' ? 'white' : '#333',
          border: '1px solid #ddd',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: '500'
        }}
      >
        🎯 Photo Assignment
      </button>
      {photoListings.length > 0 && viewMode === 'assignment' && (
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '20px'
        }}>
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333'
          }}>
            <input
              type="checkbox"
              checked={aiResolveCategoryFields}
              onChange={(e) => setAiResolveCategoryFields(e.target.checked)}
              style={{
                width: '18px',
                height: '18px',
                cursor: 'pointer'
              }}
            />
            <span style={{ fontWeight: '500' }}>
              🤖 AI Category Fields
            </span>
          </label>
          
          <button
            onClick={() => setShowPhotoReview(true)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Review & Finalize
            <span style={{ fontSize: '16px' }}>→</span>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="batch-editor-content">
      <div className="batch-editor-header">
        <div className="header-left">
          <button 
            onClick={handleBackToOverview}
            className="back-button"
          >
            ← Back to Batches
          </button>
          <div className="batch-info">
            <h1>{currentBatch.name}</h1>
            <span className="batch-status">{currentBatch.status}</span>
          </div>
        </div>
      </div>

      <ViewModeSelector />

      {viewMode === 'traditional' ? (
        <main className="main-card">
          <FormSection 
            onGenerateListing={handleGenerateListing}
            onCategoryFieldsChange={setCategoryFields}
            batchMode={true}
            currentBatch={currentBatch}
          />
          <BatchPreviewSection 
            onShowListingManager={handleShowEbayListingManager}
            currentBatch={currentBatch}
            onCsvDownload={handleCsvDownload}
            onEbayListingsCreated={handleEbayListingsCreated}
          />
        </main>
      ) : viewMode === 'assignment' && !showPhotoReview ? (
        // Photo Assignment Interface
        <div style={{ 
          padding: '0',
          backgroundColor: 'transparent',
          minHeight: '600px'
        }}>
          {/* Batch Header */}
          <div style={{
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '12px',
            marginBottom: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            border: '2px solid #2196f3'
          }}>
            <h2 style={{ margin: '0 0 10px 0', color: '#1565c0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📦 {currentBatch.name} - Photo Assignment
            </h2>
            <div style={{ display: 'flex', gap: '20px', fontSize: '14px', color: '#1976d2', flexWrap: 'wrap' }}>
              <span style={{ background: 'white', padding: '4px 12px', borderRadius: '6px', border: '1px solid #e3f2fd' }}>
                Category: {currentBatch.category} / {currentBatch.subCategory}
              </span>
              <span style={{ background: 'white', padding: '4px 12px', borderRadius: '6px', border: '1px solid #e3f2fd' }}>
                Default SKU: {currentBatch.sku || 'ITEM'}
              </span>
            </div>
          </div>

          {/* Main Photo Assignment Interface */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: window.innerWidth > 768 ? '1fr 1fr' : '1fr',
            gap: '20px',
            minHeight: '600px'
          }}>
            {/* Left Side - Photo Upload Area */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>📸 Photo Upload Area</h3>
              
              {/* Upload Drop Zone */}
              <div
                onDrop={handleFileDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: '2px dashed #bbb',
                  borderRadius: '8px',
                  padding: '30px',
                  textAlign: 'center',
                  marginBottom: '20px',
                  backgroundColor: '#fafafa',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '10px' }}>📁</div>
                <p style={{ margin: '0', color: '#666' }}>Drop photos here or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Auto-assign Controls */}
              {uploadedPhotos.length > 0 && (
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  marginBottom: '15px',
                  padding: '12px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  flexWrap: 'wrap'
                }}>
                  <label style={{ fontSize: '14px', fontWeight: '500' }}>
                    Auto-assign every
                  </label>
                  <select 
                    value={autoAssignCount} 
                    onChange={(e) => setAutoAssignCount(Number(e.target.value))}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '4px',
                      border: '1px solid #ccc'
                    }}
                  >
                    {[1,2,3,4,5,6,8,10,12].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: '14px', fontWeight: '500' }}>photos to listings</label>
                  <button
                    onClick={autoAssignPhotos}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    Auto-assign
                  </button>
                </div>
              )}

              {/* Current SKU Display */}
              <div style={{
                padding: '10px',
                backgroundColor: '#e8f4f8',
                borderRadius: '6px',
                marginBottom: '15px',
                fontSize: '14px'
              }}>
                <strong>Current SKU Base:</strong> {currentSku || currentBatch?.sku || 'ITEM'}
                <button
                  onClick={() => {
                    const newSku = prompt('Enter new SKU base:', currentSku || currentBatch?.sku || '');
                    if (newSku !== null) setCurrentSku(newSku);
                  }}
                  style={{
                    marginLeft: '10px',
                    padding: '4px 8px',
                    fontSize: '12px',
                    backgroundColor: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Change
                </button>
              </div>

              {/* Uploaded Photos Grid */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {uploadedPhotos.length === 0 ? (
                  <div style={{ 
                    textAlign: 'center', 
                    color: '#999', 
                    padding: '40px 20px',
                    fontSize: '16px'
                  }}>
                    No photos uploaded yet
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                    gap: '10px'
                  }}>
                    {uploadedPhotos.map(photo => (
                      <div
                        key={photo.id}
                        draggable
                        onDragStart={() => handlePhotoDragStart(photo)}
                        style={{
                          position: 'relative',
                          aspectRatio: '1',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          cursor: 'move',
                          border: '2px solid #ddd',
                          transition: 'transform 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      >
                        <img
                          src={photo.url}
                          alt={photo.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side - Listings Area */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: '0', color: '#333' }}>📝 Listings ({photoListings.length})</h3>
                <button
                  onClick={createEmptyListing}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  + New Listing
                </button>
              </div>

              {/* Listings Container */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {photoListings.length === 0 ? (
                  <div style={{
                    border: '2px dashed #ccc',
                    borderRadius: '8px',
                    padding: '40px 20px',
                    textAlign: 'center',
                    color: '#999',
                    backgroundColor: '#fafafa'
                  }}>
                    <div style={{ fontSize: '36px', marginBottom: '10px' }}>🎯</div>
                    <p style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Drop photos here to create listings</p>
                    <p style={{ margin: '0', fontSize: '14px' }}>
                      Or use the auto-assign feature to quickly create multiple listings
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {photoListings.map(listing => (
                      <div
                        key={listing.id}
                        onDrop={(e) => handleListingDrop(e, listing.id)}
                        onDragOver={(e) => e.preventDefault()}
                        style={{
                          border: `2px solid ${listing.isGenerated ? '#28a745' : '#007bff'}`,
                          borderRadius: '8px',
                          padding: '15px',
                          backgroundColor: listing.isGenerated ? '#f8fff8' : '#f8f9ff',
                          position: 'relative'
                        }}
                      >
                        {/* Listing Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div>
                            <h4 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#333' }}>
                              {listing.title}
                            </h4>
                            <div style={{ fontSize: '12px', color: '#666' }}>
                              SKU: {listing.sku} • {listing.photos.length} photos
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '5px' }}>
                            {listing.isGenerated && (
                              <span style={{
                                backgroundColor: '#28a745',
                                color: 'white',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                ✓ Generated
                              </span>
                            )}
                            <button
                              onClick={() => deleteListing(listing.id)}
                              style={{
                                padding: '4px 8px',
                                backgroundColor: '#dc3545',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Photos Grid */}
                        {listing.photos.length === 0 ? (
                          <div style={{
                            border: '1px dashed #ccc',
                            borderRadius: '6px',
                            padding: '20px',
                            textAlign: 'center',
                            color: '#999',
                            backgroundColor: 'rgba(255,255,255,0.5)'
                          }}>
                            Drop photos here
                          </div>
                        ) : (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))',
                            gap: '8px'
                          }}>
                            {listing.photos.map(photo => (
                              <div
                                key={photo.id}
                                draggable
                                onDragStart={() => handlePhotoDragStart(photo, listing.id)}
                                style={{
                                  position: 'relative',
                                  aspectRatio: '1',
                                  borderRadius: '4px',
                                  overflow: 'hidden',
                                  cursor: 'move',
                                  border: '1px solid #ddd'
                                }}
                              >
                                <img
                                  src={photo.url}
                                  alt={photo.name}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover'
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Batch Preview Section for Photo Assignment */}
          <BatchPreviewSection 
            onShowListingManager={handleShowEbayListingManager}
            currentBatch={currentBatch}
            onCsvDownload={handleCsvDownload}
            onEbayListingsCreated={handleEbayListingsCreated}
          />
        </div>
      ) : showPhotoReview ? (
        <PhotoAssignmentReview
          photoListings={photoListings}
          generatedListings={generatedListings}
          onGeneratedListingsChange={setGeneratedListings}
          onBack={() => {
            setShowPhotoReview(false);
            // Save the current state when going back from review
            if (currentBatch) {
              const photoAssignmentState = {
                uploadedPhotos,
                photoListings,
                viewMode,
                showPhotoReview: false,
                currentSku,
                aiResolveCategoryFields,
                generatedListings
              };
              
              const updatedBatch = {
                ...currentBatch,
                photoAssignmentState,
                lastViewMode: 'assignment'
              };
              
              updateBatch(updatedBatch);
            }
          }}
          currentBatch={currentBatch}
          categoryFields={categoryFields}
          category={state.category}
          subCategory={state.subCategory}
          categoryID={state.categoryID}
          aiResolveCategoryFields={aiResolveCategoryFields}
        />
      ) : null}

      {showListingManager && (
        <div className="listing-modal-overlay">
          <div className="listing-modal">
            <EbayListingManager 
              onClose={handleCloseEbayListingManager}
              onListingsCreated={handleEbayListingsCreated}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// App Layout Component
function AppLayout() {
  const { viewMode, currentBatch } = useBatch();

  const renderMainContent = () => {
    switch (viewMode) {
      case 'create':
        return <BatchWizard />;
      case 'edit':
        return currentBatch ? <BatchEditor /> : <BatchOverview />;
      case 'overview':
      default:
        return <BatchOverview />;
    }
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <MainHeader />
        <div className="content-area">
          {renderMainContent()}
        </div>
      </div>
    </div>
  );
}

// Main App Content
function AppContent() {
  const { categoriesLoading } = useCategories();
  
  // Show loading state while categories are being loaded
  if (categoriesLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        backgroundColor: '#f8f9fa'
      }}>
        <LoadingSpinner message="Loading categories..." />
      </div>
    );
  }
  
  return <AppLayout />;
}

// Enhanced EbayCallback component
const EbayCallback = () => {
  const { handleAuthCallback } = useEbayAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');
    
    const processedKey = `ebay_callback_processed_${authCode || error || 'unknown'}`;
    const alreadyProcessed = sessionStorage.getItem(processedKey);
    
    if (alreadyProcessed) {
      setError('This authorization has already been processed. Please try logging in again.');
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
      return;
    }

    if (error) {
      sessionStorage.setItem(processedKey, 'true');
      const errorParam = encodeURIComponent(errorDescription || error);
      window.location.href = '/?ebay_error=' + errorParam;
      return;
    }

    if (authCode) {
      sessionStorage.setItem(processedKey, 'true');
      
      const exchangeTimeout = setTimeout(() => {
        setError('The authentication process timed out. Please try again.');
        setTimeout(() => {
          window.location.href = '/?ebay_error=timeout';
        }, 3000);
      }, 30000);
      
      handleAuthCallback(authCode).then(success => {
        clearTimeout(exchangeTimeout);
        
        if (success) {
          setTimeout(() => {
            window.location.href = '/?ebay_connected=true';
          }, 100);
        } else {
          window.location.href = '/?ebay_error=authentication_failed';
        }
      }).catch(callbackError => {
        clearTimeout(exchangeTimeout);
        
        if (callbackError.message.includes('already been used')) {
          setError('This authorization code has already been used. Please log in again.');
        } else if (callbackError.message.includes('invalid_grant')) {
          setError('The authorization has expired or is invalid. Please try logging in again.');
        } else {
          setError(`Authentication failed: ${callbackError.message}`);
        }
        
        setTimeout(() => {
          window.location.href = '/?ebay_error=' + encodeURIComponent(callbackError.message || 'callback_error');
        }, 3000);
      });
    } else {
      window.location.href = '/?ebay_error=invalid_callback';
    }
  }, [handleAuthCallback]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      padding: '20px'
    }}>
      {error ? (
        <>
          <div style={{
            color: '#dc3545',
            fontSize: '1.2rem',
            marginBottom: '1rem',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            {error}
          </div>
          <p style={{ color: '#666' }}>Redirecting...</p>
        </>
      ) : (
        <LoadingSpinner message="Processing eBay authentication..." />
      )}
    </div>
  );
};

// Main App Component with Auth0 Integration
function App() {
  const pathname = window.location.pathname;
  
  // Handle eBay callback route
  if (pathname === '/ebay/callback' || pathname === '/ebay/callback/') {
    return (
      <Auth0Provider
        domain={AUTH0_DOMAIN}
        clientId={AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          audience: AUTH0_AUDIENCE,
          scope: "openid profile email"
        }}
        cacheLocation="localstorage"
        useRefreshTokens={true}
      >
        <EbayAuthProvider>
          <EbayCallback />
        </EbayAuthProvider>
      </Auth0Provider>
    );
  }

  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: AUTH0_AUDIENCE,
        scope: "openid profile email"
      }}
      cacheLocation="localstorage"
      useRefreshTokens={true}
    >
      <AuthenticationWrapper>
        <CategoryProvider>
          <EbayAuthProvider>
            <AppStateProvider>
              <BatchProvider>
                <AppContent />
              </BatchProvider>
            </AppStateProvider>
          </EbayAuthProvider>
        </CategoryProvider>
      </AuthenticationWrapper>
    </Auth0Provider>
  );
}

export default App;