import React, { useState, useEffect, createContext, useContext, useReducer } from 'react';

// Batch Context for managing batches and templates
const BatchContext = createContext();

const initialBatchState = {
  batches: [],
  templates: [],
  currentBatch: null,
  currentStep: 0
};

function batchReducer(state, action) {
  switch (action.type) {
    case 'LOAD_BATCHES':
      return { ...state, batches: action.payload };
    case 'CREATE_BATCH':
      return { 
        ...state, 
        batches: [...state.batches, action.payload],
        currentBatch: action.payload
      };
    case 'UPDATE_BATCH':
      return {
        ...state,
        batches: state.batches.map(batch => 
          batch.id === action.payload.id ? action.payload : batch
        ),
        currentBatch: action.payload
      };
    case 'SET_CURRENT_BATCH':
      return { ...state, currentBatch: action.payload };
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

export function BatchProvider({ children }) {
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
      totalItems: 0
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

export function useBatch() {
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
  const { createTemplate, updateTemplate, templates } = useBatch();
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

// Batch Overview Page
function BatchOverview({ onCreateBatch, onEditBatch }) {
  const { batches } = useBatch();

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

  return (
    <div className="batch-overview">
      <div className="page-header">
        <h1>Your Batches</h1>
        <button onClick={onCreateBatch} className="btn btn-primary">
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
            <button onClick={onCreateBatch} className="btn btn-primary">
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
                  <span className="preview-icon">📝</span> {batch.totalItems || 0}
                  <span className="preview-icon">⏱️</span> {batch.totalItems || 0}
                  <span className="preview-icon">⏰</span> 1
                  <span className="preview-icon">✅</span> 0
                </div>
              </div>
              <div className="td">
                {formatDate(batch.createdAt)}
              </div>
              <div className="td">
                <button 
                  onClick={() => onEditBatch(batch)}
                  className="btn btn-sm btn-outline"
                >
                  Open
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Multi-step Batch Creation Wizard
function BatchWizard({ isOpen, onClose, editingBatch }) {
  const { createBatch, updateBatch, templates } = useBatch();
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

  // Mock categories - in real app, fetch from your existing API
  const categories = {
    '--': ['--'],
    'Electronics': ['Cell Phones', 'Computers', 'Gaming'],
    'Collectibles': ['Sports Cards', 'Coins', 'Comics'],
    'Clothing': ['Men', 'Women', 'Children']
  };

  const subcategories = categories[batchData.category] || ['--'];

  const filteredTemplates = templates.filter(template => 
    (!template.category || template.category === batchData.category) &&
    (!template.subCategory || template.subCategory === batchData.subCategory)
  );

  useEffect(() => {
    if (editingBatch) {
      setBatchData(editingBatch);
    }
  }, [editingBatch]);

  const handleNext = () => {
    if (currentStep < 2) {
      setCurrentStep(currentStep + 1);
    } else {
      // Save batch
      if (editingBatch) {
        updateBatch(batchData);
      } else {
        createBatch(batchData);
      }
      onClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return batchData.name && batchData.category !== '--' && batchData.subCategory !== '--';
      case 1:
        return true; // Optional step
      case 2:
        return true; // Image upload step would have its own validation
      default:
        return false;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content batch-wizard">
        <div className="wizard-header">
          <h2>Create a new batch</h2>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="wizard-steps">
          <div className={`step ${currentStep >= 0 ? 'active' : ''} ${currentStep > 0 ? 'completed' : ''}`}>
            <span className="step-number">1</span>
            <span>General Settings</span>
          </div>
          <div className={`step ${currentStep >= 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
            <span className="step-number">2</span>
            <span>Optional Details</span>
          </div>
          <div className={`step ${currentStep >= 2 ? 'active' : ''}`}>
            <span className="step-number">3</span>
            <span>Upload Images</span>
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
                  <label>Batch Type</label>
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
                </div>
                <div className="form-group">
                  <label>SubCategory</label>
                  <select
                    value={batchData.subCategory}
                    onChange={(e) => setBatchData({...batchData, subCategory: e.target.value})}
                    className="form-control"
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
              <p>Attributes selected below will be applied to all cards added in your batch. Don't worry, you can always make changes later.</p>

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

          {currentStep === 2 && (
            <div className="step-content">
              <h3>Upload Images</h3>
              <p>Upload and organize your images for this batch.</p>
              
              <div className="image-upload-placeholder">
                <div className="upload-zone">
                  <div className="upload-icon">📁</div>
                  <h4>Drag and drop images here</h4>
                  <p>or click to browse</p>
                  <button className="btn btn-primary">Choose Files</button>
                </div>
              </div>
              
              <div className="image-tools">
                <h4>Image Tools</h4>
                <div className="tools-grid">
                  <button className="tool-btn">🔄 Rotate Selected</button>
                  <button className="tool-btn">🖼️ Replace Image</button>
                  <button className="tool-btn">🗑️ Delete Selected</button>
                  <button className="tool-btn">📋 Group Images</button>
                </div>
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
            {currentStep === 2 ? 'Create Batch' : 'Continue'}
          </button>
        </div>
      </div>

      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        category={batchData.category}
        subCategory={batchData.subCategory}
      />

      <style jsx>{`
        .batch-overview {
          padding: 2rem;
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          display: flex;
          justify-content: between;
          align-items: center;
          margin-bottom: 2rem;
        }

        .page-header h1 {
          margin: 0;
          color: #333;
        }

        .batch-filters {
          display: flex;
          gap: 1rem;
          margin-bottom: 1.5rem;
        }

        .filter-btn {
          padding: 0.5rem 1rem;
          border: 1px solid #ddd;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filter-btn.active {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }

        .batch-table {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .table-header, .table-row {
          display: grid;
          grid-template-columns: 2fr 1fr 2fr 1.5fr 1fr;
          gap: 1rem;
          padding: 1rem;
          border-bottom: 1px solid #eee;
        }

        .table-header {
          background: #f8f9fa;
          font-weight: 600;
          color: #333;
        }

        .table-row:hover {
          background: #f8f9fa;
        }

        .batch-name-cell {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .batch-thumbnail {
          width: 40px;
          height: 40px;
          background: #007bff;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 1.2rem;
        }

        .status-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          color: white;
          font-size: 0.85rem;
          font-weight: 500;
          text-transform: capitalize;
        }

        .batch-preview {
          display: flex;
          gap: 1rem;
          align-items: center;
          font-size: 0.9rem;
          color: #666;
        }

        .preview-icon {
          margin-right: 0.25rem;
        }

        .empty-state {
          text-align: center;
          padding: 3rem 2rem;
          color: #666;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          border-radius: 8px;
          max-height: 90vh;
          overflow-y: auto;
          width: 90%;
          max-width: 800px;
        }

        .batch-wizard {
          max-width: 900px;
        }

        .wizard-header {
          display: flex;
          justify-content: between;
          align-items: center;
          padding: 1.5rem 2rem;
          border-bottom: 1px solid #eee;
        }

        .wizard-header h2 {
          margin: 0;
          color: #333;
        }

        .modal-close {
          background: none;
          border: none;
          font-size: 1.5rem;
          color: #666;
          cursor: pointer;
          padding: 0.5rem;
        }

        .wizard-steps {
          display: flex;
          justify-content: center;
          padding: 2rem;
          background: #f8f9fa;
        }

        .step {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0 2rem;
          position: relative;
          color: #666;
        }

        .step:not(:last-child)::after {
          content: '';
          position: absolute;
          right: -1rem;
          width: 2rem;
          height: 2px;
          background: #ddd;
          top: 50%;
          transform: translateY(-50%);
        }

        .step.active {
          color: #007bff;
        }

        .step.completed {
          color: #28a745;
        }

        .step.completed::after {
          background: #28a745;
        }

        .step-number {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          background: #ddd;
          color: white;
          font-weight: bold;
          font-size: 0.9rem;
        }

        .step.active .step-number {
          background: #007bff;
        }

        .step.completed .step-number {
          background: #28a745;
        }

        .wizard-content {
          padding: 2rem;
        }

        .step-content h3 {
          margin: 0 0 1rem 0;
          color: #333;
        }

        .step-content p {
          color: #666;
          margin-bottom: 1.5rem;
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: #333;
        }

        .form-control {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 1rem;
          background: white;
          color: #333;
        }

        .form-control:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0,123,255,0.1);
        }

        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
        }

        .location-grid {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 1rem;
        }

        .input-group {
          position: relative;
        }

        .input-prefix {
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          color: #666;
          z-index: 1;
        }

        .input-group .form-control {
          padding-left: 2rem;
        }

        .wizard-footer {
          display: flex;
          justify-content: between;
          gap: 1rem;
          padding: 1.5rem 2rem;
          border-top: 1px solid #eee;
          background: #f8f9fa;
        }

        .btn {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 4px;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
          display: inline-block;
          text-align: center;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: #0056b3;
        }

        .btn-secondary {
          background: #6c757d;
          color: white;
        }

        .btn-secondary:hover:not(:disabled) {
          background: #545b62;
        }

        .btn-outline {
          background: transparent;
          border: 1px solid #007bff;
          color: #007bff;
        }

        .btn-outline:hover {
          background: #007bff;
          color: white;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-sm {
          padding: 0.5rem 1rem;
          font-size: 0.9rem;
        }

        .mt-2 {
          margin-top: 0.5rem;
        }

        .image-upload-placeholder {
          border: 2px dashed #ddd;
          border-radius: 8px;
          padding: 3rem;
          text-align: center;
          margin-bottom: 2rem;
        }

        .upload-zone {
          color: #666;
        }

        .upload-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .upload-zone h4 {
          margin: 0.5rem 0;
          color: #333;
        }

        .image-tools {
          background: #f8f9fa;
          padding: 1.5rem;
          border-radius: 8px;
        }

        .image-tools h4 {
          margin: 0 0 1rem 0;
          color: #333;
        }

        .tools-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
        }

        .tool-btn {
          padding: 0.75rem;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }

        .tool-btn:hover {
          background: #e9ecef;
          border-color: #007bff;
        }

        .wysiwyg-container {
          border: 1px solid #ddd;
          border-radius: 4px;
          overflow: hidden;
        }

        .wysiwyg-toolbar {
          display: flex;
          gap: 0.25rem;
          padding: 0.5rem;
          background: #f8f9fa;
          border-bottom: 1px solid #ddd;
        }

        .toolbar-btn {
          padding: 0.5rem;
          background: white;
          border: 1px solid #ddd;
          border-radius: 3px;
          cursor: pointer;
          font-size: 0.9rem;
          min-width: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .toolbar-btn:hover {
          background: #e9ecef;
        }

        .toolbar-separator {
          width: 1px;
          background: #ddd;
          margin: 0.25rem;
        }

        .wysiwyg-editor {
          min-height: 120px;
          padding: 12px;
          border: none;
          outline: none;
          background: white;
          color: #333;
        }

        .wysiwyg-editor:empty::before {
          content: attr(data-placeholder);
          color: #999;
          font-style: italic;
        }

        .modal-header {
          display: flex;
          justify-content: between;
          align-items: center;
          padding: 1.5rem;
          border-bottom: 1px solid #eee;
        }

        .modal-body {
          padding: 1.5rem;
        }

        .modal-footer {
          display: flex;
          gap: 1rem;
          justify-content: flex-end;
          padding: 1.5rem;
          border-top: 1px solid #eee;
          background: #f8f9fa;
        }

        @media (max-width: 768px) {
          .batch-overview {
            padding: 1rem;
          }

          .batch-table {
            overflow-x: auto;
          }

          .table-header, .table-row {
            grid-template-columns: 1fr;
            gap: 0.5rem;
          }

          .form-row {
            grid-template-columns: 1fr;
          }

          .location-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .wizard-content {
            padding: 1rem;
          }

          .wizard-footer {
            padding: 1rem;
          }

          .tools-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

// Main App Component
function BatchApp() {
  const [currentView, setCurrentView] = useState('overview'); // 'overview', 'wizard', 'edit'
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const handleCreateBatch = () => {
    setSelectedBatch(null);
    setIsWizardOpen(true);
  };

  const handleEditBatch = (batch) => {
    setSelectedBatch(batch);
    setCurrentView('edit');
  };

  const handleCloseWizard = () => {
    setIsWizardOpen(false);
    setSelectedBatch(null);
  };

  return (
    <BatchProvider>
      <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        {currentView === 'overview' && (
          <BatchOverview 
            onCreateBatch={handleCreateBatch}
            onEditBatch={handleEditBatch}
          />
        )}

        <BatchWizard
          isOpen={isWizardOpen}
          onClose={handleCloseWizard}
          editingBatch={selectedBatch}
        />
      </div>
    </BatchProvider>
  );
}

export default BatchApp;