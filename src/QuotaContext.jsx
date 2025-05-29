import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { listingQuotaService } from './ListingQuotaService';

const QuotaContext = createContext();

export function useQuota() {
  const context = useContext(QuotaContext);
  if (!context) {
    throw new Error('useQuota must be used within a QuotaProvider');
  }
  return context;
}

export function QuotaProvider({ children }) {
  const { user } = useAuth0();
  const [quotaInfo, setQuotaInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch quota info
  const fetchQuotaInfo = async () => {
    if (!user?.sub) {
      setLoading(false);
      return;
    }

    try {
      const stats = await listingQuotaService.getUsageStats(user.sub);
      setQuotaInfo(stats);
      setError(null);
    } catch (err) {
      console.error('Error fetching quota info:', err);
      setError('Failed to load quota information');
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch when user changes
  useEffect(() => {
    fetchQuotaInfo();
  }, [user]);

  // Method to update quota after listing generation
  const updateQuotaAfterGeneration = async (listingsGenerated) => {
    if (!user?.sub || !listingsGenerated) return;

    try {
      // Update the quota on the server
      await listingQuotaService.incrementListingCount(user.sub, listingsGenerated);
      
      // Fetch the updated quota info
      await fetchQuotaInfo();
    } catch (err) {
      console.error('Error updating quota:', err);
      setError('Failed to update quota');
    }
  };

  // Method to check if can generate listings with partial support
  const checkQuotaForGeneration = async (requestedListings) => {
    if (!user?.sub) return { allowed: false, remaining: 0, canGeneratePartial: false };

    try {
      const quotaCheck = await listingQuotaService.canGenerateListings(user.sub, requestedListings);
      
      // If not enough quota for all, check if we can generate partial
      if (!quotaCheck.allowed && quotaCheck.remaining > 0) {
        return {
          ...quotaCheck,
          canGeneratePartial: true,
          partialCount: quotaCheck.remaining
        };
      }
      
      return quotaCheck;
    } catch (err) {
      console.error('Error checking quota:', err);
      return { allowed: false, remaining: 0, canGeneratePartial: false };
    }
  };

  // Force refresh quota
  const refreshQuota = () => {
    return fetchQuotaInfo();
  };

  const value = {
    quotaInfo,
    loading,
    error,
    updateQuotaAfterGeneration,
    checkQuotaForGeneration,
    refreshQuota
  };

  return (
    <QuotaContext.Provider value={value}>
      {children}
    </QuotaContext.Provider>
  );
}