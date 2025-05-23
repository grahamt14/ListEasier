// TesseractRotate.jsx (Updated with HEIC Support)
import { useEffect, useState } from 'react';
import { isHeicFile, convertHeicToJpeg } from './OptimizedImageHandler';

// Enhanced image rotation function that prevents black borders and maintains aspect ratio
export const rotateImage = (base64Img, degrees) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Convert degrees to radians for calculations
      const radians = (degrees * Math.PI) / 180;
      
      // Calculate new dimensions to prevent cropping
      // For any rotation angle, we need to find the bounding box dimensions
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      
      // New width and height to contain the entire image after rotation
      const newWidth = Math.round(img.width * cos + img.height * sin);
      const newHeight = Math.round(img.width * sin + img.height * cos);
      
      // Set canvas dimensions to new calculated size
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      // Clear the canvas (important for transparency)
      ctx.fillStyle = "rgba(255, 255, 255, 0)";
      ctx.fillRect(0, 0, newWidth, newHeight);
      
      // Move to center of canvas
      ctx.translate(newWidth / 2, newHeight / 2);
      
      // Rotate the canvas
      ctx.rotate(radians);
      
      // Draw the image at the correct position
      ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
      
      // Get image type from base64
      const imageType = base64Img.split(';')[0].split(':')[1] || 'image/jpeg';
      
      // Preserve original image quality
      resolve(canvas.toDataURL(imageType, 1.0));
    };
    
    img.onerror = (err) => reject(err);
    img.src = base64Img;
  });
};

// Enhanced Tesseract auto-rotation function with better error handling and HEIC support
export const autoRotateWithTesseract = async (base64Img) => {
  // Skip Tesseract if the module is not available
  let Tesseract;
  try {
    const TesseractModule = await import('tesseract.js');
    Tesseract = TesseractModule.default || TesseractModule;
    console.log("Tesseract module loaded successfully");
  } catch (importError) {
    console.error("Tesseract import failed:", importError);
    return base64Img; // Return original image if import fails
  }
  
  try {
    console.log("Starting Tesseract orientation detection...");
    
    // Create worker with safer settings
    const worker = await Tesseract.createWorker({
      logger: m => console.log(`Tesseract [${m.status}]: ${m.progress?.toFixed(2) || 0}`),
    });
    
    // Configure worker specifically for orientation detection only
    await worker.setParameters({
      tessedit_ocr_engine_mode: 1, // LSTM only mode
      tessedit_pageseg_mode: 0,    // OSD only
    });
    
    console.log("Tesseract worker initialized, detecting orientation...");
    
    // Use a longer timeout for Tesseract (10 seconds)
    const recognizePromise = worker.recognize(base64Img);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Tesseract detection timed out")), 10000);
    });
    
    // Race between recognition and timeout
    const result = await Promise.race([recognizePromise, timeoutPromise]);
    
    // Attempt to extract rotation information
    let rotation = 0;
    if (result?.data?.orientation) {
      rotation = result.data.orientation.degrees;
      console.log(`Tesseract detected rotation angle: ${rotation}°`);
    } else if (result?.data?.rotate) {
      rotation = result.data.rotate;
      console.log(`Tesseract detected rotation angle (legacy): ${rotation}°`);
    } else if (result?.data?.osd?.rotate) {
      rotation = result.data.osd.rotate;
      console.log(`Tesseract detected OSD rotation angle: ${rotation}°`);
    } else {
      console.log("No rotation data detected in Tesseract response");
    }
    
    // Always terminate the worker
    await worker.terminate();
    
    // Only rotate if necessary (non-zero rotation detected)
    if (rotation !== 0) {
      console.log(`Applying Tesseract rotation of ${rotation}°`);
      return await rotateImage(base64Img, rotation);
    }
    
    console.log("No rotation needed according to Tesseract");
    return base64Img;
  } catch (error) {
    console.error("Error in Tesseract processing:", error);
    return base64Img; // Return original image if processing fails
  }
};

// Improved heuristic-based orientation detection
export const detectRotationWithHeuristics = async (base64Img) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      try {
        console.log("Running heuristic orientation detection...");
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Set canvas dimensions to match image
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw the image on the canvas
        ctx.drawImage(img, 0, 0);
        
        // Get image data for analysis
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Analyze quarters of the image for more robust detection
        const topQuarter = analyzeImageSection(data, canvas.width, 0, Math.floor(canvas.height * 0.25), canvas.width);
        const bottomQuarter = analyzeImageSection(data, canvas.width, Math.floor(canvas.height * 0.75), canvas.height, canvas.width);
        const leftQuarter = analyzeImageSectionVertical(data, canvas.width, 0, Math.floor(canvas.width * 0.25), canvas.height);
        const rightQuarter = analyzeImageSectionVertical(data, canvas.width, Math.floor(canvas.width * 0.75), canvas.width, canvas.height);
        
        console.log("Heuristic brightness analysis:", {
          topQuarter,
          bottomQuarter,
          leftQuarter,
          rightQuarter
        });
        
        // Check for possible rotations based on brightness distribution
        if (bottomQuarter > topQuarter * 1.5) {
          console.log("Heuristic suggests image is upside down, rotating 180°");
          rotateImage(base64Img, 180).then(resolve).catch(() => resolve(base64Img));
        } else if (leftQuarter > rightQuarter * 1.5) {
          console.log("Heuristic suggests image is rotated 90° right, rotating left");
          rotateImage(base64Img, 270).then(resolve).catch(() => resolve(base64Img));
        } else if (rightQuarter > leftQuarter * 1.5) {
          console.log("Heuristic suggests image is rotated 90° left, rotating right");
          rotateImage(base64Img, 90).then(resolve).catch(() => resolve(base64Img));
        } else {
          console.log("No clear rotation detected using heuristics");
          resolve(base64Img);
        }
      } catch (err) {
        console.error("Error in heuristic analysis:", err);
        resolve(base64Img); // Return original image on error
      }
    };
    
    img.onerror = () => {
      console.error("Failed to load image for heuristic analysis");
      resolve(base64Img); // Return original image on error
    };
    
    img.src = base64Img;
  });
};

