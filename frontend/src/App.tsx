import React, { useState, useEffect } from 'react';
import { fakeApi, Bug } from './api/fakeApi';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './styles.css';

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'bug'>('home');
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [bug, setBug] = useState<Bug | null>(null);

  useEffect(() => {
    if (selectedBugId) {
      fakeApi.get_bug(selectedBugId).then(setBug);
    }
  }, [selectedBugId]);

  const handleBugClick = (id: string) => {
    setSelectedBugId(id);
    setView('bug');
  };

  const renderMarkdown = (content: string) => {
    const rawHtml = marked(content);
    return { __html: DOMPurify.sanitize(rawHtml as string) };
  };

  return (
    <div className="layout">
      <header className="top-bar">
        <div className="logo-container">
          <div className="hamburger">☰</div>
          <div style={{ fontWeight: 'bold', fontSize: '18px' }}>IssueTracker</div>
        </div>
        <div className="search-container">
          <input type="text" placeholder="Search bugs..." />
        </div>
        <div style={{ width: '240px', textAlign: 'right', paddingRight: '20px' }}>👤</div>
      </header>

      <div className="main-container">
        <aside className="side-panel">
          <button className="create-btn">
            <span style={{ fontSize: '24px' }}>+</span> Create Issue
          </button>
          <div className="nav-item active">Home</div>
          <div className="nav-item" onClick={() => handleBugClick("423673307")}>Assigned to me</div>
          <div className="nav-item">Starred by me</div>
          <div className="nav-item">Upvoted by me</div>
          <div className="nav-item">CC'd to me</div>
          <div className="nav-item">Collaborating</div>
          <div className="nav-item">Reported by me</div>
          <div className="nav-item">To be verified</div>
        </aside>

        <main className="content-area">
          {view === 'home' ? (
            <div className="placeholder-view">
              <svg className="placeholder-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <h2>No issues selected</h2>
              <p>Select an issue from the sidebar or search to get started.</p>
            </div>
          ) : bug ? (
            <div className="bug-view">
              <div className="bug-header">
                <div className="breadcrumbs">
                  {bug.folders.join(' > ')}
                  <span className="bug-id">{bug.id}</span>
                </div>
                <div className="bug-title-row">
                  <button onClick={() => setView('home')} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>←</button>
                  <button onClick={() => setSelectedBugId(bug.id)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>↻</button>
                  <span>{bug.title}</span>
                </div>
              </div>

              <div className="bug-content-wrapper">
                <div className="bug-comments">
                  {bug.comments.map((comment, index) => (
                    <div key={index} className="comment-card">
                      <div className="comment-header">
                        <strong>{comment.author}</strong> created issue · {comment.date}
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
                </div>
              </div>
            </div>
          ) : (
            <div>Loading...</div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
