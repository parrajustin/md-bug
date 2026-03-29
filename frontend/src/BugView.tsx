import React from 'react';
import { type Bug } from './api/api';
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

const BugView: React.FC<BugViewProps> = ({ bug, onHome, onRefresh }) => {
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
