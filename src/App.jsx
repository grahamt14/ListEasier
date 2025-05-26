import { useState, useEffect } from 'react';
import './App.css';
import FormSection, { getSelectedCategoryOptionsJSON } from './FormSection';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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
  viewMode: 'overview' // 'overview', 'create', 'edit'
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

function BatchProvider({ children }) {
  const [state, dispatch] = useReducer(batchReducer, initialBatchState);

  // Load batches and templates from localStorage on mount
  useEffect(() => {
    const savedBatches = localStorage.getItem('listeasier_batches');
    const savedTemplates = localStorage.getItem('listeasier_templates');
    
    if (savedBatches) {
      dispatch({ type: 'LOAD_BATCHES', payload: JSON.parse(savedBatches) });
    }
    
    if (savedTemplates) {
      dispatch({ type: 'LOAD_TEMPLATES', payload: JSON.parse(savedTemplates) });
    }
  }, []);

  // Save to localStorage whenever batches or templates change
  useEffect(() => {
    localStorage.setItem('listeasier_batches', JSON.stringify(state.batches));
  }, [state.batches]);

  useEffect(() => {
    localStorage.setItem('listeasier_templates', JSON.stringify(state.templates));
  }, [state.templates]);

  const createBatch = (batchData) => {
    const newBatch = {
      id: Date.now().toString(),
      ...batchData,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
      totalItems: 0,
      // Initialize with empty app state structure
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
    return newBatch;
  };

  const updateBatch = (batchData) => {
    const updatedBatch = {
      ...batchData,
      updatedAt: new Date().toISOString()
    };
    dispatch({ type: 'UPDATE_BATCH', payload: updatedBatch });
  };

  const deleteBatch = (batchId) => {
    dispatch({ type: 'DELETE_BATCH', payload: batchId });
  };

  const createTemplate = (templateData) => {
    const newTemplate = {
      id: Date.now().toString(),
      ...templateData,
      createdAt: new Date().toISOString()
    };
    dispatch({ type: 'ADD_TEMPLATE', payload: newTemplate });
    return newTemplate;
  };

  const updateTemplate = (templateData) => {
    dispatch({ type: 'UPDATE_TEMPLATE', payload: templateData });
  };

  const deleteTemplate = (templateId) => {
    dispatch({ type: 'DELETE_TEMPLATE', payload: templateId });
  };

  const contextValue = {
    ...state,
    dispatch,
    createBatch,
    updateBatch,
    deleteBatch,
    createTemplate,
    updateTemplate,
    deleteTemplate
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

// Batch Overview Page
function BatchOverview() {
  const { batches, dispatch, deleteBatch } = useBatch();
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, batch: null });

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return '#6c757d';
      case 'processing': return '#007bff';
      case 'completed': return '#28a745';
      case 'error': return '#dc3545';
      default: return '#6c757d';
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

  const handleCreateBatch = () => {
    dispatch({ type: 'SET_VIEW_MODE', payload: 'create' });
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

  return (
    <div className="batch-overview">
      <div className="page-header">
        <h1>Your Batches</h1>
        <button onClick={handleCreateBatch} className="btn btn-primary">
          + Add Batch
        </button>
      </div>

      <div className="batch-filters">
        <button className="filter-btn active">All</button>
        <button className="filter-btn">Open</button>
        <button className="filter-btn">Closed</button>
      </div>

      <div className="batch-table">
        <div className="table-header">
          <div className="th">Batch Name</div>
          <div className="th">Status</div>
          <div className="th">Batch Preview</div>
          <div className="th">Date Created</div>
          <div className="th">Actions</div>
        </div>

        {batches.length === 0 ? (
          <div className="empty-state">
            <h3>No batches yet</h3>
            <p>Create your first batch to get started</p>
            <button onClick={handleCreateBatch} className="btn btn-primary">
              Create Batch
            </button>
          </div>
        ) : (
          batches.map(batch => (
            <div key={batch.id} className="table-row">
              <div className="td">
                <div className="batch-name-cell">
                  <div className="batch-thumbnail">
                    {batch.category && batch.category.charAt(0)}
                  </div>
                  <span>{batch.name}</span>
                </div>
              </div>
              <div className="td">
                <span 
                  className="status-badge" 
                  style={{ backgroundColor: getStatusColor(batch.status) }}
                >
                  {batch.status}
                </span>
              </div>
              <div className="td">
                <div className="batch-preview">
                  <span className="preview-icon">📝</span> {batch.appState?.responseData?.length || 0}
                  <span className="preview-icon">📷</span> {batch.appState?.imageGroups?.filter(g => g.length > 0).length || 0}
                  <span className="preview-icon">✅</span> {batch.appState?.processedGroupIndices?.length || 0}
                </div>
              </div>
              <div className="td">
                {formatDate(batch.createdAt)}
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
          ))
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

// Updated BatchWizard component with proper imports
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
    cabinet: '',
    shelf: '',
    box: '',
    row: '',
    section: '',
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
        return batchData.name && batchData.category !== '--' && batchData.subCategory !== '--';
      case 1:
        return true; // Optional step
      default:
        return false;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content batch-wizard">
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
                <label>Batch Name</label>
                <input
                  type="text"
                  value={batchData.name}
                  onChange={(e) => setBatchData({...batchData, name: e.target.value})}
                  placeholder="Batch name"
                  className="form-control"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  {categoriesLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div className="spinner">
                        <div className="spinner-circle"></div>
                      </div>
                      <span>Loading categories...</span>
                    </div>
                  ) : (
                    <select
                      value={batchData.category}
                      onChange={(e) => setBatchData({
                        ...batchData, 
                        category: e.target.value,
                        subCategory: '--'
                      })}
                      className="form-control"
                    >
                      {Object.keys(categories).map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-group">
                  <label>SubCategory</label>
                  <select
                    value={batchData.subCategory}
                    onChange={(e) => setBatchData({...batchData, subCategory: e.target.value})}
                    className="form-control"
                    disabled={categoriesLoading}
                  >
                    {subcategories.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
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

              <div className="form-row">
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
                    />
                  </div>
                </div>
              </div>

              <div className="location-grid">
                <div className="form-group">
                  <label>Cabinet</label>
                  <input
                    type="text"
                    value={batchData.cabinet}
                    onChange={(e) => setBatchData({...batchData, cabinet: e.target.value})}
                    placeholder="Cabinet"
                    className="form-control"
                  />
                </div>
                <div className="form-group">
                  <label>Shelf</label>
                  <input
                    type="text"
                    value={batchData.shelf}
                    onChange={(e) => setBatchData({...batchData, shelf: e.target.value})}
                    placeholder="Shelf"
                    className="form-control"
                  />
                </div>
                <div className="form-group">
                  <label>Box</label>
                  <input
                    type="text"
                    value={batchData.box}
                    onChange={(e) => setBatchData({...batchData, box: e.target.value})}
                    placeholder="Box"
                    className="form-control"
                  />
                </div>
                <div className="form-group">
                  <label>Row</label>
                  <input
                    type="text"
                    value={batchData.row}
                    onChange={(e) => setBatchData({...batchData, row: e.target.value})}
                    placeholder="Row"
                    className="form-control"
                  />
                </div>
                <div className="form-group">
                  <label>Section</label>
                  <input
                    type="text"
                    value={batchData.section}
                    onChange={(e) => setBatchData({...batchData, section: e.target.value})}
                    placeholder="Section"
                    className="form-control"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Batch Description</label>
                <textarea
                  value={batchData.batchDescription}
                  onChange={(e) => setBatchData({...batchData, batchDescription: e.target.value})}
                  placeholder="Batch description"
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

// Batch Editor - integrates with existing FormSection and PreviewSection
function BatchEditor() {
  const { currentBatch, updateBatch, dispatch } = useBatch();
  const [showListingManager, setShowListingManager] = useState(false);
  const { state, dispatch: appDispatch } = useAppState();
  
  // Initialize app state from batch data when batch changes
  useEffect(() => {
    if (currentBatch && currentBatch.appState) {
      // Load batch state into app state
      Object.entries(currentBatch.appState).forEach(([key, value]) => {
        appDispatch({ type: `SET_${key.toUpperCase()}`, payload: value });
      });
      
      // Set category and form data
      if (currentBatch.category) {
        appDispatch({ type: 'SET_CATEGORY', payload: currentBatch.category });
      }
      if (currentBatch.subCategory) {
        appDispatch({ type: 'SET_SUBCATEGORY', payload: currentBatch.subCategory });
      }
      if (currentBatch.salePrice) {
        appDispatch({ type: 'SET_PRICE', payload: currentBatch.salePrice });
      }
    }
  }, [currentBatch, appDispatch]);

  // Save app state to batch whenever app state changes
  useEffect(() => {
    if (currentBatch) {
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
        totalItems: state.responseData.filter(item => item && !item.error).length
      };
      updateBatch(updatedBatch);
    }
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
          updatedMetadata[insertIndex] = { 
            price: state.price, 
            sku: state.sku,
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
        {} // No eBay policies in batch mode
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
    dispatch({ type: 'SET_VIEW_MODE', payload: 'overview' });
    dispatch({ type: 'SET_CURRENT_BATCH', payload: null });
  };

  if (!currentBatch) {
    return null;
  }

  return (
    <div className="batch-editor">
      <header className="batch-editor-header">
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
      </header>

      <main className="main-card">
        <FormSection 
          onGenerateListing={handleGenerateListing}
          batchMode={true}
          currentBatch={currentBatch}
        />
        <BatchPreviewSection 
          onShowListingManager={() => setShowListingManager(true)}
          currentBatch={currentBatch}
        />
      </main>

      {showListingManager && (
        <div className="listing-modal-overlay">
          <div className="listing-modal">
            <EbayListingManager 
              onClose={() => setShowListingManager(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Main App Component
function AppContent() {
  const { viewMode } = useBatch();

  return (
    <div className="app-container">
      {viewMode === 'overview' && <BatchOverview />}
      {viewMode === 'create' && <BatchWizard />}
      {viewMode === 'edit' && <BatchEditor />}

      <footer className="footer">
        <p>© 2025 ListEasier</p>
      </footer>
    </div>
  );
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