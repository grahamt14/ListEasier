// LoadingSpinner.jsx - Enhanced loading component for authentication states
import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ 
  message = "Loading...", 
  size = "large", 
  showLogo = true,
  className = "" 
}) => {
  return (
    <div className={`loading-container ${className}`}>
      <div className="loading-content">
        {showLogo && (
          <div className="loading-logo">
            <img src="/ListEasier.png" alt="ListEasier" className="logo-image" />
          </div>
        )}
        
        <div className={`loading-spinner ${size}`}>
          <div className="spinner-ring">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        </div>
        
        <div className="loading-message">
          <p className="primary-message">{message}</p>
          <p className="secondary-message">This should only take a moment...</p>
        </div>
        
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  );
};

// Alternative compact loading component
export const CompactSpinner = ({ message = "Loading..." }) => {
  return (
    <div className="compact-loading">
      <div className="compact-spinner">
        <div className="spinner-circle"></div>
      </div>
      <span className="compact-message">{message}</span>
    </div>
  );
};

// Inline loading component for buttons
export const ButtonSpinner = () => {
  return (
    <div className="button-spinner">
      <div className="button-spinner-circle"></div>
    </div>
  );
};

export default LoadingSpinner;