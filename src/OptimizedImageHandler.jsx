// OptimizedImageHandler.js
import imageCompression from 'browser-image-compression'; // Recommended to add this dependency

/**
 * Worker-based image processing 
 * 
 * This creates a dedicated worker for image processing to avoid blocking the main thread
 */
export const createImageProcessingWorker = () => {
  const workerCode = `
    self.onmessage = async function(e) {
      const { file, operation, options } = e.data;
      
      try {
        let result;
        
        if (operation === 'compress') {
          // Basic compression implementation within the worker
          const img = await createImageBitmap(file);
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          
          // Draw image to canvas
          ctx.drawImage(img, 0, 0);
          
          // Get compressed blob with reduced quality
          const blob = await canvas.convertToBlob({ 
            type: file.type, 
            quality: options.quality || 0.8 
          });
          
          // Convert blob to base64 if needed
          if (options.toBase64) {
            const reader = new FileReader();
            result = await new Promise((resolve) => {
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } else {
            result = URL.createObjectURL(blob);
          }
        } else if (operation === 'rotate') {
          const angle = options.angle || 90;
          const img = await createImageBitmap(file);
          
          // Calculate new dimensions
          const radians = (angle * Math.PI) / 180;
          const cos = Math.abs(Math.cos(radians));
          const sin = Math.abs(Math.sin(radians));
          const newWidth = Math.round(img.width * cos + img.height * sin);
          const newHeight = Math.round(img.width * sin + img.height * cos);
          
          // Create canvas with new dimensions
          const canvas = new OffscreenCanvas(newWidth, newHeight);
          const ctx = canvas.getContext('2d');
          
          // Move to center of canvas
          ctx.translate(newWidth / 2, newHeight / 2);
          
          // Rotate the canvas
          ctx.rotate(radians);
          
          // Draw the image
          ctx.drawImage(img, -img.width / 2, -img.height / 2);
          
          // Convert to blob
          const blob = await canvas.convertToBlob({ 
            type: file.type 
          });
          
          // Convert to base64 if needed
          if (options.toBase64) {
            const reader = new FileReader();
            result = await new Promise((resolve) => {
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } else {
            result = URL.createObjectURL(blob);
          }
        }
        
        self.postMessage({ 
          success: true, 
          result, 
          originalName: file.name,
          originalSize: file.size,
          operation
        });
      } catch (error) {
        self.postMessage({ 
          success: false, 
          error: error.message, 
          originalName: file.name,
          operation
        });
      }
    };
  `;
  
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return new Worker(URL.createObjectURL(blob));
};

/**
 * Optimized image processing function that uses batch operations and workers
 * @param {Array} files - Array of files to process
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} - Array of processed image results
 */
export const processImagesInBatch = async (files, options = {}) => {
  const {
    maxWidth = 800,
    maxHeight = 800,
    quality = 0.8,
    maxWorkers = navigator.hardwareConcurrency || 4,
    autoRotate = false,
    toBase64 = true,
    progressCallback = () => {},
  } = options;
  
  // Create a pool of workers based on CPU cores
  const workerPool = Array.from({ length: Math.min(files.length, maxWorkers) }, () => 
    createImageProcessingWorker()
  );
  
  // Image compression options
  const compressionOptions = {
    maxSizeMB: 1,
    maxWidthOrHeight: Math.max(maxWidth, maxHeight),
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: quality,
  };
  
  // Process up to maxWorkers files at once for better parallelization
  const results = new Array(files.length).fill(null);
  const errors = [];
  let completed = 0;
  
  // Process in batches based on worker count
  const batchSize = Math.max(1, Math.ceil(files.length / maxWorkers));
  const batches = [];
  
  for (let i = 0; i < files.length; i += batchSize) {
    const batchFiles = Array.from(files)
      .slice(i, i + batchSize)
      .map((file, batchIndex) => ({
        file,
        index: i + batchIndex,
        worker: workerPool[Math.floor(i / batchSize) % workerPool.length],
      }));
    
    batches.push(batchFiles);
  }
  
  // Process all batches in parallel
  await Promise.all(batches.map(async (batch) => {
    return Promise.all(
      batch.map(async ({ file, index, worker }) => {
        try {
          // Skip compression for small images
          let compressedFile;
          if (file.size <= 100 * 1024) { // 100KB
            compressedFile = file;
          } else {
            try {
              // Use the browser-image-compression library
              compressedFile = await imageCompression(file, compressionOptions);
            } catch (compressionError) {
              console.warn('Compression failed, using original file:', compressionError);
              compressedFile = file;
            }
          }
          
          // Convert to base64 or URL
          let processedImage;
          if (toBase64) {
            processedImage = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
              reader.readAsDataURL(compressedFile);
            });
          } else {
            processedImage = URL.createObjectURL(compressedFile);
          }
          
          results[index] = processedImage;
          completed++;
          progressCallback(completed / files.length);
          return { success: true, index };
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          errors.push({ name: file.name, error: error.message });
          results[index] = null;
          completed++;
          progressCallback(completed / files.length);
          return { success: false, index, error };
        }
      })
    );
  }));
  
  // Clean up workers
  workerPool.forEach(worker => worker.terminate());
  
  return {
    results: results.filter(Boolean),
    errors,
    stats: {
      total: files.length,
      successful: results.filter(Boolean).length,
      failed: errors.length
    }
  };
};

