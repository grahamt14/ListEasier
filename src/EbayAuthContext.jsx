// EbayAuthContext.jsx
import React, { createContext, useContext, useReducer, useEffect } from 'react';
import EbayOAuthService from './EbayOAuthService';

// Create context
const EbayAuthContext = createContext();

// Initial state
const initialState = {
  isAuthenticated: false,
  isLoading: false,
  userProfile: null,
  businessPolicies: null,
  selectedPolicies: {
    paymentPolicyId: null,
    fulfillmentPolicyId: null,
    returnPolicyId: null
  },
  error: null
};

// Reducer
function ebayAuthReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
      
    case 'SET_AUTHENTICATED':
      return { 
        ...state, 
        isAuthenticated: action.payload,
        error: action.payload ? null : state.error
      };
      
    case 'SET_USER_PROFILE':
      return { ...state, userProfile: action.payload };
      
    case 'SET_BUSINESS_POLICIES':
      return { ...state, businessPolicies: action.payload };
      
    case 'SET_SELECTED_POLICIES':
      return {
        ...state,
        selectedPolicies: {
          ...state.selectedPolicies,
          ...action.payload
        }
      };
      
    case 'SET_ERROR':
      return { ...state, error: action.payload };
      
    case 'CLEAR_ERROR':
      return { ...state, error: null };
      
    case 'LOGOUT':
      return {
        ...initialState
      };
      
    default:
      return state;
  }
}

// Provider component
export function EbayAuthProvider({ children }) {
  const [state, dispatch] = useReducer(ebayAuthReducer, initialState);
  const ebayService = new EbayOAuthService();

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      if (ebayService.isAuthenticated()) {
        dispatch({ type: 'SET_AUTHENTICATED', payload: true });
        await loadUserData();
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to verify authentication' });
    }
  };

  const loadUserData = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // Load user profile and business policies
      const [profileData, policiesData] = await Promise.all([
        ebayService.getUserProfile().catch(err => {
          console.warn('Could not load profile:', err);
          return null;
        }),
        ebayService.getBusinessPolicies()
      ]);

      dispatch({ type: 'SET_USER_PROFILE', payload: profileData });
      dispatch({ type: 'SET_BUSINESS_POLICIES', payload: policiesData });
      
      // Auto-select first policy of each type if available
      if (policiesData.success) {
        const autoSelections = {};
        
        if (policiesData.paymentPolicies?.length > 0) {
          autoSelections.paymentPolicyId = policiesData.paymentPolicies[0].paymentPolicyId;
        }
        
        if (policiesData.fulfillmentPolicies?.length > 0) {
          autoSelections.fulfillmentPolicyId = policiesData.fulfillmentPolicies[0].fulfillmentPolicyId;
        }
        
        if (policiesData.returnPolicies?.length > 0) {
          autoSelections.returnPolicyId = policiesData.returnPolicies[0].returnPolicyId;
        }
        
        if (Object.keys(autoSelections).length > 0) {
          dispatch({ type: 'SET_SELECTED_POLICIES', payload: autoSelections });
        }
      }
      
    } catch (error) {
      console.error('Error loading user data:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load user data' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const login = () => {
    dispatch({ type: 'CLEAR_ERROR' });
    dispatch({ type: 'SET_LOADING', payload: true });
    
    const state = Math.random().toString(36).substring(2, 15);
    const authUrl = ebayService.generateAuthUrl(state);
    window.location.href = authUrl;
  };

  const handleAuthCallback = async (authCode) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await ebayService.exchangeCodeForToken(authCode);
      dispatch({ type: 'SET_AUTHENTICATED', payload: true });
      await loadUserData();
      return true;
    } catch (error) {
      console.error('Auth callback error:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Authentication failed' });
      return false;
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const logout = () => {
    ebayService.logout();
    dispatch({ type: 'LOGOUT' });
  };

  const refreshPolicies = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const policiesData = await ebayService.getBusinessPolicies();
      dispatch({ type: 'SET_BUSINESS_POLICIES', payload: policiesData });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to refresh policies' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const selectPolicy = (policyType, policyId) => {
    dispatch({ 
      type: 'SET_SELECTED_POLICIES', 
      payload: { [policyType]: policyId } 
    });
  };

  const getSelectedPolicyDetails = () => {
    if (!state.businessPolicies) return null;

    const { selectedPolicies, businessPolicies } = state;
    
    const paymentPolicy = businessPolicies.paymentPolicies?.find(
      p => p.paymentPolicyId === selectedPolicies.paymentPolicyId
    );
    
    const fulfillmentPolicy = businessPolicies.fulfillmentPolicies?.find(
      p => p.fulfillmentPolicyId === selectedPolicies.fulfillmentPolicyId
    );
    
    const returnPolicy = businessPolicies.returnPolicies?.find(
      p => p.returnPolicyId === selectedPolicies.returnPolicyId
    );

    return {
      paymentPolicy,
      fulfillmentPolicy,
      returnPolicy
    };
  };

  const contextValue = {
    ...state,
    ebayService,
    login,
    logout,
    handleAuthCallback,
    loadUserData,
    refreshPolicies,
    selectPolicy,
    getSelectedPolicyDetails
  };

  return (
    <EbayAuthContext.Provider value={contextValue}>
      {children}
    </EbayAuthContext.Provider>
  );
}

// Custom hook
export function useEbayAuth() {
  const context = useContext(EbayAuthContext);
  if (!context) {
    throw new Error('useEbayAuth must be used within an EbayAuthProvider');
  }
  return context;
}