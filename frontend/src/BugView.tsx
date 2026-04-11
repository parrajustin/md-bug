import React, { useState, useEffect } from 'react';
import { type Bug, type Comment, get_api } from './api/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { WrapToResult } from 'standard-ts-lib/src/wrap_to_result';

// Declare Temporal globally if it's not yet in the TypeScript definitions
declare const Temporal: any;
declare const DEBUG_MODE: boolean;

interface BugViewProps {
  bug: Bug;
  onHome: () => void;
  onRefresh: (id: number, updatedBug?: Bug) => void;
  username: string;
}

const BugView: React.FC<BugViewProps> = ({ bug: initialBug, onHome, onRefresh, username }) => {
  const [bug, setBug] = useState<Bug>(initialBug);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAccessModal, setShowAccessModal] = useState(false);

  // Debugging: Log the bug data to console in debug mode
  useEffect(() => {
    if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
      console.log('BugView data:', bug);
    }
  }, [bug]);

  // Synchronize local state when the bug prop changes (e.g., from a refresh)
  useEffect(() => {
    setBug(initialBug);
  }, [initialBug]);

  // Handle scrolling to comment if hash is present
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#comment')) {
      const targetId = hash.substring(1);
      let retries = 0;
      
      const scrollAttempt = () => {
        const element = document.getElementById(targetId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        } else if (retries < 10) {
          retries++;
          requestAnimationFrame(scrollAttempt);
        }
      };
      
      scrollAttempt();
    }
  }, [bug]);

  const renderMarkdown = (content: string) => {
    const rawHtml = marked.parse(content) as string;
    return { __html: DOMPurify.sanitize(rawHtml, { RETURN_TRUSTED_TYPE: true }) as unknown as string };
  };

  const formatTemporalDate = (nanos: bigint) => {
    const result = WrapToResult(
      () => {
        const instant = Temporal.Instant.fromEpochNanoseconds(nanos);
        // Use Intl.DateTimeFormat for custom formatting
        return new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }).format(instant);
      },
      'Failed to format temporal date'
    );

    if (result.ok) {
      return result.val;
    } else {
      console.error(result.val.toString());
      return nanos.toString();
    }
  };

  const handleCommentSubmit = async () => {
    if (!commentText.trim()) return;

    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);
    const result = await apiResult.val.submit_comment(username, bug.id, username, commentText);
    
    if (result.ok) {
      const response = result.val;
      
      if (response.state_id === bug.state_id + 1n) {
        // State is exactly +1, we can just append our comment locally
        const newComment: Comment = {
          version: 1,
          id: response.comment_id,
          author: username,
          epoch_nanoseconds: BigInt(Date.now()) * 1000000n,
          content: commentText,
        };

        const updatedBug = {
          ...bug,
          comments: [...bug.comments, newComment],
          state_id: response.state_id,
        };
        setBug(updatedBug);
        onRefresh(bug.id, updatedBug); // Update the "cache" in App
      } else {
        // Significant change happened elsewhere, fetch full bug
        const fullBugResult = await apiResult.val.get_bug(username, bug.id);
        if (fullBugResult.ok) {
          setBug(fullBugResult.val);
          onRefresh(bug.id, fullBugResult.val); // Update the "cache" in App
        }
      }
      setCommentText('');
    } else {
      alert('Failed to submit comment: ' + result.val.message);
    }
    setIsSubmitting(false);
  };

  const hasCommentAccess = 
    bug.metadata.reporter === username ||
    bug.metadata.access.full_access.includes(username) || 
    bug.metadata.access.full_access.includes('PUBLIC') || 
    bug.metadata.access.comment_access.includes(username) || 
    bug.metadata.access.comment_access.includes('PUBLIC');

  return (
    <div className="bug-view">
      <div className="bug-header">
        <div className="breadcrumbs">
          {bug.folders.join(' > ')}
          <span className="bug-id">{bug.id}</span>
        </div>
        <div className="bug-title-row">
          <button onClick={onHome} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>←</button>
          <button onClick={() => onRefresh(bug.id)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>↻</button>
          <span>{bug.title}</span>
        </div>
      </div>

      <div className="bug-content-wrapper">
        <div className="bug-comments">
          <div className="comment-card description-card">
            <div className="comment-header">
              <strong>{bug.metadata.reporter}</strong> created the issue · {formatTemporalDate(bug.metadata.created_at)}
            </div>
            <div className="description-content" dangerouslySetInnerHTML={renderMarkdown(bug.metadata.description)} />
          </div>

          {bug.comments.map((comment) => (
            <div key={comment.id} id={`comment${comment.id}`} className="comment-card">
              <div className="comment-header">
                <strong>{comment.author}</strong> commented · {formatTemporalDate(comment.epoch_nanoseconds)} · <a href={`#comment${comment.id}`} style={{ color: '#3b82f6', textDecoration: 'none' }}>#{comment.id}</a>
              </div>
              <div dangerouslySetInnerHTML={renderMarkdown(comment.content)} />
            </div>
          ))}

          {hasCommentAccess && (
            <div className="comment-input-section" style={{ marginTop: '20px' }}>
              <textarea
                style={{
                  width: 'calc(100% - 20px)',
                  height: '150px',
                  backgroundColor: '#1e1e1e',
                  color: 'white',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '10px',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
                placeholder="Add a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <div style={{ marginTop: '10px' }}>
                <button
                  className="primary-btn"
                  onClick={handleCommentSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'submitting...' : 'comment'}
                </button>
              </div>
              <div 
                className="comment-preview" 
                style={{ 
                  marginTop: '20px', 
                  border: '1px solid #666', 
                  borderRadius: '4px', 
                  padding: '10px', 
                  minHeight: '50px',
                  color: '#ccc'
                }}
              >
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>Preview</div>
                <div dangerouslySetInnerHTML={renderMarkdown(commentText || '*No preview*')} />
              </div>
            </div>
          )}
        </div>

        <div className="bug-metadata">
          <h3>Metadata</h3>
          <div className="metadata-item">
            <div className="metadata-label">Reporter</div>
            <div className="metadata-value">{bug.metadata.reporter}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Type</div>
            <div className="metadata-value">{bug.metadata.type}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Priority</div>
            <div className="metadata-value">{bug.metadata.priority}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Severity</div>
            <div className="metadata-value">{bug.metadata.severity}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Status</div>
            <div className="metadata-value" style={{ backgroundColor: '#1e3a8a', padding: '2px 6px', borderRadius: '4px', display: 'inline-block' }}>{bug.metadata.status}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Assignee</div>
            <div className="metadata-value">{bug.metadata.assignee}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Verifier</div>
            <div className="metadata-value">{bug.metadata.verifier || 'None'}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Collaborators</div>
            <div className="metadata-value">{bug.metadata.collaborators.join(', ') || 'None'}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">CC</div>
            <div className="metadata-value">{bug.metadata.cc.join(', ') || 'None'}</div>
          </div>
          <div className="metadata-item">
            <div className="metadata-label">Access</div>
            <div className="metadata-value">
              <span 
                style={{ color: '#3b82f6', cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => setShowAccessModal(true)}
              >
                View
              </span>
            </div>
          </div>

          {showAccessModal && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 1000
            }}>
              <div style={{
                backgroundColor: '#1e1e1e',
                padding: '20px',
                borderRadius: '8px',
                width: '500px',
                maxHeight: '80vh',
                overflowY: 'auto',
                border: '1px solid #333',
                color: 'white'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                  <h2 style={{ margin: 0 }}>Access Control</h2>
                  <button 
                    onClick={() => setShowAccessModal(false)}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '20px' }}
                  >
                    ×
                  </button>
                </div>
                
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Users who can edit, comment, and view</div>
                  <div style={{ backgroundColor: '#2d2d2d', padding: '10px', borderRadius: '4px', minHeight: '30px', border: '1px solid #444' }}>
                    {bug.metadata.access.full_access.join(', ') || 'None'}
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Users who can comment, and view</div>
                  <div style={{ backgroundColor: '#2d2d2d', padding: '10px', borderRadius: '4px', minHeight: '30px', border: '1px solid #444' }}>
                    {bug.metadata.access.comment_access.join(', ') || 'None'}
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Users who can view</div>
                  <div style={{ backgroundColor: '#2d2d2d', padding: '10px', borderRadius: '4px', minHeight: '30px', border: '1px solid #444' }}>
                    {bug.metadata.access.view_access.join(', ') || 'None'}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button 
                    className="primary-btn" 
                    onClick={() => setShowAccessModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {bug.metadata.user_metadata.length > 0 && (
            <>
              <h3>User Metadata</h3>
              {bug.metadata.user_metadata.map((entry, idx) => (
                <div className="metadata-item" key={idx}>
                  <div className="metadata-label">{entry.key}</div>
                  <div className="metadata-value">{entry.value}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BugView;
