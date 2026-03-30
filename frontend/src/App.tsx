import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { get_api, type Bug } from './api/api';
import BugView from './BugView';
import HomeView from './HomeView';
import { type Result } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import './styles.css';

const BugLoader: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [bugResult, setBugResult] = useState<Result<Bug, StatusError> | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (id) {
      const bugId = parseInt(id);
      const apiResult = get_api();
      if (apiResult.ok) {
        setLoading(true);
        apiResult.val.get_bug(bugId).then((result) => {
          setBugResult(result);
          setLoading(false);
        });
      } else {
        setBugResult(apiResult as any);
      }
    }
  }, [id]);

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
        <button onClick={() => navigate('/')} className="create-btn">Back Home</button>
      </div>
    );
  }

  if (bugResult?.ok) {
    return (
      <BugView 
        bug={bugResult.val} 
        onHome={() => navigate('/')} 
        onRefresh={(id) => {
          const apiResult = get_api();
          if (apiResult.ok) {
            setLoading(true);
            apiResult.val.get_bug(id).then((result) => {
              setBugResult(result);
              setLoading(false);
            });
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
            <Route path="/issue/:id" element={<BugLoader />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default App;
