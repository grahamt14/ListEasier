// Updated EbayPolicySelector.jsx to handle no business policies case

import React from 'react';
import { useEbayAuth } from './EbayAuthContext';

const EbayPolicySelector = ({ onPolicyChange }) => {
  const { 
    businessPolicies, 
    selectedPolicies, 
    selectPolicy, 
    isLoading 
  } = useEbayAuth();

  if (!businessPolicies || !businessPolicies.success) {
    return (
      <div className="policy-selector-container">
        <div className="policy-selector-placeholder">
          <p>eBay policies will appear here once you connect your account.</p>
        </div>
      </div>
    );
  }

  // Check if user is not eligible for business policies
  if (businessPolicies.notEligible) {
    return (
      <div className="policy-selector-container">
        <h4>eBay Business Policies</h4>
        <div className="policy-not-eligible-message">
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            {businessPolicies.message || 'Business policies are not enabled for this account.'}
          </p>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '10px' }}>
            You can still create listings without business policies. The CSV export will work, 
            but you'll need to set up payment, shipping, and return policies directly in eBay.
          </p>
          {businessPolicies.environment === 'sandbox' && (
            <p style={{ color: '#0066cc', fontSize: '0.85rem', marginTop: '10px' }}>
              💡 Tip: To test with business policies, switch to your production eBay account 
              or enable business policies in your sandbox account settings.
            </p>
          )}
        </div>
      </div>
    );
  }

  const handlePolicySelect = (policyType, policyId) => {
    selectPolicy(policyType, policyId);
    
    // Notify parent component of policy change
    if (onPolicyChange) {
      const selectedPolicy = getPolicyById(policyType, policyId);
      onPolicyChange(policyType, selectedPolicy);
    }
  };

  const getPolicyById = (policyType, policyId) => {
    const policyArrays = {
      paymentPolicyId: businessPolicies.paymentPolicies,
      fulfillmentPolicyId: businessPolicies.fulfillmentPolicies,
      returnPolicyId: businessPolicies.returnPolicies
    };

    return policyArrays[policyType]?.find(p => {
      const idField = policyType.replace('Id', '');
      return p[idField] === policyId;
    });
  };

  const formatPolicyDescription = (policy, type) => {
    switch (type) {
      case 'payment':
        const paymentMethods = policy.paymentMethods?.map(pm => pm.paymentMethodType).join(', ') || 'N/A';
        return `Methods: ${paymentMethods}`;
        
      case 'fulfillment':
        const shippingOptions = policy.shippingOptions?.length || 0;
        const handlingTime = policy.handlingTime?.value || 'N/A';
        return `${shippingOptions} shipping options, ${handlingTime} day handling`;
        
      case 'return':
        const returnsAccepted = policy.returnsAccepted ? 'Accepted' : 'Not accepted';
        const returnPeriod = policy.returnPeriod?.value || 'N/A';
        return `${returnsAccepted}, ${returnPeriod} day period`;
        
      default:
        return '';
    }
  };

  return (
    <div className="policy-selector-container">
      <h4>eBay Business Policies</h4>
      <p className="policy-subtitle">Select the policies to use for your listings</p>

      <div className="policy-selectors">
        {/* Payment Policies */}
        <div className="policy-group">
          <label className="policy-label">
            <span className="policy-icon">💳</span>
            Payment Policy
          </label>
          <select
            value={selectedPolicies.paymentPolicyId || ''}
            onChange={(e) => handlePolicySelect('paymentPolicyId', e.target.value)}
            disabled={isLoading}
            className="policy-select"
          >
            <option value="">Select payment policy...</option>
            {businessPolicies.paymentPolicies?.map((policy) => (
              <option key={policy.paymentPolicyId} value={policy.paymentPolicyId}>
                {policy.name}
              </option>
            ))}
          </select>
          {selectedPolicies.paymentPolicyId && (
            <div className="policy-description">
              {formatPolicyDescription(
                getPolicyById('paymentPolicyId', selectedPolicies.paymentPolicyId),
                'payment'
              )}
            </div>
          )}
        </div>

        {/* Shipping/Fulfillment Policies */}
        <div className="policy-group">
          <label className="policy-label">
            <span className="policy-icon">📦</span>
            Shipping Policy
          </label>
          <select
            value={selectedPolicies.fulfillmentPolicyId || ''}
            onChange={(e) => handlePolicySelect('fulfillmentPolicyId', e.target.value)}
            disabled={isLoading}
            className="policy-select"
          >
            <option value="">Select shipping policy...</option>
            {businessPolicies.fulfillmentPolicies?.map((policy) => (
              <option key={policy.fulfillmentPolicyId} value={policy.fulfillmentPolicyId}>
                {policy.name}
              </option>
            ))}
          </select>
          {selectedPolicies.fulfillmentPolicyId && (
            <div className="policy-description">
              {formatPolicyDescription(
                getPolicyById('fulfillmentPolicyId', selectedPolicies.fulfillmentPolicyId),
                'fulfillment'
              )}
            </div>
          )}
        </div>

        {/* Return Policies */}
        <div className="policy-group">
          <label className="policy-label">
            <span className="policy-icon">↩️</span>
            Return Policy
          </label>
          <select
            value={selectedPolicies.returnPolicyId || ''}
            onChange={(e) => handlePolicySelect('returnPolicyId', e.target.value)}
            disabled={isLoading}
            className="policy-select"
          >
            <option value="">Select return policy...</option>
            {businessPolicies.returnPolicies?.map((policy) => (
              <option key={policy.returnPolicyId} value={policy.returnPolicyId}>
                {policy.name}
              </option>
            ))}
          </select>
          {selectedPolicies.returnPolicyId && (
            <div className="policy-description">
              {formatPolicyDescription(
                getPolicyById('returnPolicyId', selectedPolicies.returnPolicyId),
                'return'
              )}
            </div>
          )}
        </div>
      </div>

      {/* Policy Summary */}
      {(selectedPolicies.paymentPolicyId || selectedPolicies.fulfillmentPolicyId || selectedPolicies.returnPolicyId) && (
        <div className="policy-summary">
          <h5>Selected Policies Summary</h5>
          <div className="summary-grid">
            {selectedPolicies.paymentPolicyId && (
              <div className="summary-item">
                <strong>Payment:</strong> {getPolicyById('paymentPolicyId', selectedPolicies.paymentPolicyId)?.name}
              </div>
            )}
            {selectedPolicies.fulfillmentPolicyId && (
              <div className="summary-item">
                <strong>Shipping:</strong> {getPolicyById('fulfillmentPolicyId', selectedPolicies.fulfillmentPolicyId)?.name}
              </div>
            )}
            {selectedPolicies.returnPolicyId && (
              <div className="summary-item">
                <strong>Returns:</strong> {getPolicyById('returnPolicyId', selectedPolicies.returnPolicyId)?.name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EbayPolicySelector;