/**
 * Smart detection for image orientation that only uses necessary methods
 * @param {Blob} file - Image file
 * @returns {Promise<number>} - Detected rotation angle
 */
export const detectImageOrientation = async (file) => {
  // Check if file has EXIF orientation data first (fastest method)
  try {
    const arrayBuffer = await file.arrayBuffer();
    const exifData = await extractExifOrientation(arrayBuffer);
    
    if (exifData !== null) {
      // Map EXIF orientation values to rotation angles
      const orientationMap = {
        1: 0,    // Normal
        3: 180,  // Upside down
        6: 90,   // 90° clockwise
        8: 270   // 90° counterclockwise
      };
      
      return orientationMap[exifData] || 0;
    }
  } catch (exifError) {
    console.warn('EXIF extraction error:', exifError);
  }
  
  // For certain formats that might contain text (like PDFs or scans)
  // we can use a lightweight heuristic approach instead of full OCR
  try {
    // Only analyze small, document-like files
    if (file.size < 1000000 && 
        (file.name.toLowerCase().includes('scan') || 
         file.type.includes('pdf'))) {
      return await analyzeImageOrientation(file);
    }
  } catch (error) {
    console.warn('Orientation analysis error:', error);
  }
  
  // Default to no rotation if we couldn't detect orientation
  return 0;
};

/**
 * Extract EXIF orientation from image file
 * @param {ArrayBuffer} arrayBuffer - Image data as ArrayBuffer
 * @returns {Promise<number|null>} - EXIF orientation or null
 */
const extractExifOrientation = (arrayBuffer) => {
  return new Promise((resolve) => {
    // Simplified EXIF parser focusing only on orientation
    // This is much faster than loading the full image
    
    const dataView = new DataView(arrayBuffer);
    let offset = 0;
    
    // Check for JPEG SOI marker
    if (dataView.getUint16(0) !== 0xFFD8) {
      return resolve(null); // Not a JPEG
    }
    
    const length = dataView.byteLength;
    
    while (offset < length) {
      const marker = dataView.getUint16(offset, false);
      offset += 2;
      
      // Check for EXIF APP1 marker
      if (marker === 0xFFE1) {
        const exifIDCode = getStringFromDataView(dataView, offset+2, 4);
        
        if (exifIDCode === 'Exif') {
          const tiffOffset = offset + 6;
          
          // Determine byte alignment
          const bigEndian = dataView.getUint16(tiffOffset) === 0x4D4D;
          const firstIFDOffset = dataView.getUint32(tiffOffset + 4, !bigEndian);
          
          // Go to first IFD
          const IFDOffset = tiffOffset + firstIFDOffset;
          const numEntries = dataView.getUint16(IFDOffset, !bigEndian);
          
          // Scan IFD entries for orientation tag (0x0112)
          for (let i = 0; i < numEntries; i++) {
            const entryOffset = IFDOffset + 2 + (i * 12);
            const tagNumber = dataView.getUint16(entryOffset, !bigEndian);
            
            if (tagNumber === 0x0112) { // Orientation tag
              const dataOffset = entryOffset + 8;
              return resolve(dataView.getUint16(dataOffset, !bigEndian));
            }
          }
        }
      }
      
      // Move to next marker if no EXIF
      if (marker < 0xFF00 || marker > 0xFFFF) {
        break; // Not a valid marker
      }
      
      offset += dataView.getUint16(offset, false);
    }
    
    resolve(null); // No orientation found
  });
};

/**
 * Helper to extract string from DataView
 */
const getStringFromDataView = (dataView, offset, length) => {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(dataView.getUint8(offset + i));
  }
  return str;
};

/**
 * Lightweight image orientation analysis using edge detection
 * @param {File} file - Image file to analyze
 * @returns {Promise<number>} - Detected rotation angle
 */
