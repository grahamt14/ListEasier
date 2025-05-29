// LandingPage.jsx - Under Construction Landing Page for ListEasier
import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import './LandingPage.css';

const LandingPage = () => {
  const { loginWithRedirect, isLoading } = useAuth0();

  const handleLogin = () => {
    loginWithRedirect({
      appState: {
        returnTo: '/'
      }
    });
  };

  return (
    <div className="landing-page under-construction">
      {/* Header */}
      <header className="landing-header minimal">
        <div className="container">
          <div className="header-content">
            <div className="logo-section">
              <img src="/ListEasier.png" alt="ListEasier" className="logo" />
              <span className="logo-text">ListEasier</span>
            </div>
            <button 
              onClick={handleLogin}
              className="btn-secondary"
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'Login'}
            </button>
          </div>
        </div>
      </header>

      {/* Under Construction Section */}
      <section className="construction-section">
        <div className="container">
          <div className="construction-content">
            {/* Spinning Cog Wheel */}
            <div className="giant-cog-wrapper">
              <div className="giant-cog">
                <svg viewBox="0 0 200 200" className="cog-svg">
                  <path d="M100,30 L100,30 L110,40 L110,50 L120,50 L130,40 L130,30 L140,30 L140,40 L150,50 L150,60 L160,70 L170,70 L170,80 L160,90 L160,100 L170,110 L170,120 L160,130 L150,130 L150,140 L140,150 L140,160 L130,160 L130,170 L120,160 L110,160 L110,150 L100,150 L100,160 L90,160 L80,170 L70,170 L70,160 L60,150 L60,140 L50,130 L40,130 L30,120 L30,110 L40,100 L40,90 L30,80 L30,70 L40,70 L50,60 L50,50 L60,40 L70,40 L70,30 L80,30 L90,40 L90,50 L100,50 Z" 
                    fill="#007bff" 
                    stroke="#0056b3" 
                    strokeWidth="2"
                  />
                  <circle cx="100" cy="100" r="30" fill="#fff" stroke="#0056b3" strokeWidth="2"/>
                </svg>
              </div>
            </div>

            {/* Construction Text */}
            <h1 className="construction-title">Under Construction</h1>
            <p className="construction-subtitle">
              We're working hard to bring you the best eBay listing experience.
            </p>
            <p className="construction-message">
              Our platform will help you create listings 10x faster with AI-powered descriptions.
            </p>

            {/* Coming Soon Features */}
            <div className="coming-soon">
              <h3>Coming Soon:</h3>
              <ul className="feature-list">
                <li>🚀 Batch Processing Power</li>
                <li>🤖 AI-Generated Descriptions</li>
                <li>🔗 Direct eBay Integration</li>
                <li>📸 Smart Image Management</li>
              </ul>
            </div>

            {/* Login CTA */}
            <div className="construction-cta">
              <p>Already have an account?</p>
              <button 
                onClick={handleLogin}
                className="btn-primary large"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Login to Dashboard'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer minimal">
        <div className="container">
          <div className="footer-bottom">
            <p>&copy; 2024 ListEasier. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;