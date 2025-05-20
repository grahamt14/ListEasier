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
    uploadStage: ''
  },
  processingStatus: {
    isProcessing: false,
    processTotal: 0,
    processCompleted: 0
  },
  
  // Track processed groups for incremental processing
  processedGroupIndices: []
};

// Create reducer to handle all state updates
function appReducer(state, action) {
  switch (action.type) {
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
          uploadStage: ''
        },
        processingStatus: {
          isProcessing: false,
          processTotal: 0,
          processCompleted: 0
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
      
      // Update image groups to include the selected images
      let updatedGroups = [...state.imageGroups];
      const firstEmptyIndex = updatedGroups.findIndex(g => g.length === 0);
      
      if (firstEmptyIndex !== -1) {
        updatedGroups[firstEmptyIndex] = [...updatedGroups[firstEmptyIndex], ...groupImgs];
      } else {
        updatedGroups.push(groupImgs);
      }
      
      if (updatedGroups[updatedGroups.length - 1].length > 0) {
        updatedGroups.push([]);
      }
      
      return {
        ...state,
        filesBase64: remainingBase64,
        rawFiles: remainingRawFiles,
        selectedImages: [],
        imageRotations: finalRotations,
        imageGroups: updatedGroups,
        isDirty: true
      };
      
    case 'HANDLE_GROUP_DROP':
      const { dropGroupIdx, imgIdx, from, fromIndex } = action.payload;
      let newGroups = [...state.imageGroups];
      
      if (from === "pool") {
        const i = parseInt(fromIndex, 10);
        const img = state.filesBase64[i];
        
        // Update filesBase64
        const newFilesBase64 = state.filesBase64.filter((_, j) => j !== i);
        
        // Update target group
        const tgt = [...newGroups[dropGroupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        newGroups[dropGroupIdx] = tgt;
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
        }
        
        return {
          ...state,
          filesBase64: newFilesBase64,
          imageGroups: newGroups,
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
        }
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
        }
        
        return {
          ...state,
          imageGroups: newGroups,
          selectedImages: [],
          isDirty: true
        };
      }
      
    case 'CLEAR_ALL':
      return {
        ...initialState,
        imageGroups: [[]], // Keep an empty group
        s3ImageGroups: [[]],
        processedGroupIndices: [] // Clear processed groups
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