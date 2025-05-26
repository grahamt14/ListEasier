// StateContext.jsx
import { createContext, useContext, useReducer, useEffect } from 'react';

// Create context
export const AppStateContext = createContext();

// Define initial state
const initialState = {
  // Form fields
  category: '--',
  subCategory: '--',
  price: '',
  sku: '',
  categoryID: '',
  fieldSelections: {},
  
  // Images
  filesBase64: [],
  rawFiles: [],
  imageGroups: [[]],
  s3ImageGroups: [[]],
  imageRotations: {},
  selectedImages: [],
  
  // Processing
  batchSize: 0,
  isLoading: false,
  isDirty: false,
  totalChunks: 0,
  completedChunks: 0,
  processingGroups: [],
  
  // Status/Error
  errorMessages: [],
  responseData: [],
  
  // Enhanced loading state tracking
  uploadStatus: {
    isUploading: false,
    uploadProgress: 0,
    uploadTotal: 0,
    uploadCompleted: 0,
    uploadStage: '',
    currentFileIndex: 0 // Add this new property
  },
  
 processingStatus: {
    isProcessing: false,
    processTotal: 0,
    processCompleted: 0,
    processStage: '', // Add this property,
    currentGroup: 0
  },
  
  // Track processed groups for incremental processing
  processedGroupIndices: [],
  
  // Track price and SKU for each group
  groupMetadata: []
};

