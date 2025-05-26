import { useState, useEffect, useRef } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { fromCognitoIdentityPool } from "@aws-sdk/credential-provider-cognito-identity";
import { AppStateProvider, useAppState } from './StateContext';
import { EbayAuthProvider, useEbayAuth } from './EbayAuthContext';
import EbayListingManager from './EbayListingManager';
import BatchPreviewSection from './BatchPreviewSection';



// Import caching service
import { cacheService } from './CacheService';

// Batch Context for managing batches and templates
import React, { createContext, useContext, useReducer } from 'react';

const BatchContext = createContext();

const initialBatchState = {
  batches: [],
  templates: [],
  currentBatch: null,
  currentStep: 0,
  viewMode: 'overview', // 'overview', 'create', 'edit'
  statusFilter: 'all', // 'all', 'open', 'closed'
  sidebarCollapsed: false // New state for sidebar
};

function batchReducer(state, action) {
  switch (action.type) {
    case 'LOAD_BATCHES':
      return { ...state, batches: action.payload };
    case 'CREATE_BATCH':
      return { 
        ...state, 
        batches: [...state.batches, action.payload],
        currentBatch: action.payload,
        viewMode: 'edit'
      };
    case 'UPDATE_BATCH':
      return {
        ...state,
        batches: state.batches.map(batch => 
          batch.id === action.payload.id ? action.payload : batch
        ),
        currentBatch: action.payload
      };
    case 'DELETE_BATCH':
      const remainingBatches = state.batches.filter(batch => batch.id !== action.payload);
      return {
        ...state,
        batches: remainingBatches,
        currentBatch: state.currentBatch?.id === action.payload ? null : state.currentBatch,
        viewMode: state.currentBatch?.id === action.payload ? 'overview' : state.viewMode
      };
    case 'SET_CURRENT_BATCH':
      return { ...state, currentBatch: action.payload, viewMode: 'edit' };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };
    case 'SET_CURRENT_STEP':
      return { ...state, currentStep: action.payload };
    case 'SET_STATUS_FILTER':
      return { ...state, statusFilter: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'LOAD_TEMPLATES':
      return { ...state, templates: action.payload };
    case 'ADD_TEMPLATE':
      return { 
        ...state, 
        templates: [...state.templates, action.payload]
      };
    case 'UPDATE_TEMPLATE':
      return {
        ...state,
        templates: state.templates.map(template => 
          template.id === action.payload.id ? action.payload : template
        )
      };
    case 'DELETE_TEMPLATE':
      return {
        ...state,
        templates: state.templates.filter(template => template.id !== action.payload)
      };
    default:
      return state;
  }
}

