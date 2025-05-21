// StateContext.jsx with Enhanced S3 Image Debugging
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
  processedGroupIndices: [],
  
  // Track price and SKU for each group
  groupMetadata: []
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
      console.log('[STATE DEBUG] SET_IMAGE_GROUPS called with:', 
        action.payload ? `${action.payload.length} groups` : 'null/undefined');
      return { ...state, imageGroups: action.payload, isDirty: true };
      
    case 'SET_S3_IMAGE_GROUPS':
      console.log('[STATE DEBUG] SET_S3_IMAGE_GROUPS called with:',
        action.payload ? {
          length: action.payload.length,
          groups: action.payload.map(group => group ? 
            {
              length: group.length,
              hasValidUrls: group.some(url => url && typeof url === 'string' && url.includes('amazonaws.com')),
              firstUrl: group.length > 0 ? (typeof group[0] === 'string' ? 
                group[0].substring(0, 30) + '...' : 'non-string') : 'empty'
            } : 'null/undefined'
          )
        } : 'null/undefined'
      );
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
      console.log('[STATE DEBUG] Marking groups as processed:', action.payload);
      return {
        ...state,
        processedGroupIndices: [...(state.processedGroupIndices || []), ...action.payload]
      };
      
    case 'CLEAR_PROCESSED_GROUPS':
      console.log('[STATE DEBUG] Clearing all processed groups');
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
      
      console.log('[STATE DEBUG] Creating new group from selected images:', {
        groupSize: groupImgs.length,
        firstEmptyIndex,
        currentGroups: updatedGroups.length
      });
      
      if (firstEmptyIndex !== -1) {
        updatedGroups[firstEmptyIndex] = [...updatedGroups[firstEmptyIndex], ...groupImgs];
        
        // Update group metadata at the same index
        const updatedMetadata = [...state.groupMetadata];
        while (updatedMetadata.length <= firstEmptyIndex) {
          updatedMetadata.push(null);
        }
        updatedMetadata[firstEmptyIndex] = newGroupMetadata;
        
        if (updatedGroups[updatedGroups.length - 1].length > 0) {
          updatedGroups.push([]);
        }
        
        // Create matching S3 group (empty for now, will be filled on upload)
        const updatedS3Groups = [...state.s3ImageGroups];
        while (updatedS3Groups.length <= firstEmptyIndex) {
          updatedS3Groups.push([]);
        }
        
        // The actual S3 URLs will be created during the upload process
        // For now, we just need a placeholder that matches the structure
        updatedS3Groups[firstEmptyIndex] = [...(updatedS3Groups[firstEmptyIndex] || []), ...Array(groupImgs.length).fill(null)];
        
        // Ensure empty group at the end
        if (updatedS3Groups.length > 0 && updatedS3Groups[updatedS3Groups.length - 1].length > 0) {
          updatedS3Groups.push([]);
        }
        
        console.log('[STATE DEBUG] Updated S3 groups structure after adding new group:', {
          groupIndex: firstEmptyIndex,
          newLength: updatedS3Groups[firstEmptyIndex].length,
          totalGroups: updatedS3Groups.length
        });
        
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
        
        // Add metadata for the new group
        const updatedMetadata = [...state.groupMetadata, newGroupMetadata];
        
        if (updatedGroups[updatedGroups.length - 1].length > 0) {
          updatedGroups.push([]);
        }
        
        // Create matching S3 group (empty for now, will be filled on upload)
        const updatedS3Groups = [...state.s3ImageGroups];
        // The S3 URLs will be created during the upload process
        updatedS3Groups.push(Array(groupImgs.length).fill(null));
        
        // Ensure empty group at the end
        if (updatedS3Groups.length > 0 && updatedS3Groups[updatedS3Groups.length - 1].length > 0) {
          updatedS3Groups.push([]);
        }
        
        console.log('[STATE DEBUG] Updated S3 groups structure after adding new group at the end:', {
          newGroupIndex: updatedS3Groups.length - 2,
          newLength: updatedS3Groups[updatedS3Groups.length - 2].length,
          totalGroups: updatedS3Groups.length
        });
        
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
      
    case 'HANDLE_GROUP_DROP':
      const { dropGroupIdx, imgIdx, from, fromIndex } = action.payload;
      let newGroups = [...state.imageGroups];
      let newS3Groups = [...state.s3ImageGroups];
      
      console.log('[STATE DEBUG] Handling group drop:', {
        dropGroupIdx,
        imgIdx,
        from,
        fromIndex
      });
      
      if (from === "pool") {
        const i = parseInt(fromIndex, 10);
        const img = state.filesBase64[i];
        
        // Update filesBase64
        const newFilesBase64 = state.filesBase64.filter((_, j) => j !== i);
        
        // Update target group
        const tgt = [...newGroups[dropGroupIdx]];
        imgIdx === null ? tgt.push(img) : tgt.splice(imgIdx, 0, img);
        newGroups[dropGroupIdx] = tgt;
        
        // Update S3 group with a placeholder
        // The actual S3 URL will be generated on upload
        // Ensure the s3ImageGroups structure matches imageGroups
        while (newS3Groups.length <= dropGroupIdx) {
          newS3Groups.push([]);
        }
        
        const s3Target = [...(newS3Groups[dropGroupIdx] || [])];
        imgIdx === null ? s3Target.push(null) : s3Target.splice(imgIdx, 0, null);
        newS3Groups[dropGroupIdx] = s3Target;
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
        }
        
        if (newS3Groups.length > 0 && newS3Groups[newS3Groups.length - 1]?.length > 0) {
          newS3Groups.push([]);
        }
        
        console.log('[STATE DEBUG] Updated groups after drop from pool:', {
          targetGroup: dropGroupIdx,
          newImageGroupsLength: newGroups[dropGroupIdx].length,
          newS3GroupsLength: newS3Groups[dropGroupIdx].length
        });
        
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
          
          // Make the same changes to s3ImageGroups to keep them in sync
          if (newS3Groups && newS3Groups.length > srcG && newS3Groups[srcG] && 
              newS3Groups.length > dropGroupIdx) {
            
            // Get the corresponding S3 URL or null
            const s3Url = newS3Groups[srcG] && newS3Groups[srcG].length > srcI ? 
              newS3Groups[srcG][srcI] : null;
            
            // Remove from source group
            newS3Groups[srcG] = newS3Groups[srcG].filter((_, j) => j !== srcI);
            
            // Add to target group
            const s3Tgt = [...(newS3Groups[dropGroupIdx] || [])];
            imgIdx === null ? s3Tgt.push(s3Url) : s3Tgt.splice(imgIdx, 0, s3Url);
            newS3Groups[dropGroupIdx] = s3Tgt;
            
            console.log('[STATE DEBUG] Moved S3 URL between groups:', {
              fromGroup: srcG,
              toGroup: dropGroupIdx,
              s3Url: s3Url ? (typeof s3Url === 'string' ? s3Url.substring(0, 30) + '...' : 'non-string') : 'null'
            });
          } else {
            console.warn('[STATE DEBUG] Unable to update S3 groups during drag-and-drop, structure mismatch:', {
              s3GroupsLength: newS3Groups ? newS3Groups.length : 'null/undefined',
              srcG,
              dropGroupIdx
            });
          }
        }
        
        // Ensure empty group at end
        if (newGroups[newGroups.length - 1].length > 0) {
          newGroups.push([]);
        }
        
        if (newS3Groups && newS3Groups.length > 0 && 
            newS3Groups[newS3Groups.length - 1]?.length > 0) {
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
      console.log('[STATE DEBUG] Clearing all state data');
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
  
  // Enhanced debug monitoring
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('AppState updated:', state);
      
      // Add specific monitoring for s3ImageGroups changes
      console.log('[STATE MONITOR] s3ImageGroups state:', 
        state.s3ImageGroups ? {
          length: state.s3ImageGroups.length,
          nonEmptyGroups: state.s3ImageGroups.filter(g => g && g.length > 0).length,
          totalUrls: state.s3ImageGroups.reduce((total, group) => 
            total + (group ? group.length : 0), 0),
          validUrls: state.s3ImageGroups.reduce((total, group) => 
            total + (group ? group.filter(url => url && typeof url === 'string' && 
              (url.includes('amazonaws.com') || url.startsWith('http'))).length : 0), 0)
        } : 'null/undefined'
      );
      
      // Check for inconsistencies between imageGroups and s3ImageGroups
      if (state.imageGroups && state.s3ImageGroups) {
        const imgGroupsLength = state.imageGroups.length;
        const s3GroupsLength = state.s3ImageGroups.length;
        
        if (imgGroupsLength !== s3GroupsLength) {
          console.warn('[STATE MONITOR] MISMATCH: imageGroups and s3ImageGroups have different lengths:', {
            imageGroups: imgGroupsLength,
            s3ImageGroups: s3GroupsLength
          });
        }
        
        // Check if the group sizes match
        let mismatchFound = false;
        state.imageGroups.forEach((group, idx) => {
          if (idx < state.s3ImageGroups.length) {
            const s3Group = state.s3ImageGroups[idx];
            if (group && s3Group && group.length !== s3Group.length) {
              mismatchFound = true;
              console.warn(`[STATE MONITOR] MISMATCH: Group ${idx+1} has different sizes:`, {
                imageGroup: group.length,
                s3Group: s3Group.length
              });
            }
          }
        });
        
        if (!mismatchFound) {
          console.log('[STATE MONITOR] VALIDATION PASSED: imageGroups and s3ImageGroups structures match');
        }
      }
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