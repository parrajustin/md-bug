import React, { useState, useEffect } from 'react';
import { get_api, type Bug } from './api/api';
import BugView from './BugView';
import { type Result } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import './styles.css';

const App: React.FC = () => {
  const [view, setView] = useState<'home' | 'bug'>('home');
  const [selectedBugId, setSelectedBugId] = useState<number | null>(null);
  const [bugResult, setBugResult] = useState<Result<Bug, StatusError> | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (selectedBugId !== null) {
      const apiResult = get_api();
      if (apiResult.ok) {
        setLoading(true);
        apiResult.val.get_bug(selectedBugId).then((result) => {
          setBugResult(result);
          setLoading(false);
        });
      } else {
        setBugResult(apiResult as any);
      }
    }
  }, [selectedBugId]);

  const handleBugClick = (id: number) => {
    setSelectedBugId(id);
    setView('bug');
  };

  const renderContent = () => {
    if (view === 'home') {
      return (
        <div className="placeholder-view">
          <svg className="placeholder-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <h2>No issues selected</h2>
          <p>Select an issue from the sidebar or search to get started.</p>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="loading-view" style={{ padding: '20px', color: 'white' }}>
          Loading...
        </div>
      );
    }

    if (bugResult?.err) {
      return (
        <div className="error-view" style={{ padding: '20px', color: '#ff4d4d' }}>
          <h2>Error Loading Bug</h2>
          <p>{bugResult.val.message}</p>
          <button onClick={() => setView('home')} className="create-btn">Back Home</button>
        </div>
      );
    }

    if (bugResult?.ok) {
      return (
        <BugView 
          bug={bugResult.val} 
          onHome={() => setView('home')} 
          onRefresh={(id) => {
            setSelectedBugId(null); // Force re-fetch
            setTimeout(() => setSelectedBugId(id), 0);
          }} 
        />
      );
    }

    return null;
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
          <div className={`nav-item ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>Home</div>
          <div className="nav-item" onClick={() => handleBugClick(423673307)}>Assigned to me</div>
          <div className="nav-item" onClick={() => handleBugClick(999)}>Non-existent Bug (Error Test)</div>
          <div className="nav-item">Starred by me</div>
          <div className="nav-item">Upvoted by me</div>
          <div className="nav-item">CC'd to me</div>
          <div className="nav-item">Collaborating</div>
          <div className="nav-item">Reported by me</div>
          <div className="nav-item">To be verified</div>
        </aside>

        <main className="content-area">
          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default App;
