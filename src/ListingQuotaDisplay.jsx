import React from 'react';
import { useQuota } from './QuotaContext';

function ListingQuotaDisplay({ compact = false }) {
  const { quotaInfo, loading, error } = useQuota();

  if (loading || !quotaInfo) {
    return null;
  }

  if (error) {
    return compact ? null : (
      <div style={{
        padding: '10px',
        backgroundColor: '#f8d7da',
        color: '#721c24',
        borderRadius: '6px',
        fontSize: '12px'
      }}>
        {error}
      </div>
    );
  }

  const getStatusColor = () => {
    if (quotaInfo.percentageUsed >= 90) return '#dc3545';
    if (quotaInfo.percentageUsed >= 75) return '#ffc107';
    return '#28a745';
  };

  const getUpgradeMessage = () => {
    if (quotaInfo.tier === 'Free' && quotaInfo.remaining <= 3) {
      return 'Upgrade to Standard for 1,000 listings/month';
    }
    if (quotaInfo.tier === 'Standard' && quotaInfo.percentageUsed >= 80) {
      return 'Upgrade to Growth for 10,000 listings/month';
    }
    return null;
  };

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        backgroundColor: '#f8f9fa',
        borderRadius: '20px',
        fontSize: '13px',
        color: '#495057'
      }}>
        <span style={{ fontWeight: '500' }}>
          {quotaInfo.isLifetime ? 'Listings:' : 'Monthly:'}
        </span>
        <span style={{ color: getStatusColor(), fontWeight: '600' }}>
          {quotaInfo.used}/{quotaInfo.limit}
        </span>
        {quotaInfo.percentageUsed >= 80 && (
          <span style={{ fontSize: '11px', color: '#6c757d' }}>
            ({quotaInfo.remaining} left)
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      marginBottom: '20px'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px'
      }}>
        <h3 style={{ margin: 0, fontSize: '18px', color: '#333' }}>
          Listing Quota
        </h3>
        <span style={{
          padding: '4px 12px',
          backgroundColor: '#e3f2fd',
          color: '#1976d2',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: '500'
        }}>
          {quotaInfo.tier} Plan
        </span>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '8px',
          fontSize: '14px'
        }}>
          <span style={{ color: '#666' }}>
            {quotaInfo.isLifetime ? 'Lifetime Usage' : 'Monthly Usage'}
          </span>
          <span style={{ fontWeight: '600', color: getStatusColor() }}>
            {quotaInfo.used} / {quotaInfo.limit}
          </span>
        </div>
        
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: '#e9ecef',
          borderRadius: '4px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${quotaInfo.percentageUsed}%`,
            height: '100%',
            backgroundColor: getStatusColor(),
            transition: 'width 0.3s ease'
          }} />
        </div>
        
        <div style={{
          marginTop: '6px',
          fontSize: '12px',
          color: '#6c757d'
        }}>
          {quotaInfo.remaining} listings remaining
          {!quotaInfo.isLifetime && ' this month'}
        </div>
      </div>

      {getUpgradeMessage() && (
        <div style={{
          padding: '12px',
          backgroundColor: '#fff3cd',
          border: '1px solid #ffeaa7',
          borderRadius: '6px',
          fontSize: '13px',
          color: '#856404',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{getUpgradeMessage()}</span>
          <button style={{
            padding: '4px 12px',
            backgroundColor: '#ffc107',
            color: '#000',
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '500',
            cursor: 'pointer'
          }}>
            Upgrade
          </button>
        </div>
      )}

      {quotaInfo.tier !== 'Free' && (
        <div style={{
          marginTop: '10px',
          fontSize: '11px',
          color: '#6c757d',
          textAlign: 'center'
        }}>
          Lifetime total: {quotaInfo.lifetimeTotal} listings
        </div>
      )}
    </div>
  );
}

export default ListingQuotaDisplay;