// Enhanced BatchProvider with DynamoDB storage
function BatchProvider({ children }) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);
  const [isLoading, setIsLoading] = useState(false);
  
  // AWS Configuration
  const REGION = "us-east-2";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const dynamoClient = new DynamoDBClient({
    region: REGION,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId: IDENTITY_POOL_ID,
    }),
  });

  const docClient = DynamoDBDocumentClient.from(dynamoClient);

  // Load batches and templates from DynamoDB on mount
  useEffect(() => {
    loadBatchesFromDynamoDB();
    loadTemplatesFromDynamoDB();
  }, []);

  // Get or create session ID
  const getSessionId = () => {
    let sessionId = sessionStorage.getItem('listeasier_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      sessionStorage.setItem('listeasier_session_id', sessionId);
    }
    return sessionId;
  };

  // Compress batch data for storage (remove heavy base64 data)
  const compressBatchForStorage = (batch) => {
    return {
      ...batch,
      appState: {
        ...batch.appState,
        // Remove large arrays that can be regenerated
        filesBase64: [],
        rawFiles: [],
        // Keep only essential state
        imageGroups: batch.appState.imageGroups?.map(group => 
          Array.isArray(group) ? { count: group.length } : group
        ) || [[]],
        s3ImageGroups: batch.appState.s3ImageGroups || [[]],
        responseData: batch.appState.responseData || [],
        groupMetadata: batch.appState.groupMetadata || [],
        fieldSelections: batch.appState.fieldSelections || {},
        processedGroupIndices: batch.appState.processedGroupIndices || [],
        category: batch.appState.category,
        subCategory: batch.appState.subCategory,
        price: batch.appState.price,
        sku: batch.appState.sku,
        categoryID: batch.appState.categoryID
      }
    };
  };

  const loadBatchesFromDynamoDB = async () => {
    setIsLoading(true);
    try {
      const sessionId = getSessionId();
      
      const command = new QueryCommand({
        TableName: 'ListEasierBatches',
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
          ':sessionId': sessionId
        },
        ScanIndexForward: false, // Most recent first
        Limit: 100 // Reasonable limit
      });

      const response = await docClient.send(command);
      const batches = response.Items || [];
      
      // Expand compressed image groups
      const expandedBatches = batches.map(batch => ({
        ...batch,
        appState: {
          ...batch.appState,
          imageGroups: batch.appState.imageGroups?.map(group => 
            group && typeof group === 'object' && group.count !== undefined 
              ? new Array(group.count).fill('') 
              : (group || [])
          ) || [[]]
        }
      }));
      
      dispatch({ type: 'LOAD_BATCHES', payload: expandedBatches });
      console.log(`Loaded ${batches.length} batches from DynamoDB`);
      
    } catch (error) {
      console.error('Error loading batches from DynamoDB:', error);
      dispatch({ type: 'LOAD_BATCHES', payload: [] });
    } finally {
      setIsLoading(false);
    }
  };

  const saveBatchToDynamoDB = async (batch) => {
    try {
      const sessionId = getSessionId();
      const compressedBatch = compressBatchForStorage(batch);
      
      const item = {
        sessionId,
        batchId: batch.id,
        ...compressedBatch,
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60) // 90 days
      };

      const command = new PutCommand({
        TableName: 'ListEasierBatches',
        Item: item
      });

      await docClient.send(command);
      return true;
    } catch (error) {
      console.error('Error saving batch to DynamoDB:', error);
      return false;
    }
  };

  const deleteBatchFromDynamoDB = async (batchId) => {
    try {
      const sessionId = getSessionId();
      
      const command = new DeleteCommand({
        TableName: 'ListEasierBatches',
        Key: {
          sessionId,
          batchId
        }
      });

      await docClient.send(command);
      return true;
    } catch (error) {
      console.error('Error deleting batch from DynamoDB:', error);
      return false;
    }
  };

  const loadTemplatesFromDynamoDB = async () => {
    try {
      const sessionId = getSessionId();
      
      const command = new QueryCommand({
        TableName: 'ListEasierBatches',
        KeyConditionExpression: 'sessionId = :sessionId AND begins_with(batchId, :prefix)',
        ExpressionAttributeValues: {
          ':sessionId': sessionId,
          ':prefix': 'template_'
        }
      });

      const response = await docClient.send(command);
      const templates = response.Items || [];
      
      dispatch({ type: 'LOAD_TEMPLATES', payload: templates });
      
    } catch (error) {
      console.error('Error loading templates from DynamoDB:', error);
      dispatch({ type: 'LOAD_TEMPLATES', payload: [] });
    }
  };

  const saveTemplateToDynamoDB = async (template) => {
    try {
      const sessionId = getSessionId();
      
      const item = {
        sessionId,
        batchId: `template_${template.id}`,
        ...template,
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
      };

      const command = new PutCommand({
        TableName: 'ListEasierBatches',
        Item: item
      });

      await docClient.send(command);
      return true;
    } catch (error) {
      console.error('Error saving template to DynamoDB:', error);
      return false;
    }
  };

  const createBatch = (batchData) => {
    const newBatch = {
      id: Date.now().toString(),
      ...batchData,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
      totalItems: 0,
      csvDownloads: 0,
      ebayListingsCreated: 0,
      lastCsvDownload: null,
      lastEbayListingCreated: null,
      appState: {
        filesBase64: [],
        rawFiles: [],
        imageGroups: [[]],
        s3ImageGroups: [[]],
        responseData: [],
        groupMetadata: [],
        fieldSelections: {},
        processedGroupIndices: []
      }
    };
    
    dispatch({ type: 'CREATE_BATCH', payload: newBatch });
    
    // Save to DynamoDB (async, don't block UI)
    saveBatchToDynamoDB(newBatch).catch(error => {
      console.error('Failed to save new batch to DynamoDB:', error);
    });
    
    return newBatch;
  };

  const updateBatch = (batchData) => {
    const updatedBatch = {
      ...batchData,
      updatedAt: new Date().toISOString()
    };
    
    dispatch({ type: 'UPDATE_BATCH', payload: updatedBatch });
    
    // Save to DynamoDB (async, don't block UI)
    saveBatchToDynamoDB(updatedBatch).catch(error => {
      console.error('Failed to update batch in DynamoDB:', error);
    });
  };

  const deleteBatch = (batchId) => {
    dispatch({ type: 'DELETE_BATCH', payload: batchId });
    
    // Delete from DynamoDB (async)
    deleteBatchFromDynamoDB(batchId).catch(error => {
      console.error('Failed to delete batch from DynamoDB:', error);
    });
  };

  const markCsvDownloaded = (batchId) => {
    const batch = state.batches.find(b => b.id === batchId);
    if (batch) {
      const updatedBatch = {
        ...batch,
        csvDownloads: (batch.csvDownloads || 0) + 1,
        lastCsvDownload: new Date().toISOString(),
        status: determineBatchStatus(batch, { csvDownloaded: true }),
        updatedAt: new Date().toISOString()
      };
      updateBatch(updatedBatch);
    }
  };

  const markEbayListingsCreated = (batchId, listingsCount = 1) => {
    const batch = state.batches.find(b => b.id === batchId);
    if (batch) {
      const updatedBatch = {
        ...batch,
        ebayListingsCreated: (batch.ebayListingsCreated || 0) + listingsCount,
        lastEbayListingCreated: new Date().toISOString(),
        status: determineBatchStatus(batch, { ebayListingsCreated: listingsCount }),
        updatedAt: new Date().toISOString()
      };
      updateBatch(updatedBatch);
    }
  };

  const determineBatchStatus = (batch, newActivity = {}) => {
    const hasValidListings = batch.appState?.responseData?.some(item => item && !item.error) || false;
    const totalValidListings = batch.appState?.responseData?.filter(item => item && !item.error).length || 0;
    
    if (!hasValidListings || totalValidListings === 0) {
      return 'draft';
    }

    const totalCsvDownloads = (batch.csvDownloads || 0) + (newActivity.csvDownloaded ? 1 : 0);
    const totalEbayListings = (batch.ebayListingsCreated || 0) + (newActivity.ebayListingsCreated || 0);
    
    if (totalCsvDownloads > 0 || totalEbayListings > 0) {
      return 'completed';
    }

    return 'ready';
  };

  const createTemplate = (templateData) => {
    const newTemplate = {
      id: Date.now().toString(),
      ...templateData,
      createdAt: new Date().toISOString()
    };
    
    dispatch({ type: 'ADD_TEMPLATE', payload: newTemplate });
    
    // Save to DynamoDB (async)
    saveTemplateToDynamoDB(newTemplate).catch(error => {
      console.error('Failed to save template to DynamoDB:', error);
    });
    
    return newTemplate;
  };

  const updateTemplate = (templateData) => {
    dispatch({ type: 'UPDATE_TEMPLATE', payload: templateData });
    saveTemplateToDynamoDB(templateData).catch(error => {
      console.error('Failed to update template in DynamoDB:', error);
    });
  };

  const deleteTemplate = (templateId) => {
    dispatch({ type: 'DELETE_TEMPLATE', payload: templateId });
    deleteBatchFromDynamoDB(`template_${templateId}`).catch(error => {
      console.error('Failed to delete template from DynamoDB:', error);
    });
  };

  const contextValue = {
    ...state,
    dispatch,
    createBatch,
    updateBatch,
    deleteBatch,
    markCsvDownloaded,
    markEbayListingsCreated,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    isLoading
  };

  return (
    <BatchContext.Provider value={contextValue}>
      {children}
    </BatchContext.Provider>
  );
}

function useBatch() {
  const context = useContext(BatchContext);
  if (!context) {
    throw new Error('useBatch must be used within a BatchProvider');
  }
  return context;
}

// WYSIWYG Editor Component
function WYSIWYGEditor({ value, onChange, placeholder = "Enter description..." }) {
  const editorRef = React.useRef(null);

  const handleCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleInput = () => {
    if (onChange) {
      onChange(editorRef.current.innerHTML);
    }
  };

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  return (
    <div className="wysiwyg-container">
      <div className="wysiwyg-toolbar">
        <button 
          type="button"
          onClick={() => handleCommand('bold')}
          className="toolbar-btn"
          title="Bold"
        >
          <strong>B</strong>
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('italic')}
          className="toolbar-btn"
          title="Italic"
        >
          <em>I</em>
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('underline')}
          className="toolbar-btn"
          title="Underline"
        >
          <u>U</u>
        </button>
        <div className="toolbar-separator"></div>
        <button 
          type="button"
          onClick={() => handleCommand('insertUnorderedList')}
          className="toolbar-btn"
          title="Bullet List"
        >
          •
        </button>
        <button 
          type="button"
          onClick={() => handleCommand('insertOrderedList')}
          className="toolbar-btn"
          title="Numbered List"
        >
          1.
        </button>
        <div className="toolbar-separator"></div>
        <button 
          type="button"
          onClick={() => handleCommand('removeFormat')}
          className="toolbar-btn"
          title="Clear Formatting"
        >
          ✕
        </button>
      </div>
      <div
        ref={editorRef}
        className="wysiwyg-editor"
        contentEditable
        onInput={handleInput}
        style={{
          minHeight: '120px',
          padding: '12px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          backgroundColor: '#fff',
          color: '#000'
        }}
        data-placeholder={placeholder}
      />
    </div>
  );
}

