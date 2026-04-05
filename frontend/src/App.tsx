import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { get_api, type Bug } from './api/api';
import BugView from './BugView';
import HomeView from './HomeView';
import { type Result } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import './styles.css';

interface BugLoaderProps {
  currentResult: Result<Bug, StatusError> | null;
  setResult: (result: Result<Bug, StatusError> | null) => void;
}

const BugLoader: React.FC<BugLoaderProps> = ({ currentResult, setResult }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (id) {
      const bugId = parseInt(id);
      const apiResult = get_api();
      if (!apiResult.ok) {
        setResult(apiResult as any);
        return;
      }

      const api = apiResult.val;
      const cachedBug = currentResult?.ok ? currentResult.val : null;

      if (cachedBug && cachedBug.id === bugId) {
        // Optimization: Check state first for the "already cached" bug
        api.get_bug_state(bugId).then((stateResult) => {
          if (stateResult.ok && stateResult.val === cachedBug.state_id) {
            // State matches, no need to re-fetch
          } else {
            // State mismatch or error, fetch full bug
            fetchFullBug(api, bugId);
          }
        });
      } else {
        // Not in state or different bug, fetch full bug
        fetchFullBug(api, bugId);
      }
    }
  }, [id]);

  const fetchFullBug = (api: any, bugId: number) => {
    setLoading(true);
    api.get_bug(bugId).then((result: Result<Bug, StatusError>) => {
      setResult(result);
      setLoading(false);
    });
  };

  if (loading) {
    return (
      <div className="loading-view" style={{ padding: '20px', color: 'white' }}>
        Loading...
      </div>
    );
  }

  if (currentResult?.err) {
    return (
      <div className="error-view" style={{ padding: '20px', color: '#ff4d4d' }}>
        <h2>Error Loading Bug</h2>
        <p>{currentResult.val.message}</p>
        <button onClick={() => navigate('/')} className="create-btn">Back Home</button>
      </div>
    );
  }

  if (currentResult?.ok) {
    return (
      <BugView 
        bug={currentResult.val} 
        onHome={() => navigate('/')} 
        onRefresh={(id, updatedBug) => {
          if (updatedBug) {
            setResult({ ok: true, val: updatedBug } as Result<Bug, StatusError>);
          } else {
            const apiResult = get_api();
            if (apiResult.ok) {
              fetchFullBug(apiResult.val, id);
            }
          }
        }} 
      />
    );
  }

  return null;
};

const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [bugResult, setBugResult] = useState<Result<Bug, StatusError> | null>(null);

  const handleBugClick = (id: number) => {
    navigate(`/issue/${id}`);
  };

  return (
    <div className="layout">
      <header className="top-bar">
        <div className="logo-container">
          <div className="hamburger">☰</div>
          <div style={{ fontWeight: 'bold', fontSize: '18px', cursor: 'pointer' }} onClick={() => navigate('/')}>IssueTracker</div>
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
          <div 
            className={`nav-item ${location.pathname === '/' || location.pathname === '/home' ? 'active' : ''}`} 
            onClick={() => navigate('/')}
          >
            Home
          </div>
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
          <Routes>
            <Route path="/" element={<HomeView onBugSelect={handleBugClick} />} />
            <Route path="/home" element={<HomeView onBugSelect={handleBugClick} />} />
            <Route path="/issue/:id" element={<BugLoader currentResult={bugResult} setResult={setBugResult} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default App;
