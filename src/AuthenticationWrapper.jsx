// AuthenticationWrapper.jsx - Handles authentication state and routing
import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import LandingPage from './LandingPage';
import LoadingSpinner from './LoadingSpinner';

const AuthenticationWrapper = ({ children }) => {
  const { 
    isLoading, 
    isAuthenticated, 
    error, 
    user,
    loginWithRedirect 
  } = useAuth0();
  
  const [appInitialized, setAppInitialized] = useState(false);
  const [authError, setAuthError] = useState(null);

  // Handle URL parameters for auth feedback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ebayConnected = urlParams.get('ebay_connected');
    const ebayError = urlParams.get('ebay_error');
    
    if (ebayConnected === 'true') {
      // Show success message for eBay connection
      setTimeout(() => {
        const successMsg = document.createElement('div');
        successMsg.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #10b981;
          color: white;
          padding: 16px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 10000;
          font-weight: 500;
        `;
        successMsg.textContent = '✅ eBay account connected successfully!';
        document.body.appendChild(successMsg);
        
        setTimeout(() => {
          if (document.body.contains(successMsg)) {
            document.body.removeChild(successMsg);
          }
        }, 5000);
        
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 500);
    }
    
    if (ebayError) {
      const errorMessage = decodeURIComponent(ebayError);
      setAuthError(`eBay Integration Error: ${errorMessage}`);
      
      // Clean URL after showing error
      setTimeout(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setAuthError(null);
      }, 8000);
    }
  }, []);

  // Initialize app after authentication check completes
  useEffect(() => {
    if (!isLoading) {
      // Add a small delay to ensure smooth transition
      const timer = setTimeout(() => {
        setAppInitialized(true);
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  // Handle authentication errors
  useEffect(() => {
    if (error) {
      console.error('Auth0 Error:', error);
      setAuthError(error.message || 'Authentication failed. Please try again.');
    }
  }, [error]);

  // Show loading spinner while Auth0 is initializing
  if (isLoading || !appInitialized) {
    return (
      <div className="auth-loading-container">
        <LoadingSpinner message="Initializing ListEasier..." />
      </div>
    );
  }

  // Show error state
  if (authError) {
    return (
      <div className="auth-error-container">
        <div className="auth-error-content">
          <div className="error-icon">⚠️</div>
          <h2>Authentication Error</h2>
          <p>{authError}</p>
          <div className="error-actions">
            <button 
              onClick={() => {
                setAuthError(null);
                if (!isAuthenticated) {
                  loginWithRedirect();
                }
              }}
              className="btn-primary"
            >
              {isAuthenticated ? 'Continue to App' : 'Try Again'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show landing page for unauthenticated users
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  // Show main application for authenticated users
  return (
    <div className="authenticated-app">
      {/* Optional: Welcome message for first-time users */}
      {user && (
        <WelcomeMessage user={user} />
      )}
      {children}
    </div>
  );
};

// Welcome message component for new users
const WelcomeMessage = ({ user }) => {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    // Check if this is a new user (you can implement your own logic)
    const isNewUser = !localStorage.getItem('listeasier_user_welcomed');
    
    if (isNewUser && user) {
      setShowWelcome(true);
      localStorage.setItem('listeasier_user_welcomed', 'true');
    }
  }, [user]);

  if (!showWelcome) return null;

  return (
    <div className="welcome-overlay">
      <div className="welcome-modal">
        <div className="welcome-header">
          <h2>Welcome to ListEasier, {user.given_name || user.name}! 🎉</h2>
          <button 
            onClick={() => setShowWelcome(false)}
            className="welcome-close"
          >
            ×
          </button>
        </div>
        <div className="welcome-content">
          <p>You're all set to start creating amazing eBay listings!</p>
          <div className="welcome-features">
            <div className="welcome-feature">
              <span className="feature-icon">📦</span>
              <span>Create your first batch to get started</span>
            </div>
            <div className="welcome-feature">
              <span className="feature-icon">🤖</span>
              <span>Let AI generate professional descriptions</span>
            </div>
            <div className="welcome-feature">
              <span className="feature-icon">🔗</span>
              <span>Connect your eBay account for direct publishing</span>
            </div>
          </div>
          <button 
            onClick={() => setShowWelcome(false)}
            className="btn-primary"
          >
            Let's Get Started!
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthenticationWrapper;