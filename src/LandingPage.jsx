// LandingPage.jsx - Professional Landing Page for ListEasier
import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import './LandingPage.css';

const LandingPage = () => {
  const { loginWithRedirect, isLoading } = useAuth0();
  const [showPricing, setShowPricing] = useState(false);

  const handleLogin = () => {
    loginWithRedirect({
      appState: {
        returnTo: '/'
      }
    });
  };

  const handleSignUp = () => {
    loginWithRedirect({
      appState: {
        returnTo: '/'
      },
      authorizationParams: {
        screen_hint: 'signup'
      }
    });
  };

  const features = [
    {
      icon: "🚀",
      title: "Batch Processing Power",
      description: "Process hundreds of listings at once. Upload images in bulk, set categories, and generate listings automatically."
    },
    {
      icon: "🤖", 
      title: "AI-Generated Descriptions",
      description: "Our AI analyzes your product images and creates compelling, SEO-optimized descriptions that sell."
    },
    {
      icon: "🔗",
      title: "Direct eBay Integration", 
      description: "Create listings directly on eBay or download CSV files. Supports business policies and multiple marketplaces."
    },
    {
      icon: "📸",
      title: "Smart Image Management",
      description: "Drag-and-drop image organization, automatic resizing, HEIC conversion, and rotation tools."
    },
    {
      icon: "📊",
      title: "Category Intelligence",
      description: "Auto-detect eBay categories and fill category-specific fields using AI image analysis."
    },
    {
      icon: "💾",
      title: "Cloud Storage & Sync",
      description: "Your listings are safely stored in the cloud and accessible from anywhere."
    }
  ];

  const benefits = [
    "Save 10+ hours per week on listing creation",
    "Increase listing quality with AI descriptions", 
    "Reduce listing errors with smart validation",
    "Scale your eBay business efficiently",
    "Professional listings that convert better"
  ];

  const testimonials = [
    {
      name: "Sarah Johnson",
      role: "eBay Power Seller",
      text: "ListEasier transformed my business. I went from 2-3 listings per day to 50+ listings in the same time.",
      avatar: "👩‍💼"
    },
    {
      name: "Mike Chen", 
      role: "Electronics Reseller",
      text: "The AI descriptions are incredibly accurate. My conversion rate increased by 40% since using ListEasier.",
      avatar: "👨‍💻"
    },
    {
      name: "Jessica Rodriguez",
      role: "Fashion Boutique Owner", 
      text: "Batch processing is a game-changer. I can process an entire shipment in minutes instead of hours.",
      avatar: "👩‍🎨"
    }
  ];

  return (
    <div className="landing-page">
      {/* Header */}
      <header className="landing-header">
        <div className="container">
          <div className="header-content">
            <div className="logo-section">
              <img src="/ListEasier.png" alt="ListEasier" className="logo" />
              <span className="logo-text">ListEasier</span>
            </div>
            <nav className="nav-menu">
              <a href="#features" className="nav-link">Features</a>
              <a href="#pricing" className="nav-link" onClick={() => setShowPricing(true)}>Pricing</a>
              <a href="#testimonials" className="nav-link">Reviews</a>
              <button 
                onClick={handleLogin}
                className="btn-secondary"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Login'}
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="container">
          <div className="hero-content">
            <div className="hero-text">
              <h1 className="hero-title">
                Create eBay Listings 
                <span className="highlight"> 10x Faster</span>
              </h1>
              <p className="hero-subtitle">
                The only eBay listing tool you'll ever need. Batch process images, 
                generate AI descriptions, and create professional listings in minutes.
              </p>
              <div className="hero-cta">
                <button 
                  onClick={handleSignUp}
                  className="btn-primary large"
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : 'Start Free Trial'}
                </button>
                <button 
                  onClick={handleLogin}
                  className="btn-outline large"
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : 'Watch Demo'}
                </button>
              </div>
              <div className="hero-proof">
                <div className="proof-stats">
                  <div className="stat">
                    <span className="stat-number">10,000+</span>
                    <span className="stat-label">Listings Created</span>
                  </div>
                  <div className="stat">
                    <span className="stat-number">500+</span>
                    <span className="stat-label">Happy Sellers</span>
                  </div>
                  <div className="stat">
                    <span className="stat-number">40%</span>
                    <span className="stat-label">Higher Conversion</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="hero-image">
              <div className="hero-demo">
                <div className="demo-window">
                  <div className="demo-header">
                    <div className="demo-dots">
                      <span></span><span></span><span></span>
                    </div>
                    <div className="demo-title">ListEasier Dashboard</div>
                  </div>
                  <div className="demo-content">
                    <div className="demo-batch">
                      <div className="batch-item">
                        <div className="batch-icon">📱</div>
                        <div className="batch-info">
                          <div className="batch-name">Electronics Batch</div>
                          <div className="batch-status">45 listings ready</div>
                        </div>
                        <div className="batch-action">✅</div>
                      </div>
                      <div className="batch-item">
                        <div className="batch-icon">👕</div>
                        <div className="batch-info">
                          <div className="batch-name">Clothing Batch</div>
                          <div className="batch-status">Processing...</div>
                        </div>
                        <div className="batch-action">⏳</div>
                      </div>
                      <div className="batch-item">
                        <div className="batch-icon">🏠</div>
                        <div className="batch-info">
                          <div className="batch-name">Home & Garden</div>
                          <div className="batch-status">23 listings ready</div>
                        </div>
                        <div className="batch-action">✅</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="features-section">
        <div className="container">
          <div className="section-header">
            <h2>Everything You Need to Scale Your eBay Business</h2>
            <p>Powerful tools designed specifically for serious eBay sellers</p>
          </div>
          <div className="features-grid">
            {features.map((feature, index) => (
              <div key={index} className="feature-card">
                <div className="feature-icon">{feature.icon}</div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="benefits-section">
        <div className="container">
          <div className="benefits-content">
            <div className="benefits-text">
              <h2>Why Choose ListEasier?</h2>
              <ul className="benefits-list">
                {benefits.map((benefit, index) => (
                  <li key={index} className="benefit-item">
                    <span className="benefit-check">✅</span>
                    <span className="benefit-text">{benefit}</span>
                  </li>
                ))}
              </ul>
              <button 
                onClick={handleSignUp}
                className="btn-primary"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Get Started Now'}
              </button>
            </div>
            <div className="benefits-visual">
              <div className="workflow-demo">
                <div className="workflow-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>Upload Images</h4>
                    <p>Drag & drop your product photos</p>
                  </div>
                </div>
                <div className="workflow-arrow">→</div>
                <div className="workflow-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>AI Processing</h4>
                    <p>Generate titles & descriptions</p>
                  </div>
                </div>
                <div className="workflow-arrow">→</div>
                <div className="workflow-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>Publish</h4>
                    <p>Direct to eBay or download CSV</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="testimonials-section">
        <div className="container">
          <div className="section-header">
            <h2>Trusted by Successful eBay Sellers</h2>
            <p>See what our users are saying about ListEasier</p>
          </div>
          <div className="testimonials-grid">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="testimonial-card">
                <div className="testimonial-content">
                  <p className="testimonial-text">"{testimonial.text}"</p>
                  <div className="testimonial-author">
                    <div className="author-avatar">{testimonial.avatar}</div>
                    <div className="author-info">
                      <div className="author-name">{testimonial.name}</div>
                      <div className="author-role">{testimonial.role}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2>Ready to Transform Your eBay Business?</h2>
            <p>Join thousands of sellers who've already scaled their operations with ListEasier</p>
            <div className="cta-buttons">
              <button 
                onClick={handleSignUp}
                className="btn-primary large"
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Start Your Free Trial'}
              </button>
              <div className="cta-note">
                <small>No credit card required • 14-day free trial • Cancel anytime</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <img src="/ListEasier.png" alt="ListEasier" className="footer-logo" />
              <p>The fastest way to create professional eBay listings</p>
            </div>
            <div className="footer-links">
              <div className="footer-column">
                <h4>Product</h4>
                <a href="#features">Features</a>
                <a href="#pricing">Pricing</a>
                <a href="#testimonials">Reviews</a>
              </div>
              <div className="footer-column">
                <h4>Support</h4>
                <a href="#help">Help Center</a>
                <a href="#contact">Contact</a>
                <a href="#api">API Docs</a>
              </div>
              <div className="footer-column">
                <h4>Legal</h4>
                <a href="#privacy">Privacy</a>
                <a href="#terms">Terms</a>
                <a href="#security">Security</a>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <p>&copy; 2024 ListEasier. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Pricing Modal */}
      {showPricing && (
        <div className="modal-overlay" onClick={() => setShowPricing(false)}>
          <div className="pricing-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Choose Your Plan</h3>
              <button onClick={() => setShowPricing(false)} className="modal-close">×</button>
            </div>
            <div className="pricing-plans">
              <div className="pricing-plan">
                <h4>ListEasier</h4>
                <div className="price">$299<span>/month</span></div>
                <ul>
                  <li>10,000 listings/month</li>
                  <li>AI descriptions</li>
                  <li>CSV export</li>
                  <li>Ebay Integration</li>
                </ul>
                <button onClick={handleSignUp} className="btn-outline">Sign up Today!</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;