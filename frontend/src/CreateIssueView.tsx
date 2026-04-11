import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { get_api, type ComponentSummary, type CreateBugRequest } from './api/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface CreateIssueViewProps {
  username: string;
}

const CreateIssueView: React.FC<CreateIssueViewProps> = ({ username }) => {
  const navigate = useNavigate();
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [componentId, setComponentId] = useState<number | ''>('');
  const [type, setType] = useState('Bug');
  const [priority, setPriority] = useState('P2');
  const [severity, setSeverity] = useState('S2');
  const [assignee, setAssignee] = useState('');
  const [verifier, setVerifier] = useState('');
  const [collaborators, setCollaborators] = useState('');
  const [cc, setCc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchComponents = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const result = await apiResult.val.get_component_list(username);
        if (result.ok) {
          setComponents(result.val);
          if (result.val.length > 0) {
            setComponentId(result.val[0].id);
          }
        } else {
          setError(result.val.message);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };
    fetchComponents();
  }, [username]);

  const renderMarkdown = (content: string) => {
    const rawHtml = marked.parse(content) as string;
    return { __html: DOMPurify.sanitize(rawHtml, { RETURN_TRUSTED_TYPE: true }) as unknown as string };
  };

  const handleSubmit = async () => {
    if (!title.trim() || componentId === '') {
      alert("Title and Component are required");
      return;
    }

    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);
    const request: CreateBugRequest = {
      component_id: componentId as number,
      template_name: '', // Default template
      title,
      description,
      type,
      priority,
      severity,
      assignee: assignee || undefined,
      verifier: verifier || undefined,
      collaborators: collaborators.split(',').map(s => s.trim()).filter(s => s !== ''),
      cc: cc.split(',').map(s => s.trim()).filter(s => s !== ''),
    };

    const result = await apiResult.val.create_bug(username, request);
    if (result.ok) {
      navigate(`/issue/${result.val}`);
    } else {
      alert("Failed to create issue: " + result.val.message);
    }
    setIsSubmitting(false);
  };

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  if (loading) return <div className="loading-view" style={{ padding: '20px', color: 'white' }}>Loading components...</div>;
  if (error) return <div className="error-view" style={{ padding: '20px', color: '#ff4d4d' }}>Error: {error}</div>;

  return (
    <div className="create-issue-view" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '20px' }}>
      <div className="main-col" style={{ flex: '1 1 60%', minWidth: '300px' }}>
        <h1 style={{ color: 'white', marginTop: 0, marginBottom: '24px' }}>Create New Issue</h1>
        
        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: '#888', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Title</label>
          <input 
            type="text" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px', backgroundColor: '#1e1e1e', border: '1px solid #333', color: 'white', borderRadius: '4px' }}
            placeholder="What's the issue?"
          />
        </div>

        <div className="form-group" style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: '#888', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>Description (Markdown)</label>
          <textarea 
            value={description} 
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', height: '300px', padding: '12px', backgroundColor: '#1e1e1e', border: '1px solid #333', color: 'white', borderRadius: '4px', resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Describe the issue in detail..."
          />
        </div>

        <div className="preview-section" style={{ marginBottom: '24px' }}>
          <h3 style={{ color: '#888', fontSize: '14px', marginBottom: '12px', fontWeight: 500 }}>Preview</h3>
          <div 
            className="comment-card" 
            style={{ minHeight: '100px', backgroundColor: '#0f0f0f', border: '1px solid #333', borderRadius: '8px', padding: '16px' }}
            dangerouslySetInnerHTML={renderMarkdown(description || '*No description provided*')} 
          />
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            className="primary-btn" 
            onClick={handleSubmit} 
            disabled={isSubmitting}
            style={{ padding: '12px 32px', fontSize: '16px' }}
          >
            {isSubmitting ? 'Creating...' : 'Create Issue'}
          </button>
          <button 
            className="secondary-btn" 
            onClick={() => navigate('/')}
            style={{ padding: '12px 32px', fontSize: '16px', backgroundColor: 'transparent', border: '1px solid #444', color: '#ccc', borderRadius: '4px', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="meta-col" style={{ flex: '0 0 350px', backgroundColor: '#1a1a1a', padding: '20px', borderRadius: '8px', border: '1px solid #333', alignSelf: 'flex-start' }}>
        <h3 style={{ color: 'white', marginTop: 0, marginBottom: '20px', fontSize: '18px' }}>Metadata</h3>
        
        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">Component</label>
          <select 
            value={componentId} 
            onChange={(e) => setComponentId(Number(e.target.value))}
            style={{ width: '100%', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
          >
            {components.map(c => <option key={c.id} value={c.id}>{formatComponentPath(c)}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">Type</label>
          <select 
            value={type} 
            onChange={(e) => setType(e.target.value)}
            style={{ width: '100%', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
          >
            <option>Bug</option>
            <option>Feature</option>
            <option>Task</option>
          </select>
        </div>

        <div className="form-group" style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label className="metadata-label">Priority</label>
            <select 
              value={priority} 
              onChange={(e) => setPriority(e.target.value)}
              style={{ width: '100%', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            >
              <option>P0</option>
              <option>P1</option>
              <option>P2</option>
              <option>P3</option>
              <option>P4</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="metadata-label">Severity</label>
            <select 
              value={severity} 
              onChange={(e) => setSeverity(e.target.value)}
              style={{ width: '100%', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            >
              <option>S0</option>
              <option>S1</option>
              <option>S2</option>
              <option>S3</option>
              <option>S4</option>
            </select>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">Assignee</label>
          <input 
            type="text" 
            value={assignee} 
            onChange={(e) => setAssignee(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            placeholder="Username"
          />
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">Verifier</label>
          <input 
            type="text" 
            value={verifier} 
            onChange={(e) => setVerifier(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            placeholder="Username"
          />
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">Collaborators</label>
          <input 
            type="text" 
            value={collaborators} 
            onChange={(e) => setCollaborators(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            placeholder="user1, user2"
          />
        </div>

        <div className="form-group" style={{ marginBottom: '16px' }}>
          <label className="metadata-label">CC</label>
          <input 
            type="text" 
            value={cc} 
            onChange={(e) => setCc(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px', backgroundColor: '#2d2d2d', border: '1px solid #444', color: 'white', borderRadius: '4px', outline: 'none' }}
            placeholder="user1, user2"
          />
        </div>
      </div>
    </div>
  );
};

export default CreateIssueView;