// Create reducer to handle all state updates
function appReducer(state, action) {
  switch (action.type) {
	  // In the appReducer function in StateContext.jsx
	  
	    case 'CLEAR_ALL_FOR_NEW_BATCH':
      return {
        ...initialState,
        // Keep only essential non-image state
        category: '--',
        subCategory: '--',
        price: '',
        sku: '',
        categoryID: '',
        fieldSelections: {},
        // Reset all image-related state
        filesBase64: [],
        rawFiles: [],
        imageGroups: [[]],
        s3ImageGroups: [[]],
        imageRotations: {},
        selectedImages: [],
        responseData: [],
        processedGroupIndices: [],
        groupMetadata: [],
        // Reset status
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
      };

    case 'LOAD_BATCH_STATE':
      return {
        ...state,
        ...action.payload
      };
case 'SET_PROCESSING_STATUS':
  return {
    ...state,
    processingStatus: {
      ...state.processingStatus,
      ...action.payload
    }
  };

    case 'SET_CATEGORY':
      return { ...state, category: action.payload, isDirty: true };
      
    case 'SET_SUBCATEGORY':
      return { ...state, subCategory: action.payload, isDirty: true };
      
    case 'SET_PRICE':
      return { ...state, price: action.payload, isDirty: true };
      
    case 'SET_SKU':
      return { ...state, sku: action.payload, isDirty: true };
      
    case 'SET_CATEGORY_ID':
      return { ...state, categoryID: action.payload };
      
    case 'SET_FIELD_SELECTIONS':
      return { 
        ...state, 
        fieldSelections: action.payload, 
        isDirty: true 
      };
    
    case 'UPDATE_FIELD_SELECTION':
      return {
        ...state,
        fieldSelections: {
          ...state.fieldSelections,
          [action.payload.field]: action.payload.value
        },
        isDirty: true
      };
      
    case 'SET_FILES_BASE64':
      return { ...state, filesBase64: action.payload, isDirty: true };
      
    case 'ADD_FILES_BASE64':
      return { 
        ...state, 
        filesBase64: [...state.filesBase64, ...action.payload], 
        isDirty: true 
      };
      
    case 'SET_RAW_FILES':
      return { ...state, rawFiles: action.payload };
      
    case 'ADD_RAW_FILES':
      return { 
        ...state, 
        rawFiles: [...state.rawFiles, ...action.payload] 
      };
      
    case 'SET_IMAGE_GROUPS':
      return { ...state, imageGroups: action.payload, isDirty: true };
      
    case 'SET_S3_IMAGE_GROUPS':
      return { ...state, s3ImageGroups: action.payload };
      
    case 'SET_BATCH_SIZE':
      return { ...state, batchSize: action.payload, isDirty: true };
      
    case 'SET_SELECTED_IMAGES':
      return { ...state, selectedImages: action.payload };
    
    case 'TOGGLE_IMAGE_SELECTION':
      return { 
        ...state, 
        selectedImages: state.selectedImages.includes(action.payload)
          ? state.selectedImages.filter(i => i !== action.payload)
          : [...state.selectedImages, action.payload]
      };
      
    case 'SET_IMAGE_ROTATIONS':
      return { ...state, imageRotations: action.payload };
      
    case 'UPDATE_IMAGE_ROTATION':
      return {
        ...state,
        imageRotations: {
          ...state.imageRotations,
          [action.payload.index]: action.payload.rotation
        },
        isDirty: true
      };
      
    case 'SET_ERROR_MESSAGES':
      return { ...state, errorMessages: action.payload };
      
    case 'ADD_ERROR_MESSAGE':
      if (state.errorMessages.includes(action.payload)) {
        return state;
      }
      return { ...state, errorMessages: [...state.errorMessages, action.payload] };
      
    case 'REMOVE_ERROR_MESSAGE':
      return { 
        ...state, 
        errorMessages: state.errorMessages.filter(msg => msg !== action.payload)
      };
      
    case 'SET_IS_LOADING':
      return { ...state, isLoading: action.payload };
      
    case 'SET_IS_DIRTY':
      return { ...state, isDirty: action.payload };
      
    case 'SET_TOTAL_CHUNKS':
      return { ...state, totalChunks: action.payload };
      
    case 'SET_COMPLETED_CHUNKS':
      return { ...state, completedChunks: action.payload };
      
    case 'SET_PROCESSING_GROUPS':
      return { ...state, processingGroups: action.payload };
      
    case 'UPDATE_PROCESSING_GROUP':
      return {
        ...state,
        processingGroups: state.processingGroups.map((item, i) => 
          i === action.payload.index ? action.payload.value : item
        )
      };
      
    case 'SET_RESPONSE_DATA':
      return { ...state, responseData: action.payload };
      
    case 'UPDATE_RESPONSE_DATA':
      const updatedResponseData = [...state.responseData];
      // Make sure the array is long enough
      while (updatedResponseData.length <= action.payload.index) {
        updatedResponseData.push(null);
      }
      updatedResponseData[action.payload.index] = action.payload.value;
      
      return {
        ...state,
        responseData: updatedResponseData
      };
      
    case 'SET_UPLOAD_STATUS':
      return {
        ...state,
        uploadStatus: {
          ...state.uploadStatus,
          ...action.payload
        }
      };
      
    case 'SET_PROCESSING_STATUS':
      return {
        ...state,
        processingStatus: {
          ...state.processingStatus,
          ...action.payload
        }
      };
      
case 'RESET_STATUS':
  return {
    ...state,
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
      currentGroup: 0
    }
  };
      
    // New actions for incremental processing
    case 'MARK_GROUPS_AS_PROCESSED':
      return {
        ...state,
        processedGroupIndices: [...(state.processedGroupIndices || []), ...action.payload]
      };
      
    case 'CLEAR_PROCESSED_GROUPS':
      return {
        ...state,
        processedGroupIndices: []
      };
      
    // New actions for group metadata
    case 'UPDATE_GROUP_METADATA':
      return {
        ...state,
        groupMetadata: action.payload
      };
      
    case 'ADD_GROUP_METADATA':
      return {
        ...state,
        groupMetadata: [...state.groupMetadata, action.payload]
      };
      
    case 'GROUP_SELECTED_IMAGES':
  const groupImgs = state.selectedImages.map(i => state.filesBase64[i]);
  const groupRawFiles = state.selectedImages.map(i => state.rawFiles[i]);
  
  const remainingBase64 = state.filesBase64.filter((_, i) => 
    !state.selectedImages.includes(i)
  );
  
  const remainingRawFiles = state.rawFiles.filter((_, i) => 
    !state.selectedImages.includes(i)
  );
  
  // Update rotations
  const newRotations = { ...state.imageRotations };
  state.selectedImages.forEach(index => {
    delete newRotations[index];
  });
  
  // Reindex rotations
  const finalRotations = {};
  let newIndex = 0;
  state.filesBase64.forEach((_, oldIndex) => {
    if (!state.selectedImages.includes(oldIndex)) {
      if (newRotations[oldIndex] !== undefined) {
        finalRotations[newIndex] = newRotations[oldIndex];
      }
      newIndex++;
    }
  });
  
  // Create metadata for this new group
  const newGroupMetadata = {
    price: state.price,
    sku: state.sku
  };
  
  // Update image groups to include the selected images
  let updatedGroups = [...state.imageGroups];
  const firstEmptyIndex = updatedGroups.findIndex(g => g.length === 0);
  
  // Get existing S3 groups
  let updatedS3Groups = [...(state.s3ImageGroups || [])];
  while (updatedS3Groups.length < updatedGroups.length) {
    updatedS3Groups.push([]);
  }
  
  if (firstEmptyIndex !== -1) {
    updatedGroups[firstEmptyIndex] = [...updatedGroups[firstEmptyIndex], ...groupImgs];
    
    // S3 URLs have already been assigned to this group by the handleGroupSelected function
    // We just need to make sure we don't overwrite them
    
    // Update group metadata at the same index
    const updatedMetadata = [...state.groupMetadata];
    while (updatedMetadata.length <= firstEmptyIndex) {
      updatedMetadata.push(null);
    }
    updatedMetadata[firstEmptyIndex] = newGroupMetadata;
    
    if (updatedGroups[updatedGroups.length - 1].length > 0) {
      updatedGroups.push([]);
      updatedS3Groups.push([]);
    }
    
    return {
      ...state,
      filesBase64: remainingBase64,
      rawFiles: remainingRawFiles,
      selectedImages: [],
      imageRotations: finalRotations,
      imageGroups: updatedGroups,
      s3ImageGroups: updatedS3Groups,
      groupMetadata: updatedMetadata,
      isDirty: true
    };
  } else {
    updatedGroups.push(groupImgs);
    
    // S3 URLs have already been assigned to the appropriate group
    // by the handleGroupSelected function
    
    // Add metadata for the new group
    const updatedMetadata = [...state.groupMetadata, newGroupMetadata];
    
    if (updatedGroups[updatedGroups.length - 1].length > 0) {
      updatedGroups.push([]);
      updatedS3Groups.push([]);
    }
    
    return {
      ...state,
      filesBase64: remainingBase64,
      rawFiles: remainingRawFiles,
      selectedImages: [],
      imageRotations: finalRotations,
      imageGroups: updatedGroups,
      s3ImageGroups: updatedS3Groups,
      groupMetadata: updatedMetadata,
      isDirty: true
    };
  }
      
    // UPDATED: Modified HANDLE_GROUP_DROP case to handle S3 URLs properly    
    case 'HANDLE_GROUP_DROP':
      const { dropGroupIdx, imgIdx, from, fromIndex } = action.payload;
      let newGroups = [...state.imageGroups];
      let newS3Groups = [...(state.s3ImageGroups || [])];
      
      // Ensure s3ImageGroups has the same structure as imageGroups
      while (newS3Groups.length < newGroups.length) {
        newS3Groups.push([]);
      }
      
      if (from === "pool") {
        const i = parseInt(fromIndex, 10);
        const img = state.filesBase64[i];
        
        // Get S3 URL if available
        let s3Url = null;
        if (state.s3ImageGroups && state.s3ImageGroups[0] && state.s3ImageGroups[0][i]) {
          s3Url = state.s3ImageGroups[0][i];
        }
        
        // Update filesBase64
        const newFilesBase64 = state.filesBase64.filter((_, j) => j !== i);
        
        // Update target group
        const tgt = [...newGroups[dropGroupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        newGroups[dropGroupIdx] = tgt;
        
        // Update S3 URL group if there's a URL
        if (s3Url) {
          const s3Tgt = [...(newS3Groups[dropGroupIdx] || [])];
          imgIdx === null ? s3Tgt.push(s3Url) : s3Tgt.splice(imgIdx, 0, s3Url);
          newS3Groups[dropGroupIdx] = s3Tgt;
        }
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
          newS3Groups.push([]);
        }
        
        return {
          ...state,
          filesBase64: newFilesBase64,
          imageGroups: newGroups,
          s3ImageGroups: newS3Groups,
          selectedImages: [],
          isDirty: true
        };
      } else {
        const [srcG, srcI] = fromIndex.split("-").map(Number);
        
        if (!(srcG === dropGroupIdx && srcI === imgIdx)) {
          const img = newGroups[srcG][srcI];
          newGroups[srcG] = newGroups[srcG].filter((_, j) => j !== srcI);
          
          const tgt = [...newGroups[dropGroupIdx]];
          imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
          newGroups[dropGroupIdx] = tgt;
          
          // Also move S3 URL if available
          if (newS3Groups[srcG] && newS3Groups[srcG][srcI]) {
            const s3Url = newS3Groups[srcG][srcI];
            newS3Groups[srcG] = newS3Groups[srcG].filter((_, j) => j !== srcI);
            
            // Make sure target S3 group exists
            if (!newS3Groups[dropGroupIdx]) {
              newS3Groups[dropGroupIdx] = [];
            }
            
            const s3Tgt = [...newS3Groups[dropGroupIdx]];
            imgIdx === null ? s3Tgt.push(s3Url) : s3Tgt.splice(imgIdx, 0, s3Url);
            newS3Groups[dropGroupIdx] = s3Tgt;
          }
        }
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
          newS3Groups.push([]);
        }
        
        return {
          ...state,
          imageGroups: newGroups,
          s3ImageGroups: newS3Groups,
          selectedImages: [],
          isDirty: true
        };
      }
      
    case 'CLEAR_ALL':
      return {
        ...initialState,
        imageGroups: [[]], // Keep an empty group
        s3ImageGroups: [[]],
        processedGroupIndices: [], // Clear processed groups
        groupMetadata: [] // Clear group metadata
      };

    case 'ROTATE_IMAGE':
      const { index, direction } = action.payload;
      // Note: The actual rotation logic would be implemented elsewhere and
      // dispatch UPDATE_FILES_BASE64 to update the actual image

      // Just update the rotation state here
      const currentRotation = state.imageRotations[index] || 0;
      const rotationChange = direction === 'right' ? 90 : -90;
      const newRotation = (currentRotation + rotationChange + 360) % 360;

      return {
        ...state,
        imageRotations: {
          ...state.imageRotations,
          [index]: newRotation
        },
        isDirty: true
      };

    case 'UPDATE_FILES_BASE64_AT_INDEX':
      const updatedFiles = [...state.filesBase64];
      updatedFiles[action.payload.index] = action.payload.value;
      
      return {
        ...state,
        filesBase64: updatedFiles,
        isDirty: true
      };
      
    default:
      return state;
  }
}

// Create provider component
export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  
  // For debugging
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('AppState updated:', state);
    }
  }, [state]);
  
  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
}

// Custom hook for using the app state
export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
}