// Template Management Modal
function TemplateModal({ isOpen, onClose, template, category, subCategory }) {
  const { createTemplate, updateTemplate } = useBatch();
  const [formData, setFormData] = useState({
    name: '',
    content: '',
    category: category || '',
    subCategory: subCategory || ''
  });

  useEffect(() => {
    if (template) {
      setFormData(template);
    } else {
      setFormData({
        name: '',
        content: '',
        category: category || '',
        subCategory: subCategory || ''
      });
    }
  }, [template, category, subCategory]);

  const handleSave = () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      alert('Please fill in all required fields');
      return;
    }

    if (template) {
      updateTemplate(formData);
    } else {
      createTemplate(formData);
    }
    
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px', width: '90%' }}>
        <div className="modal-header">
          <h3>{template ? 'Edit Template' : 'Create Template'}</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Template Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              placeholder="Enter template name"
              className="form-control"
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({...formData, category: e.target.value})}
                placeholder="Category"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label>SubCategory</label>
              <input
                type="text"
                value={formData.subCategory}
                onChange={(e) => setFormData({...formData, subCategory: e.target.value})}
                placeholder="SubCategory"
                className="form-control"
              />
            </div>
          </div>
          
          <div className="form-group">
            <label>Template Content *</label>
            <WYSIWYGEditor
              value={formData.content}
              onChange={(content) => setFormData({...formData, content})}
              placeholder="Create your description template..."
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">
            {template ? 'Update' : 'Create'} Template
          </button>
        </div>
      </div>
    </div>
  );
}

// Delete Confirmation Modal
function DeleteBatchModal({ isOpen, onClose, onConfirm, batchName }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '500px', width: '90%' }}>
        <div className="modal-header">
          <h3>Delete Batch</h3>
          <button onClick={onClose} className="modal-close">×</button>
        </div>
        
        <div className="modal-body">
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h4 style={{ color: '#dc3545', marginBottom: '1rem' }}>
              Are you sure you want to delete this batch?
            </h4>
            <p style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
              <strong>"{batchName}"</strong>
            </p>
            <p style={{ color: '#666', marginBottom: '0' }}>
              This action cannot be undone. All data associated with this batch will be permanently deleted from the system.
            </p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button 
            onClick={onConfirm} 
            className="btn"
            style={{
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none'
            }}
          >
            Delete Batch
          </button>
        </div>
      </div>
    </div>
  );
}

