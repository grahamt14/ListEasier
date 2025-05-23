// OptimizedImageUploader.jsx (Updated with HEIC Context Support)
import React, { useState, useRef, useEffect } from 'react';
import { processImagesInBatch, isHeicFile } from './OptimizedImageHandler';
import { useAppState } from './StateContext';

/**
 * Efficient image uploader component for handling large batches including HEIC files
 */
const OptimizedImageUploader = ({ 
  onImagesProcessed, 
  autoRotateEnabled = false
}) => {
  const { state, dispatch } = useAppState();
  const { uploadStatus } = state;
  const { isUploading, uploadProgress, uploadTotal, uploadCompleted, uploadStage } = uploadStatus;
  
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  
  // Use a ref to track and potentially cancel ongoing processing
  const processingRef = useRef(null);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (processingRef.current && processingRef.current.cancel) {
        processingRef.current.cancel();
      }
    };
  }, []);
  
  /**
   * Check if files contain HEIC images and validate them
   */
  const validateFiles = (files) => {
    const validFiles = [];
    const invalidFiles = [];
    
    Array.from(files).forEach(file => {
      // Check if it's an image file (including HEIC)
      const isImage = file.type.startsWith('image/') || isHeicFile(file);
      
      // Check file size (reject files over 50MB to accommodate large HEIC files)
      const isValidSize = file.size <= 50 * 1024 * 1024;
      
      if (isImage && isValidSize) {
        validFiles.push(file);
      } else {
        invalidFiles.push({
          name: file.name,
          reason: !isImage ? 'Not an image file' : 'File too large (max 50MB)'
        });
      }
    });
    
    // Show warnings for invalid files
    if (invalidFiles.length > 0) {
      const warningMessage = invalidFiles
        .map(f => `${f.name}: ${f.reason}`)
        .join('\n');
      console.warn('Invalid files skipped:\n', warningMessage);
    }
    
    return validFiles;
  };
  
  /**
   * Process multiple images with progress tracking and HEIC support
   */
  const processImages = async (files) => {
    if (!files || files.length === 0) return;
    
    // Step 1: Validate files
    const validFiles = validateFiles(files);
    
    if (validFiles.length === 0) {
      alert('No valid image files found. Please select JPG, PNG, GIF, WEBP, or HEIC files under 50MB.');
      return;
    }
    
    // Check if there are HEIC files and warn user
    const heicFiles = validFiles.filter(isHeicFile);
    if (heicFiles.length > 0) {
      console.log(`Found ${heicFiles.length} HEIC files that will be converted to JPEG`);
    }
    
    // Update global state for upload status
    dispatch({ 
      type: 'SET_UPLOAD_STATUS', 
      payload: { 
        isUploading: true, 
        uploadProgress: 0, 
        uploadTotal: validFiles.length,
        uploadCompleted: 0,
        uploadStage: heicFiles.length > 0 ? 
          `Converting ${heicFiles.length} HEIC files and processing images...` : 
          'Processing images...'
      } 
    });
    
    try {
      // Store the processing operation in a ref for potential cancellation
      const processingOperation = {}; 
      processingRef.current = processingOperation;
      
      const { results, errors, stats } = await processImagesInBatch(validFiles, {
        maxWidth: 800,
        maxHeight: 800,
        quality: 0.75,
        autoRotate: autoRotateEnabled,
        toBase64: true,
        progressCallback: (progress) => {
          const stage = progress < 0.2 && heicFiles.length > 0 ? 
            'Converting HEIC files...' : 
            'Optimizing images...';
          
          dispatch({ 
            type: 'SET_UPLOAD_STATUS', 
            payload: { 
              uploadProgress: Math.round(progress * 100),
              uploadCompleted: Math.round(progress * validFiles.length),
              uploadStage: stage
            } 
          });
        }
      });
      
      // Call the parent component callback with the results
      onImagesProcessed(results, validFiles.filter((_, i) => i < stats.successful));
      
      // Display summary of processing
      let summaryMessage = `Successfully processed ${stats.successful} of ${stats.total} files`;
      if (stats.heicConverted > 0) {
        summaryMessage += ` (${stats.heicConverted} HEIC files converted)`;
      }
      if (errors.length > 0) {
        summaryMessage += `. ${errors.length} files failed to process.`;
        console.warn(`Processing errors:`, errors);
      }
      
      console.log(summaryMessage);
      
      // Show completed status for a moment
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadProgress: 100,
          uploadCompleted: validFiles.length,
          uploadStage: 'Upload complete!'
        } 
      });
      
      // Reset upload status after a delay
      setTimeout(() => {
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { 
            isUploading: false,
            uploadProgress: 0,
            uploadStage: ''
          } 
        });
      }, 1000);
      
    } catch (error) {
      console.error("Error processing images:", error);
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: `Error: ${error.message}`,
          uploadProgress: 0
        } 
      });
      
      // Reset status after showing error
      setTimeout(() => {
        dispatch({ 
          type: 'SET_UPLOAD_STATUS', 
          payload: { isUploading: false, uploadStage: '' } 
        });
      }, 3000);
    }
  };
  
  /**
   * Handle file input change
   */
  const handleFileChange = (e) => {
    processImages(e.target.files);
  };
  
  /**
   * Handle drag events
   */
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };
  
  /**
   * Handle file drop with HEIC support
   */
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith("image/") || isHeicFile(file)
    );
    
    if (droppedFiles.length > 0) {
      processImages(droppedFiles);
    }
  };
  
  /**
   * Trigger file input dialog
   */
  const triggerFileInput = () => {
    fileInputRef.current.click();
  };
  
  /**
   * Cancel ongoing processing
   */
  const cancelProcessing = () => {
    if (processingRef.current && processingRef.current.cancel) {
      processingRef.current.cancel();
      
      dispatch({ 
        type: 'SET_UPLOAD_STATUS', 
        payload: { 
          uploadStage: 'Cancelled',
          isUploading: false
        } 
      });
      
      setTimeout(() => {
        dispatch({ type: 'RESET_STATUS' });
      }, 1000);
    }
  };
  
  return (
    <div 
      className={`upload-area ${dragActive ? 'drag-active' : ''} ${isUploading ? 'is-uploading' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      onClick={!isUploading ? triggerFileInput : undefined}
    >
      {isUploading ? (
        <div className="upload-progress">
          <div className="upload-status">
            <p>{uploadStage} ({uploadCompleted}/{uploadTotal})</p>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
              <div className="progress-text">{uploadProgress}%</div>
            </div>
            <button 
              className="cancel-button" 
              onClick={cancelProcessing}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="upload-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </div>
          <p className="upload-text">Click or drag images to upload</p>
          <p className="upload-hint">Supports JPG, PNG, GIF, WEBP, HEIC • Max 50MB per file</p>
        </>
      )}
      <input 
        ref={fileInputRef} 
        type="file" 
        multiple 
        accept="image/*,.heic,.heif" 
        onChange={handleFileChange} 
        hidden 
      />
    </div>
  );
};

export default OptimizedImageUploader;