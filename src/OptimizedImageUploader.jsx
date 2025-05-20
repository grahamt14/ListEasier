// OptimizedImageUploader.jsx
import React, { useState, useRef, useEffect } from 'react';
import { processImagesInBatch } from './OptimizedImageHandler';

/**
 * Efficient image uploader component for handling large batches
 */
const OptimizedImageUploader = ({ 
  onImagesProcessed, 
  isUploading,
  setIsUploading,
  autoRotateEnabled = false
}) => {
  const [dragActive, setDragActive] = useState(false);
  const [totalFiles, setTotalFiles] = useState(0);
  const [processedFiles, setProcessedFiles] = useState(0);
  const [progress, setProgress] = useState(0);
  const [processingStage, setProcessingStage] = useState('');
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
   * Process multiple images with progress tracking
   */
  const processImages = async (files) => {
    if (!files || files.length === 0) return;
    
    setIsUploading(true);
    setTotalFiles(files.length);
    setProcessedFiles(0);
    setProgress(0);
    
    try {
      // Step 1: Quick validation pass
      setProcessingStage('Validating files...');
      const validFiles = Array.from(files).filter(file => {
        // Only process image files
        const isImage = file.type.startsWith('image/');
        
        // Check file size (reject files over 20MB)
        const isValidSize = file.size <= 20 * 1024 * 1024;
        
        return isImage && isValidSize;
      });
      
      if (validFiles.length === 0) {
        throw new Error('No valid image files found.');
      }
      
      setTotalFiles(validFiles.length);
      
      // Step 2: Process images in batches with efficient memory usage
      setProcessingStage('Processing images...');
      
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
          setProgress(Math.round(progress * 100));
          setProcessedFiles(Math.round(progress * validFiles.length));
        }
      });
      
      // Call the parent component callback with the results
      onImagesProcessed(results, validFiles.filter((_, i) => i < stats.successful));
      
      // Display summary of processing
      if (errors.length > 0) {
        console.warn(`${errors.length} of ${validFiles.length} files failed to process:`, errors);
        // Could show a more user-friendly error message here
      }
      
      // Wait a moment before hiding the progress indicator
      setTimeout(() => {
        setProcessingStage('');
        setIsUploading(false);
      }, 500);
      
    } catch (error) {
      console.error("Error processing images:", error);
      setProcessingStage('Error: ' + error.message);
      setTimeout(() => {
        setProcessingStage('');
        setIsUploading(false);
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
   * Handle file drop
   */
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      file => file.type.startsWith("image/")
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
      setProcessingStage('Cancelled');
      setTimeout(() => {
        setProcessingStage('');
        setIsUploading(false);
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
            <p>{processingStage} ({processedFiles}/{totalFiles})</p>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${progress}%` }}></div>
              <div className="progress-text">{progress}%</div>
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
          <p className="upload-hint">Supports JPG, PNG, GIF, WEBP • Max 20MB per file</p>
        </>
      )}
      <input 
        ref={fileInputRef} 
        type="file" 
        multiple 
        accept="image/*" 
        onChange={handleFileChange} 
        hidden 
      />
    </div>
  );
};

export default OptimizedImageUploader;