// Updated Sidebar Component with Logo Image
function Sidebar() {
  const { batches, dispatch, statusFilter, sidebarCollapsed, viewMode } = useBatch();
  
  const getFilterCounts = () => {
    const open = batches.filter(batch => 
      batch.status === 'draft' || batch.status === 'ready' || batch.status === 'error'
    ).length;
    const closed = batches.filter(batch => batch.status === 'completed').length;
    
    return { all: batches.length, open, closed };
  };

  const filterCounts = getFilterCounts();

  const handleFilterChange = (newFilter) => {
    dispatch({ type: 'SET_STATUS_FILTER', payload: newFilter });
    if (viewMode !== 'overview') {
      dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
    }
  };

  const handleCreateBatch = () => {
    dispatch({ type: 'SET_VIEW_MODE', payload: 'create' });
  };

  return (
    <div className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Logo-Only Sidebar Brand */}
      <div className="sidebar-brand">
        <img 
          src="/ListEasier.png" 
          alt="ListEasier Logo" 
          className="brand-logo-only"
        />
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Overview Section */}
        <div className="nav-section">
          <div className="nav-section-header">
            {!sidebarCollapsed && <span>Overview</span>}
          </div>
          <ul className="nav-list">
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => handleFilterChange('all')}
                title="All Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>All Batches</span>
                    <span className="nav-badge">{filterCounts.all}</span>
                  </>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'open' ? 'active' : ''}`}
                onClick={() => handleFilterChange('open')}
                title="Open Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>Open</span>
                    <span className="nav-badge">{filterCounts.open}</span>
                  </>
                )}
              </button>
            </li>
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'overview' && statusFilter === 'closed' ? 'active' : ''}`}
                onClick={() => handleFilterChange('closed')}
                title="Completed Batches"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/>
                </svg>
                {!sidebarCollapsed && (
                  <>
                    <span>Completed</span>
                    <span className="nav-badge">{filterCounts.closed}</span>
                  </>
                )}
              </button>
            </li>
          </ul>
        </div>

        {/* Actions Section */}
        <div className="nav-section">
          <div className="nav-section-header">
            {!sidebarCollapsed && <span>Actions</span>}
          </div>
          <ul className="nav-list">
            <li className="nav-item">
              <button 
                className={`nav-link ${viewMode === 'create' ? 'active' : ''}`}
                onClick={handleCreateBatch}
                title="Create New Batch"
              >
                <svg className="nav-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                {!sidebarCollapsed && <span>New Batch</span>}
              </button>
            </li>
          </ul>
        </div>

        {/* Recent Batches */}
        {!sidebarCollapsed && batches.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-header">
              <span>Recent Batches</span>
            </div>
            <ul className="nav-list">
              {batches.slice(0, 5).map(batch => (
                <li key={batch.id} className="nav-item">
                  <button 
                    className="nav-link batch-link"
                    onClick={() => dispatch({ type: 'SET_CURRENT_BATCH', payload: batch })}
                    title={batch.name}
                  >
                    <div className="batch-thumbnail">
                      {batch.category && batch.category.charAt(0)}
                    </div>
                    <div className="batch-info">
                      <span className="batch-name">{batch.name}</span>
                      <span className={`batch-status status-${batch.status}`}>
                        {batch.status}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>
    </div>
  );
}

// Main Header Component
function MainHeader() {
  const { dispatch, sidebarCollapsed, viewMode, currentBatch } = useBatch();

  const toggleSidebar = () => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  };

  const getPageTitle = () => {
    if (viewMode === 'create') return 'Create New Batch';
    if (viewMode === 'edit' && currentBatch) return currentBatch.name;
    return 'Your Batches';
  };

  return (
    <header className="main-header">
      <div className="header-left">
        <button 
          className="sidebar-toggle"
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
        <h1 className="page-title">{getPageTitle()}</h1>
      </div>
      <div className="header-right">
        {/* Add any header actions here */}
      </div>
    </header>
  );
}

// Updated BatchOverview component
function BatchOverview() {
  const { batches, dispatch, deleteBatch, statusFilter } = useBatch();
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, batch: null });

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return '#6c757d';
      case 'ready': return '#007bff';
      case 'completed': return '#28a745';
      case 'error': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'draft': return 'Draft';
      case 'ready': return 'Ready';
      case 'completed': return 'Completed';
      case 'error': return 'Error';
      default: return status;
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleEditBatch = (batch) => {
    dispatch({ type: 'SET_CURRENT_BATCH', payload: batch });
  };

  const handleDeleteBatch = (batch) => {
    setDeleteModal({ isOpen: true, batch });
  };

  const confirmDeleteBatch = () => {
    if (deleteModal.batch) {
      deleteBatch(deleteModal.batch.id);
      setDeleteModal({ isOpen: false, batch: null });
    }
  };

  const closeDeleteModal = () => {
    setDeleteModal({ isOpen: false, batch: null });
  };

  const getBatchStats = (batch) => {
    const appState = batch.appState || {};
    const totalListings = appState.responseData?.filter(item => item && !item.error).length || 0;
    const totalImageGroups = appState.imageGroups?.filter(g => g && g.length > 0).length || 0;
    const processedGroups = appState.processedGroupIndices?.length || 0;
    
    return {
      totalListings,
      totalImageGroups,
      processedGroups
    };
  };

  const getFilteredBatches = () => {
    if (statusFilter === 'all') {
      return batches;
    } else if (statusFilter === 'open') {
      return batches.filter(batch => 
        batch.status === 'draft' || batch.status === 'ready' || batch.status === 'error'
      );
    } else if (statusFilter === 'closed') {
      return batches.filter(batch => batch.status === 'completed');
    }
    return batches;
  };

  const filteredBatches = getFilteredBatches();

  return (
    <div className="batch-overview-content">
      {/* Batch legend */}
      <div className="batch-legend" style={{
        background: '#f8f9fa',
        border: '1px solid #e9ecef',
        borderRadius: '8px',
        padding: '15px',
        marginBottom: '20px',
        fontSize: '0.9rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#333', fontSize: '1rem' }}>
              Batch Preview Icons:
            </h4>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>📝</span>
                <span style={{ color: '#333' }}>Generated Listings</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>📷</span>
                <span style={{ color: '#333' }}>Image Groups</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>✅</span>
                <span style={{ color: '#333' }}>Processed Groups</span>
              </div>
            </div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#333', fontSize: '1rem' }}>
              Batch Status:
            </h4>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#6c757d', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Draft - In progress</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#007bff', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Ready - Available for use</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: '#28a745', borderRadius: '50%' }}></div>
                <span style={{ color: '#333' }}>Completed - CSV downloaded or eBay listings created</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="batch-table">
        <div className="table-header">
          <div className="th">Batch Name</div>
          <div className="th">Status</div>
          <div className="th">Batch Preview</div>
          <div className="th">Date Created</div>
          <div className="th">Actions</div>
        </div>

        {filteredBatches.length === 0 ? (
          <div className="empty-state">
            <h3>
              {statusFilter === 'all' ? 'No batches yet' : 
               statusFilter === 'open' ? 'No open batches' : 
               'No closed batches'}
            </h3>
            <p>
              {statusFilter === 'all' ? 'Create your first batch to get started' :
               statusFilter === 'open' ? 'All your batches have been completed' :
               'No batches have been completed yet'}
            </p>
            {statusFilter === 'all' && (
              <button 
                onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'create' })}
                className="btn btn-primary"
              >
                Create Batch
              </button>
            )}
          </div>
        ) : (
          filteredBatches.map(batch => {
            const stats = getBatchStats(batch);
            
            return (
              <div key={batch.id} className="table-row">
                <div className="td">
                  <div className="batch-name-cell">
                    <div className="batch-thumbnail">
                      {batch.category && batch.category.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                        {batch.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: '#666' }}>
                        {batch.category} / {batch.subCategory}
                      </div>
                      {batch.status === 'completed' && (
                        <div style={{ fontSize: '0.75rem', color: '#28a745', marginTop: '2px' }}>
                          {batch.csvDownloads > 0 && `${batch.csvDownloads} CSV download${batch.csvDownloads > 1 ? 's' : ''}`}
                          {batch.csvDownloads > 0 && batch.ebayListingsCreated > 0 && ' • '}
                          {batch.ebayListingsCreated > 0 && `${batch.ebayListingsCreated} eBay listing${batch.ebayListingsCreated > 1 ? 's' : ''}`}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="td">
                  <span 
                    className="status-badge" 
                    style={{ backgroundColor: getStatusColor(batch.status) }}
                  >
                    {getStatusLabel(batch.status)}
                  </span>
                </div>
                <div className="td">
                  <div className="batch-preview">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="preview-icon" title="Generated Listings">📝</span> 
                      <span>{stats.totalListings}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="preview-icon" title="Image Groups">📷</span> 
                      <span>{stats.totalImageGroups}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span className="preview-icon" title="Processed Groups">✅</span> 
                      <span>{stats.processedGroups}</span>
                    </div>
                  </div>
                </div>
                <div className="td">
                  <div>{formatDate(batch.createdAt)}</div>
                  {batch.updatedAt !== batch.createdAt && (
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Updated: {formatDate(batch.updatedAt)}
                    </div>
                  )}
                </div>
                <div className="td">
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={() => handleEditBatch(batch)}
                      className="btn btn-sm btn-outline"
                    >
                      Open
                    </button>
                    <button 
                      onClick={() => handleDeleteBatch(batch)}
                      className="btn btn-sm"
                      style={{
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none'
                      }}
                      title="Delete batch"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <DeleteBatchModal
        isOpen={deleteModal.isOpen}
        onClose={closeDeleteModal}
        onConfirm={confirmDeleteBatch}
        batchName={deleteModal.batch?.name || ''}
      />
    </div>
  );
}

function BatchWizard() {
  const { createBatch, templates, dispatch } = useBatch();
  const [currentStep, setCurrentStep] = useState(0);
  const [batchData, setBatchData] = useState({
    name: '',
    category: '--',
    subCategory: '--',
    descriptionTemplate: 'ai_generate',
    condition: 'NEW',
    purchaseDate: '',
    purchasePrice: '',
    salePrice: '',
    sku: '',
    batchDescription: ''
  });

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  
  // Add states for categories (same as FormSection)
  const [categories, setCategories] = useState({});
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  
  // AWS Configuration (same as FormSection)
  const REGION = "us-east-2";
  const IDENTITY_POOL_ID = "us-east-2:f81d1240-32a8-4aff-87e8-940effdf5908";

  const client = new DynamoDBClient({
    region: REGION,
    credentials: fromCognitoIdentityPool({
      clientConfig: { region: REGION },
      identityPoolId: IDENTITY_POOL_ID,
    }),
  });

  const docClient = DynamoDBDocumentClient.from(client);

  // Fetch categories from DynamoDB (same logic as FormSection)
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        setCategoriesLoading(true);
        
        const cacheKey = 'categories_all';
        const cachedCategories = cacheService.get(cacheKey);
        
        if (cachedCategories) {
          setCategories(cachedCategories);
          setCategoriesLoading(false);
          return;
        }

        const scanCommand = new ScanCommand({
          TableName: 'ListCategory',
        });

        const response = await docClient.send(scanCommand);
        const categoryData = {};
        response.Items.forEach(item => {
          const category = item.Category;
          const subcategory = item.SubCategory;
          if (!categoryData[category]) {
            categoryData[category] = [];
          }
          categoryData[category].push(subcategory);
        });
        categoryData['--'] = ['--'];
        
        cacheService.set(cacheKey, categoryData, null, 'categories');
        
        setCategories(categoryData);
      } catch (err) {
        console.error('Error fetching categories:', err);
        const fallbackData = cacheService.get('categories_all');
        if (fallbackData) {
          setCategories(fallbackData);
        } else {
          // Fallback categories if DynamoDB fails
          setCategories({
            '--': ['--'],
            'Electronics': ['Cell Phones', 'Computers', 'Gaming'],
            'Collectibles': ['Sports Cards', 'Coins', 'Comics'],
            'Clothing': ['Men', 'Women', 'Children']
          });
        }
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, [docClient]);

  const subcategories = categories[batchData.category] || ['--'];

  // Auto-select first subcategory when category changes
  useEffect(() => {
    if (batchData.category !== '--' && categories[batchData.category]) {
      const availableSubcategories = categories[batchData.category];
      if (availableSubcategories.length > 0 && availableSubcategories[0] !== '--') {
        // Auto-select the first valid subcategory
        setBatchData(prev => ({
          ...prev,
          subCategory: availableSubcategories[0]
        }));
      } else if (availableSubcategories.length > 1) {
        // If first is '--', select the second one
        setBatchData(prev => ({
          ...prev,
          subCategory: availableSubcategories[1]
        }));
      }
    }
  }, [batchData.category, categories]);

  const filteredTemplates = templates.filter(template => 
    (!template.category || template.category === batchData.category) &&
    (!template.subCategory || template.subCategory === batchData.subCategory)
  );

  const handleNext = () => {
    if (currentStep < 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Save batch and switch to edit mode
      const newBatch = createBatch(batchData);
      dispatch({ type: 'SET_CURRENT_BATCH', payload: newBatch });
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCancel = () => {
    dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        const hasName = batchData.name && batchData.name.trim().length > 0;
        const hasCategory = batchData.category && batchData.category !== '--';
        const hasSubCategory = batchData.subCategory && batchData.subCategory !== '--';
        
        return hasName && hasCategory && hasSubCategory;
      case 1:
        return true; // Optional step
      default:
        return false;
    }
  };

  return (
    <div className="batch-wizard-content">
      <div className="wizard-card">
        <div className="wizard-header">
          <h2>Create a new batch</h2>
          <button onClick={handleCancel} className="modal-close">×</button>
        </div>

        <div className="wizard-steps">
          <div className={`step ${currentStep >= 0 ? 'active' : ''} ${currentStep > 0 ? 'completed' : ''}`}>
            <span className="step-number">1</span>
            <span>General Settings</span>
          </div>
          <div className={`step ${currentStep >= 1 ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <span>Additional Details</span>
          </div>
        </div>

        <div className="wizard-content">
          {currentStep === 0 && (
            <div className="step-content">
              <h3>General Settings</h3>
              
              <div className="form-group">
                <label>Batch Name *</label>
                <input
                  type="text"
                  value={batchData.name}
                  onChange={(e) => setBatchData({...batchData, name: e.target.value})}
                  placeholder="Enter batch name"
                  className="form-control"
                  style={{
                    borderColor: batchData.name.trim() ? '#28a745' : '#ccc'
                  }}
                />
                {!batchData.name.trim() && (
                  <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                    Batch name is required
                  </small>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category *</label>
                  {categoriesLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="spinner">
                        <div className="spinner-circle"></div>
                      </div>
                      <span>Loading categories...</span>
                    </div>
                  ) : (
                    <>
                      <select
                        value={batchData.category}
                        onChange={(e) => {
                          const newCategory = e.target.value;
                          setBatchData({
                            ...batchData, 
                            category: newCategory,
                            subCategory: '--' // Reset subcategory when category changes
                          });
                        }}
                        className="form-control"
                        style={{
                          borderColor: batchData.category !== '--' ? '#28a745' : '#ccc'
                        }}
                      >
                        {Object.keys(categories).map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      {batchData.category === '--' && (
                        <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                          Please select a category
                        </small>
                      )}
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label>SubCategory *</label>
                  <select
                    value={batchData.subCategory}
                    onChange={(e) => {
                      const newSubCategory = e.target.value;
                      setBatchData({
                        ...batchData, 
                        subCategory: newSubCategory
                      });
                    }}
                    className="form-control"
                    disabled={categoriesLoading || batchData.category === '--'}
                    style={{
                      borderColor: batchData.subCategory !== '--' ? '#28a745' : '#ccc'
                    }}
                  >
                    {subcategories.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                  {batchData.subCategory === '--' && batchData.category !== '--' && (
                    <small style={{ color: '#dc3545', fontSize: '0.8rem' }}>
                      Please select a subcategory
                    </small>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>Description Template</label>
                <select
                  value={batchData.descriptionTemplate}
                  onChange={(e) => setBatchData({...batchData, descriptionTemplate: e.target.value})}
                  className="form-control"
                >
                  <option value="ai_generate">Let AI Generate Description</option>
                  {filteredTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <button 
                  type="button"
                  onClick={() => setShowTemplateModal(true)}
                  className="btn btn-sm btn-outline mt-2"
                >
                  + Create New Template
                </button>
              </div>

              {/* Validation Summary with fixed text color */}
              <div style={{ 
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: '#f8f9fa',
                borderRadius: '6px',
                border: '1px solid #e9ecef'
              }}>
                <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#495057' }}>
                  Required Fields:
                </h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.name.trim() ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.name.trim() ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>Batch Name</span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.category !== '--' ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.category !== '--' ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>Category</span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    fontSize: '0.85rem'
                  }}>
                    <span style={{ 
                      color: batchData.subCategory !== '--' ? '#28a745' : '#dc3545' 
                    }}>
                      {batchData.subCategory !== '--' ? '✓' : '○'}
                    </span>
                    <span style={{ color: '#333' }}>SubCategory</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="step-content">
              <h3>Additional Bulk Settings</h3>
              <p>Attributes selected below will be applied to all items added in your batch. Don't worry, you can always make changes later.</p>

              <div className="form-row">
                <div className="form-group">
                  <label>Condition</label>
                  <select
                    value={batchData.condition}
                    onChange={(e) => setBatchData({...batchData, condition: e.target.value})}
                    className="form-control"
                  >
                    <option value="NEW">New</option>
                    <option value="USED_EXCELLENT">Used - Excellent</option>
                    <option value="USED_GOOD">Used - Good</option>
                    <option value="USED_FAIR">Used - Fair</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Purchase Date</label>
                  <input
                    type="date"
                    value={batchData.purchaseDate}
                    onChange={(e) => setBatchData({...batchData, purchaseDate: e.target.value})}
                    className="form-control"
                  />
                </div>
              </div>

              {/* Updated form row for price and SKU inputs */}
              <div className="form-row price-row">
                <div className="form-group">
                  <label>Purchase Price</label>
                  <div className="input-group">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={batchData.purchasePrice}
                      onChange={(e) => setBatchData({...batchData, purchasePrice: e.target.value})}
                      placeholder="0.00"
                      className="form-control"
                      style={{ paddingLeft: '2rem' }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Sale Price</label>
                  <div className="input-group">
                    <span className="input-prefix">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={batchData.salePrice}
                      onChange={(e) => setBatchData({...batchData, salePrice: e.target.value})}
                      placeholder="0.00"
                      className="form-control"
                      style={{ paddingLeft: '2rem' }}
                    />
                  </div>
                </div>
              </div>

              {/* New SKU field */}
              <div className="form-group">
                <label>Default SKU</label>
                <input
                  type="text"
                  value={batchData.sku}
                  onChange={(e) => setBatchData({...batchData, sku: e.target.value})}
                  placeholder="Enter default SKU for this batch"
                  className="form-control"
                />
                <small style={{ color: '#666', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
                  This will be the default SKU for all items in this batch. You can modify individual SKUs later.
                </small>
              </div>

              <div className="form-group">
                <label>Batch Description</label>
                <textarea
                  value={batchData.batchDescription}
                  onChange={(e) => setBatchData({...batchData, batchDescription: e.target.value})}
                  placeholder="Optional description for this batch"
                  className="form-control"
                  rows="4"
                />
              </div>
            </div>
          )}
        </div>

        <div className="wizard-footer">
          <button 
            onClick={handlePrevious}
            disabled={currentStep === 0}
            className="btn btn-secondary"
          >
            Previous
          </button>
          <button 
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn btn-primary"
          >
            {currentStep === 1 ? 'Create Batch' : 'Continue'}
          </button>
        </div>
      </div>

      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        category={batchData.category}
        subCategory={batchData.subCategory}
      />
    </div>
  );
}

function BatchEditor() {
  const { currentBatch, updateBatch, dispatch, markCsvDownloaded, markEbayListingsCreated } = useBatch();
  const [showListingManager, setShowListingManager] = useState(false);
  const { state, dispatch: appDispatch } = useAppState();
  
  const updateTimeoutRef = useRef(null);
  const lastUpdateRef = useRef(null);
  
  useEffect(() => {
    if (currentBatch && currentBatch.appState) {
      console.log('Loading batch state into app state:', currentBatch);
      
      Object.entries(currentBatch.appState).forEach(([key, value]) => {
        const actionType = `SET_${key.toUpperCase()}`;
        console.log(`Dispatching ${actionType} with:`, value);
        appDispatch({ type: actionType, payload: value });
      });
      
      if (currentBatch.category && currentBatch.category !== '--') {
        console.log('Setting category to:', currentBatch.category);
        appDispatch({ type: 'SET_CATEGORY', payload: currentBatch.category });
      }
      if (currentBatch.subCategory && currentBatch.subCategory !== '--') {
        console.log('Setting subcategory to:', currentBatch.subCategory);
        appDispatch({ type: 'SET_SUBCATEGORY', payload: currentBatch.subCategory });
      }
      if (currentBatch.salePrice) {
        console.log('Setting price to:', currentBatch.salePrice);
        appDispatch({ type: 'SET_PRICE', payload: currentBatch.salePrice });
      }
      // Set SKU from batch if available
      if (currentBatch.sku) {
        console.log('Setting SKU to:', currentBatch.sku);
        appDispatch({ type: 'SET_SKU', payload: currentBatch.sku });
      }
    }
  }, [currentBatch, appDispatch]);

  useEffect(() => {
    if (currentBatch) {
      const hasValidListings = state.responseData.some(item => item && !item.error);
      
      let newStatus = currentBatch.status;
      if (hasValidListings && currentBatch.status === 'draft') {
        newStatus = 'ready';
      }
      
      const updatedBatch = {
        ...currentBatch,
        appState: {
          filesBase64: state.filesBase64,
          rawFiles: state.rawFiles,
          imageGroups: state.imageGroups,
          s3ImageGroups: state.s3ImageGroups,
          responseData: state.responseData,
          groupMetadata: state.groupMetadata,
          fieldSelections: state.fieldSelections,
          processedGroupIndices: state.processedGroupIndices,
          category: state.category,
          subCategory: state.subCategory,
          price: state.price,
          sku: state.sku,
          categoryID: state.categoryID
        },
        totalItems: state.responseData.filter(item => item && !item.error).length,
        status: newStatus,
        // Update the batch's default price and SKU with current values
        salePrice: state.price || currentBatch.salePrice,
        sku: state.sku || currentBatch.sku
      };
      
      const currentDataString = JSON.stringify(updatedBatch);
      if (lastUpdateRef.current !== currentDataString) {
        lastUpdateRef.current = currentDataString;
        
        if (updateTimeoutRef.current) {
          clearTimeout(updateTimeoutRef.current);
        }
        
        updateTimeoutRef.current = setTimeout(() => {
          updateBatch(updatedBatch);
        }, 300);
      }
    }
    
    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [state, currentBatch, updateBatch]);

  const handleGenerateListing = async (aiResolveCategoryFields = false, categoryFields = []) => {
    try {
      const { imageGroups, filesBase64, batchSize, processedGroupIndices, fieldSelections } = state;
   
      const nonEmptyGroups = imageGroups.filter(g => g.length > 0);

      if (nonEmptyGroups.length === 0 && filesBase64.length === 0) {
        return;
      }

      appDispatch({ type: 'SET_IS_LOADING', payload: true });

      const newGroupsToProcess = nonEmptyGroups.filter((group, idx) => {
        const originalIndex = imageGroups.findIndex(g => g === group);
        return !processedGroupIndices || !processedGroupIndices.includes(originalIndex);
      });
      
      const newGroupIndices = newGroupsToProcess.map(group => {
        return imageGroups.findIndex(g => g === group);
      });
      
      let allGroupsToProcess = [...newGroupsToProcess];
      let newPoolGroupIndices = [];
      
      if (filesBase64.length > 0 && batchSize > 0) {
        const poolGroups = [];
        for (let i = 0; i < filesBase64.length; i += batchSize) {
          poolGroups.push(filesBase64.slice(i, i + batchSize));
        }
        
        allGroupsToProcess = [...newGroupsToProcess, ...poolGroups];
        
        let updatedGroups = [...imageGroups];
        
        const firstEmptyGroupIndex = updatedGroups.findIndex(g => g.length === 0);
        let insertIndex = firstEmptyGroupIndex !== -1 ? firstEmptyGroupIndex : updatedGroups.length;
        
        const updatedMetadata = [...state.groupMetadata || []];
        
        poolGroups.forEach(group => {
          updatedGroups.splice(insertIndex, 0, group);
          newPoolGroupIndices.push(insertIndex);
          
          while (updatedMetadata.length <= insertIndex) {
            updatedMetadata.push(null);
          }
          // Use current SKU and price values, fallback to batch defaults, then global defaults
          updatedMetadata[insertIndex] = { 
            price: state.price || currentBatch?.salePrice || '', 
            sku: state.sku || currentBatch?.sku || '',
            fieldSelections: { ...fieldSelections }
          };
          
          insertIndex++;
        });
        
        appDispatch({ type: 'UPDATE_GROUP_METADATA', payload: updatedMetadata });
        
        if (updatedGroups[updatedGroups.length - 1]?.length !== 0) {
          updatedGroups.push([]);
        }
        
        appDispatch({ type: 'SET_IMAGE_GROUPS', payload: updatedGroups });
      }

      if (allGroupsToProcess.length === 0) {
        alert("No new images to process. All existing groups have already been generated.");
        appDispatch({ type: 'SET_IS_LOADING', payload: false });
        return;
      }

      const totalGroups = allGroupsToProcess.length;
      
      const processingStatus = {
        isProcessing: true,
        processTotal: totalGroups,
        processCompleted: 0
      };
      
      appDispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: processingStatus
      });
      
      appDispatch({ type: 'SET_TOTAL_CHUNKS', payload: totalGroups });
      appDispatch({ type: 'SET_COMPLETED_CHUNKS', payload: 0 });
      
      const updatedResponseData = [...state.responseData];
      const updatedProcessingGroups = [...state.processingGroups];
      
      [...newGroupIndices, ...newPoolGroupIndices].forEach(index => {
        while (updatedResponseData.length <= index) {
          updatedResponseData.push(null);
        }
        
        while (updatedProcessingGroups.length <= index) {
          updatedProcessingGroups.push(false);
        }
        
        updatedResponseData[index] = null;
        updatedProcessingGroups[index] = true;
      });
      
      appDispatch({ type: 'SET_RESPONSE_DATA', payload: updatedResponseData });
      appDispatch({ type: 'SET_IS_DIRTY', payload: false });
      appDispatch({ type: 'SET_PROCESSING_GROUPS', payload: updatedProcessingGroups });

      const selectedCategoryOptions = getSelectedCategoryOptionsJSON(
        fieldSelections, 
        state.price, 
        state.sku, 
        {}
      );   
      
      if (aiResolveCategoryFields) {
        selectedCategoryOptions._aiResolveCategoryFields = true;
        selectedCategoryOptions._categoryFields = categoryFields;
      }
      
      const currentFieldSelections = {...fieldSelections};
      const processedIndices = [];
      
      const PROCESSING_BATCH_SIZE = 40;
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 2000;
      
      const processGroupWithRetry = async (group, actualIndex, retryCount = 0) => {
        try {
          const response = await fetch(
            "https://7f26uyyjs5.execute-api.us-east-2.amazonaws.com/ListEasily/ListEasilyAPI",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                category: state.category,
                subCategory: state.subCategory,
                Base64Key: [group],
                SelectedCategoryOptions: selectedCategoryOptions
              })
            }
          );
          
          if (!response.ok) {
            if (response.status === 504 && retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
              return processGroupWithRetry(group, actualIndex, retryCount + 1);
            }
            
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          let parsed = data.body;
          if (typeof parsed === "string") parsed = JSON.parse(parsed);
          
          return { 
            index: actualIndex, 
            result: Array.isArray(parsed) ? parsed[0] : parsed,
            success: true
          };
        } catch (err) {
          return { 
            index: actualIndex, 
            error: true, 
            result: { 
              error: "Failed to fetch listing data", 
              raw_content: err.message 
            },
            success: false
          };
        }
      };
      
      const results = [];
      
      for (let batchStart = 0; batchStart < allGroupsToProcess.length; batchStart += PROCESSING_BATCH_SIZE) {
        const currentBatch = allGroupsToProcess.slice(batchStart, batchStart + PROCESSING_BATCH_SIZE);
        const batchIndices = [];
        
        for (let i = 0; i < currentBatch.length; i++) {
          const batchItemIndex = batchStart + i;
          let actualIndex;
          
          if (batchItemIndex < newGroupIndices.length) {
            actualIndex = newGroupIndices[batchItemIndex];
          } else {
            const poolArrayIndex = batchItemIndex - newGroupIndices.length;
            actualIndex = newPoolGroupIndices[poolArrayIndex];
          }
          
          batchIndices.push(actualIndex);
          processedIndices.push(actualIndex);
        }
        
        processingStatus.currentGroup = batchStart + 1;
        appDispatch({ 
          type: 'SET_PROCESSING_STATUS', 
          payload: { ...processingStatus }
        });
        
        const batchPromises = currentBatch.map((group, idx) => 
          processGroupWithRetry(group, batchIndices[idx])
        );
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        const completedCount = Math.min(batchStart + PROCESSING_BATCH_SIZE, allGroupsToProcess.length);
        processingStatus.processCompleted = completedCount;
        appDispatch({ 
          type: 'SET_PROCESSING_STATUS', 
          payload: { ...processingStatus }
        });
        
        batchResults.forEach(({ index, result, error, success }) => {
          let finalStoredSelections = { ...currentFieldSelections };
          
          if (aiResolveCategoryFields && success && result && typeof result === 'object' && result.aiResolvedFields) {
            try {
              const merged = { ...currentFieldSelections };
              
              Object.entries(result.aiResolvedFields).forEach(([fieldName, aiValue]) => {
                const currentValue = currentFieldSelections[fieldName];
                
                if (!currentValue || currentValue === "-- Select --" || currentValue.trim() === "") {
                  if (aiValue && aiValue !== "Unknown" && aiValue !== "Not Specified" && aiValue.trim() !== "") {
                    merged[fieldName] = aiValue.trim();
                  }
                }
              });

              finalStoredSelections = merged;
            } catch (mergeError) {
              console.error(`Error merging AI fields for group ${index}:`, mergeError);
            }
          }
          
          const safeResult = result || { 
            error: error ? "Processing failed" : "Unknown error",
            title: "",
            description: ""
          };
          
          appDispatch({
            type: 'UPDATE_RESPONSE_DATA',
            payload: { 
              index, 
              value: {
                ...safeResult,
                storedFieldSelections: finalStoredSelections
              }
            }
          });
          
          appDispatch({
            type: 'UPDATE_PROCESSING_GROUP',
            payload: { index, value: false }
          });
        });
        
        if (batchStart + PROCESSING_BATCH_SIZE < allGroupsToProcess.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      processingStatus.processCompleted = totalGroups;
      processingStatus.currentGroup = totalGroups;
      
      appDispatch({ 
        type: 'SET_PROCESSING_STATUS', 
        payload: processingStatus
      });
      
      appDispatch({ type: 'SET_COMPLETED_CHUNKS', payload: totalGroups });
      appDispatch({ type: 'MARK_GROUPS_AS_PROCESSED', payload: processedIndices });
      
      if (filesBase64.length > 0) {
        appDispatch({ type: 'SET_FILES_BASE64', payload: [] });
      }
      
      if (aiResolveCategoryFields) {
        try {
          const aiResolvedCount = results.filter(r => 
            r && r.success && r.result && r.result.aiResolvedFields && 
            Object.keys(r.result.aiResolvedFields).length > 0
          ).length;
          
          if (aiResolvedCount > 0) {
            setTimeout(() => {
              alert(`🤖 AI successfully resolved category fields across ${aiResolvedCount} listings.`);
            }, 1000);
          }
        } catch (summaryError) {
          console.error('Error generating AI resolution summary:', summaryError);
        }
      }
      
      setTimeout(() => {
        appDispatch({ type: 'RESET_STATUS' });
        appDispatch({ type: 'SET_IS_LOADING', payload: false });
      }, 500);
      
      return true;
      
    } catch (error) {
      console.error("Error in generate listing process:", error);
      alert(`An error occurred: ${error.message}`);
      appDispatch({ type: 'RESET_STATUS' });
      appDispatch({ type: 'SET_IS_LOADING', payload: false });
      throw error;
    }
  };

  const handleBackToOverview = () => {
    dispatch({ type: 'SET_CURRENT_BATCH', payload: null });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
  };

  const handleCsvDownload = () => {
    if (currentBatch) {
      markCsvDownloaded(currentBatch.id);
    }
  };

  const handleEbayListingsCreated = (listingsCount) => {
    console.log('handleEbayListingsCreated called with count:', listingsCount);
    if (currentBatch) {
      markEbayListingsCreated(currentBatch.id, listingsCount);
    }
  };

  const handleShowEbayListingManager = () => {
    console.log('BatchEditor: Showing eBay listing manager');
    setShowListingManager(true);
  };

  const handleCloseEbayListingManager = () => {
    console.log('BatchEditor: Closing eBay listing manager');
    setShowListingManager(false);
  };

  if (!currentBatch) {
    return null;
  }

  return (
    <div className="batch-editor-content">
      <div className="batch-editor-header">
        <div className="header-left">
          <button 
            onClick={handleBackToOverview}
            className="back-button"
          >
            ← Back to Batches
          </button>
          <div className="batch-info">
            <h1>{currentBatch.name}</h1>
            <span className="batch-status">{currentBatch.status}</span>
          </div>
        </div>
      </div>

      <main className="main-card">
        <FormSection 
          onGenerateListing={handleGenerateListing}
          batchMode={true}
          currentBatch={currentBatch}
        />
        <BatchPreviewSection 
          onShowListingManager={handleShowEbayListingManager}
          currentBatch={currentBatch}
          onCsvDownload={handleCsvDownload}
          onEbayListingsCreated={handleEbayListingsCreated}
        />
      </main>

      {showListingManager && (
        <div className="listing-modal-overlay">
          <div className="listing-modal">
            <EbayListingManager 
              onClose={handleCloseEbayListingManager}
              onListingsCreated={handleEbayListingsCreated}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Main App Layout Component
function AppLayout() {
  const { viewMode, currentBatch, dispatch, sidebarCollapsed } = useBatch();

  useEffect(() => {
    if (viewMode === 'edit' && !currentBatch) {
      console.log('No current batch in edit mode, redirecting to overview');
      dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
    }
  }, [viewMode, currentBatch, dispatch]);

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar />
      <div className="main-content">
        <MainHeader />
        <div className="content-area">
          {viewMode === 'overview' && <BatchOverview />}
          {viewMode === 'create' && <BatchWizard />}
          {viewMode === 'edit' && currentBatch && <BatchEditor />}
          {viewMode === 'edit' && !currentBatch && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              height: '50vh',
              flexDirection: 'column'
            }}>
              <div className="spinner">
                <div className="spinner-circle"></div>
              </div>
              <p>Loading batch...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main App Content
function AppContent() {
  return <AppLayout />;
}

// Updated EbayCallback component
const EbayCallback = () => {
  const { handleAuthCallback } = useEbayAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authCode = urlParams.get('code');
    const error = urlParams.get('error');
    const errorDescription = urlParams.get('error_description');
    
    const processedKey = `ebay_callback_processed_${authCode || error || 'unknown'}`;
    const alreadyProcessed = sessionStorage.getItem(processedKey);
    
    if (alreadyProcessed) {
      setError('This authorization has already been processed. Please try logging in again.');
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
      return;
    }

    if (error) {
      sessionStorage.setItem(processedKey, 'true');
      const errorParam = encodeURIComponent(errorDescription || error);
      window.location.href = '/?ebay_error=' + errorParam;
      return;
    }

    if (authCode) {
      sessionStorage.setItem(processedKey, 'true');
      
      const exchangeTimeout = setTimeout(() => {
        setError('The authentication process timed out. Please try again.');
        setTimeout(() => {
          window.location.href = '/?ebay_error=timeout';
        }, 3000);
      }, 30000);
      
      handleAuthCallback(authCode).then(success => {
        clearTimeout(exchangeTimeout);
        
        if (success) {
          setTimeout(() => {
            window.location.href = '/?ebay_connected=true';
          }, 100);
        } else {
          window.location.href = '/?ebay_error=authentication_failed';
        }
      }).catch(callbackError => {
        clearTimeout(exchangeTimeout);
        
        if (callbackError.message.includes('already been used')) {
          setError('This authorization code has already been used. Please log in again.');
        } else if (callbackError.message.includes('invalid_grant')) {
          setError('The authorization has expired or is invalid. Please try logging in again.');
        } else {
          setError(`Authentication failed: ${callbackError.message}`);
        }
        
        setTimeout(() => {
          window.location.href = '/?ebay_error=' + encodeURIComponent(callbackError.message || 'callback_error');
        }, 3000);
      });
    } else {
      window.location.href = '/?ebay_error=invalid_callback';
    }
  }, [handleAuthCallback]);

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      flexDirection: 'column',
      padding: '20px'
    }}>
      {error ? (
        <>
          <div style={{
            color: '#dc3545',
            fontSize: '1.2rem',
            marginBottom: '1rem',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            {error}
          </div>
          <p style={{ color: '#666' }}>Redirecting...</p>
        </>
      ) : (
        <>
          <div className="spinner">
            <div className="spinner-circle"></div>
          </div>
          <p>Processing eBay authentication...</p>
          <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '1rem' }}>
            This may take a few seconds...
          </p>
        </>
      )}
    </div>
  );
};

function App() {
  const pathname = window.location.pathname;
  if (pathname === '/ebay/callback' || pathname === '/ebay/callback/') {
    return (
      <EbayAuthProvider>
        <EbayCallback />
      </EbayAuthProvider>
    );
  }

  return (
    <EbayAuthProvider>
      <AppStateProvider>
        <BatchProvider>
          <AppContent />
        </BatchProvider>
      </AppStateProvider>
    </EbayAuthProvider>
  );
}

export default App;