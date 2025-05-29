import React, { useState, useEffect } from 'react';
import { useEbayAuth } from './EbayAuthContext';

function EbayLocationSettings({ onClose }) {
  const { ebayService, userProfile } = useEbayAuth();
  const [location, setLocation] = useState({
    country: 'US',
    postalCode: '',
    city: '',
    stateOrProvince: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Load from localStorage first
    const storedLocation = localStorage.getItem('ebaySellerLocation');
    if (storedLocation) {
      try {
        setLocation(JSON.parse(storedLocation));
        return;
      } catch (e) {
        console.warn('Invalid stored location:', e);
      }
    }

    // Try to extract from user profile
    if (userProfile && ebayService) {
      const extractedLocation = ebayService.extractUserLocation(userProfile);
      if (extractedLocation) {
        setLocation(extractedLocation);
      }
    }
  }, [userProfile, ebayService]);

  const handleSave = () => {
    // Validate required fields
    if (!location.postalCode || !location.country) {
      setMessage('Postal code and country are required');
      return;
    }

    setIsSaving(true);
    
    // Save to localStorage
    localStorage.setItem('ebaySellerLocation', JSON.stringify(location));
    
    setMessage('Location saved successfully!');
    setTimeout(() => {
      setIsSaving(false);
      if (onClose) onClose();
    }, 1500);
  };

  const handleInputChange = (field, value) => {
    setLocation(prev => ({
      ...prev,
      [field]: value
    }));
    setMessage(''); // Clear message on input change
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        maxWidth: '500px',
        width: '90%',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>eBay Seller Location</h2>
        
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Configure your ship-from location for eBay listings. This location will be used for all your listings.
        </p>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Country *
          </label>
          <select
            value={location.country}
            onChange={(e) => handleInputChange('country', e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="UK">United Kingdom</option>
            <option value="AU">Australia</option>
            <option value="DE">Germany</option>
            <option value="FR">France</option>
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            Postal/ZIP Code *
          </label>
          <input
            type="text"
            value={location.postalCode}
            onChange={(e) => handleInputChange('postalCode', e.target.value)}
            placeholder="e.g., 90210"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            City
          </label>
          <input
            type="text"
            value={location.city}
            onChange={(e) => handleInputChange('city', e.target.value)}
            placeholder="e.g., Beverly Hills"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500' }}>
            State/Province
          </label>
          <input
            type="text"
            value={location.stateOrProvince}
            onChange={(e) => handleInputChange('stateOrProvince', e.target.value)}
            placeholder="e.g., CA"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          />
        </div>

        {message && (
          <div style={{
            padding: '10px',
            marginBottom: '15px',
            backgroundColor: message.includes('success') ? '#d4edda' : '#f8d7da',
            color: message.includes('success') ? '#155724' : '#721c24',
            borderRadius: '4px',
            fontSize: '14px'
          }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              border: '1px solid #ddd',
              backgroundColor: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              opacity: isSaving ? 0.7 : 1
            }}
          >
            {isSaving ? 'Saving...' : 'Save Location'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EbayLocationSettings;