const analyzeImageOrientation = (file) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        // Use a small version of the image for faster analysis
        const canvas = document.createElement('canvas');
        const maxAnalysisDimension = 300; // Small size for quick analysis
        
        const scale = Math.min(1, maxAnalysisDimension / Math.max(img.width, img.height));
        const width = Math.floor(img.width * scale);
        const height = Math.floor(img.height * scale);
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Get image data and analyze edges
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        
        // Simple analysis of horizontal vs vertical edge strength
        let horizontalEdgeStrength = 0;
        let verticalEdgeStrength = 0;
        
        // Only analyze border regions (faster than full image)
        const borderWidth = Math.max(5, Math.floor(width * 0.1));
        const borderHeight = Math.max(5, Math.floor(height * 0.1));
        
        // Top border
        for (let y = 0; y < borderHeight; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const nextRowIdx = ((y+1) * width + x) * 4;
            
            if (y < height - 1) {
              const diff = Math.abs(data[idx] - data[nextRowIdx]) + 
                          Math.abs(data[idx+1] - data[nextRowIdx+1]) + 
                          Math.abs(data[idx+2] - data[nextRowIdx+2]);
              horizontalEdgeStrength += diff;
            }
          }
        }
        
        // Bottom border
        for (let y = height - borderHeight; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const nextRowIdx = ((y-1) * width + x) * 4;
            
            if (y > 0) {
              const diff = Math.abs(data[idx] - data[nextRowIdx]) + 
                          Math.abs(data[idx+1] - data[nextRowIdx+1]) + 
                          Math.abs(data[idx+2] - data[nextRowIdx+2]);
              horizontalEdgeStrength += diff;
            }
          }
        }
        
        // Left border
        for (let x = 0; x < borderWidth; x++) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + x) * 4;
            const nextColIdx = (y * width + (x+1)) * 4;
            
            if (x < width - 1) {
              const diff = Math.abs(data[idx] - data[nextColIdx]) + 
                          Math.abs(data[idx+1] - data[nextColIdx+1]) + 
                          Math.abs(data[idx+2] - data[nextColIdx+2]);
              verticalEdgeStrength += diff;
            }
          }
        }
        
        // Right border
        for (let x = width - borderWidth; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const idx = (y * width + x) * 4;
            const nextColIdx = (y * width + (x-1)) * 4;
            
            if (x > 0) {
              const diff = Math.abs(data[idx] - data[nextColIdx]) + 
                          Math.abs(data[idx+1] - data[nextColIdx+1]) + 
                          Math.abs(data[idx+2] - data[nextColIdx+2]);
              verticalEdgeStrength += diff;
            }
          }
        }
        
        // Normalize by border area
        horizontalEdgeStrength /= (borderHeight * width * 2);
        verticalEdgeStrength /= (borderWidth * height * 2);
        
        // Simple decision logic for orientation
        const ratio = verticalEdgeStrength / horizontalEdgeStrength;
        
        if (ratio > 1.5) {
          // Much stronger vertical edges - likely rotated 90 or 270 degrees
          // Additional analysis to determine which one
          const topBrightness = analyzeRegionBrightness(data, width, 0, Math.floor(height/2), width);
          const bottomBrightness = analyzeRegionBrightness(data, width, Math.floor(height/2), height, width);
          
          if (topBrightness > bottomBrightness * 1.2) {
            resolve(270); // 90° counterclockwise
          } else if (bottomBrightness > topBrightness * 1.2) {
            resolve(90);  // 90° clockwise
          } else {
            resolve(0);   // No clear direction
          }
        } else if (ratio < 0.67) {
          // Much stronger horizontal edges - could be upside down or normal
          const leftBrightness = analyzeRegionBrightness(data, width, 0, height, Math.floor(width/2));
          const rightBrightness = analyzeRegionBrightness(data, width, 0, height, Math.floor(width/2), width);
          
          if (leftBrightness > rightBrightness * 1.2) {
            resolve(180); // Upside down
          } else {
            resolve(0);   // Normal
          }
        } else {
          resolve(0);     // No clear orientation
        }
      } catch (err) {
        resolve(0); // Default to no rotation on error
      }
    };
    
    img.onerror = () => {
      resolve(0); // Default to no rotation on error
    };
    
    img.src = URL.createObjectURL(file);
  });
};

/**
 * Helper function to calculate brightness in a region
 */
const analyzeRegionBrightness = (data, width, startY, endY, startX = 0, endX = null) => {
  endX = endX || width;
  
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 4;
      // Calculate perceived brightness
      const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      totalBrightness += brightness;
      pixelCount++;
    }
  }
  
  return pixelCount > 0 ? totalBrightness / pixelCount : 0;
};

export default {
  processImagesInBatch,
  detectImageOrientation,
  createImageProcessingWorker
};