// Enhanced image section analysis for horizontal sections
const analyzeImageSection = (data, width, startY, endY, sectionWidth) => {
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < sectionWidth; x++) {
      const idx = (y * width + x) * 4;
      // Calculate perceived brightness using weighted formula
      const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      totalBrightness += brightness;
      pixelCount++;
    }
  }
  
  return pixelCount > 0 ? totalBrightness / pixelCount : 0;
};

// Function to analyze vertical sections
const analyzeImageSectionVertical = (data, width, startX, endX, sectionHeight) => {
  let totalBrightness = 0;
  let pixelCount = 0;
  
  for (let x = startX; x < endX; x++) {
    for (let y = 0; y < sectionHeight; y++) {
      const idx = (y * width + x) * 4;
      // Calculate perceived brightness using weighted formula
      const brightness = (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
      totalBrightness += brightness;
      pixelCount++;
    }
  }
  
  return pixelCount > 0 ? totalBrightness / pixelCount : 0;
};

// Combined image processing function with better error handling, diagnostic logging, and HEIC support
export const processImage = async (file, autoRotateEnabled) => {
  try {
    console.log(`Processing file: ${file.name} (${file.size} bytes, type: ${file.type})`);
    
    // Step 1: Handle HEIC conversion if needed
    let processedFile = file;
    if (isHeicFile(file)) {
      console.log("HEIC file detected, converting to JPEG...");
      try {
        processedFile = await convertHeicToJpeg(file);
        console.log(`HEIC conversion complete: ${processedFile.name}`);
      } catch (heicError) {
        console.error("HEIC conversion failed:", heicError);
        // Continue with original file if conversion fails
        processedFile = file;
      }
    }
    
    // Step 2: Convert to base64
    console.log("Converting to base64...");
    const base64 = await convertToBase64(processedFile);
    console.log("Base64 conversion complete");
    
    // Only perform auto-rotation if enabled by user
    if (autoRotateEnabled) {
      // Step 3: Try enhanced heuristic approach first
      console.log("Running heuristic orientation detection...");
      let processedImage = await detectRotationWithHeuristics(base64);
      let rotationApplied = processedImage !== base64;
      console.log(`Heuristic detection ${rotationApplied ? 'applied rotation' : 'detected no rotation'}`);
      
      // Step 4: Determine if we should attempt Tesseract processing
      const fileSize = processedFile.size;
      const fileName = processedFile.name.toLowerCase();
      
      const isLikelyDocument = 
        fileSize < 2000000 && // Smaller files are more likely to be document scans
        (fileName.includes('doc') || 
         fileName.includes('receipt') || 
         fileName.includes('scan') || 
         fileName.includes('text') || 
         fileName.includes('page') ||
         fileName.includes('statement') ||
         fileName.includes('invoice'));
      
      // If it's likely a document and no rotation was applied yet, try Tesseract
      if (isLikelyDocument && !rotationApplied) {
        try {
          console.log("File looks like it might contain text, attempting Tesseract...");
          const tesseractResult = await autoRotateWithTesseract(processedImage);
          
          if (tesseractResult !== processedImage) {
            console.log("Tesseract successfully applied rotation");
            processedImage = tesseractResult;
          } else {
            console.log("Tesseract did not detect any needed rotation");
          }
        } catch (tesseractError) {
          console.error("Tesseract processing error:", tesseractError);
          // Continue with our current image if Tesseract fails
        }
      }
      
      return processedImage;
    } else {
      // Skip auto-rotation if disabled
      console.log("Auto-rotation is disabled, returning original image");
      return base64;
    }
  } catch (error) {
    console.error(`Error processing file ${file.name}:`, error);
    // Convert to base64 as fallback if processing fails
    try {
      // If original file failed, try with the processed file (in case HEIC conversion worked)
      const fallbackFile = processedFile || file;
      return await convertToBase64(fallbackFile);
    } catch (fallbackError) {
      console.error("Fallback conversion failed:", fallbackError);
      throw new Error(`Unable to process image: ${fallbackError.message}`);
    }
  }
};

// Convert image to base64 with HEIC support
export const convertToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    // Handle HEIC files first if needed
    const processFile = async (inputFile) => {
      let fileToProcess = inputFile;
      
      // Convert HEIC to JPEG if needed
      if (isHeicFile(inputFile)) {
        try {
          console.log("Converting HEIC file in convertToBase64...");
          fileToProcess = await convertHeicToJpeg(inputFile);
        } catch (heicError) {
          console.warn("HEIC conversion failed in convertToBase64, using original:", heicError);
          fileToProcess = inputFile;
        }
      }
      
      const img = new Image();
      img.onload = () => {
        const maxWidth = 800;
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.floor(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        
        // Always output as JPEG for consistency, regardless of input format
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = (err) => reject(err);
      img.src = URL.createObjectURL(fileToProcess);
    };
    
    processFile(file).catch(reject);
  });
};

export default {
  rotateImage,
  autoRotateWithTesseract,
  detectRotationWithHeuristics,
  processImage,
  convertToBase64
};