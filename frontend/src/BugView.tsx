import React, { useState, useEffect } from 'react';
import { type Bug, type Comment, get_api } from './api/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { WrapToResult } from 'standard-ts-lib/src/wrap_to_result';

// Declare Temporal globally if it's not yet in the TypeScript definitions
declare const Temporal: any;

interface BugViewProps {
  bug: Bug;
  onHome: () => void;
  onRefresh: (id: number) => void;
}

const BugView: React.FC<BugViewProps> = ({ bug: initialBug, onHome, onRefresh }) => {
  const [bug, setBug] = useState<Bug>(initialBug);
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize local state when the bug prop changes (e.g., from a refresh)
  useEffect(() => {
    setBug(initialBug);
  }, [initialBug]);

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
    const result = await apiResult.val.submit_comment(bug.id, 'current_user', commentText);
    
    if (result.ok) {
      const newCommentId = result.val;
      const newComment: Comment = {
        id: newCommentId,
        author: 'current_user',
        epochNanoseconds: BigInt(Date.now()) * 1000000n,
        content: commentText,
      };

      setBug({
        ...bug,
        comments: [...bug.comments, newComment],
      });
      setCommentText('');
    } else {
      alert('Failed to submit comment: ' + result.val.message);
    }
    setIsSubmitting(false);
  };

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
              <strong>{bug.metadata.reporter}</strong> created the issue · {formatTemporalDate(bug.metadata.createdAt)}
            </div>
            <div className="description-content" dangerouslySetInnerHTML={renderMarkdown(bug.metadata.description)} />
          </div>

          {bug.comments.map((comment) => (
            <div key={comment.id} className="comment-card">
              <div className="comment-header">
                <strong>{comment.author}</strong> commented · {formatTemporalDate(comment.epochNanoseconds)} · #{comment.id}
              </div>
              <div dangerouslySetInnerHTML={renderMarkdown(comment.content)} />
            </div>
          ))}

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

          {bug.metadata.userMetadata.length > 0 && (
            <>
              <h3>User Metadata</h3>
              {bug.metadata.userMetadata.map((entry, idx) => (
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
