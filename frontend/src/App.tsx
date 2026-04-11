import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, useParams, useLocation } from 'react-router-dom';
import { get_api, type Bug } from './api/api';
import BugView from './BugView';
import HomeView from './HomeView';
import CreateIssueView from './CreateIssueView';
import { type Result } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import { storage } from './api/storage';
import LoginView from './LoginView';
import './styles.css';

interface BugLoaderProps {
  currentResult: Result<Bug, StatusError> | null;
  setResult: (result: Result<Bug, StatusError> | null) => void;
  username: string;
}

const BugLoader: React.FC<BugLoaderProps> = ({ currentResult, setResult, username }) => {
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
        api.get_bug_state(username, bugId).then((stateResult: any) => {
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
    api.get_bug(username, bugId).then((result: Result<Bug, StatusError>) => {
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
        username={username}
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
  const [username, setUsername] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(true);
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  useEffect(() => {
    storage.getUsername().then(result => {
      if (result.ok && result.val.some) {
        setUsername(result.val.safeValue());
      }
      setCheckingUsername(false);
    });
  }, []);

  const handleBugClick = (id: number) => {
    navigate(`/issue/${id}`);
  };

  const handleLogin = (name: string) => {
    setUsername(name);
    navigate('/');
  };

  const handleSignOut = async () => {
    await storage.clearUsername();
    setUsername(null);
    setShowUserDropdown(false);
    navigate('/');
  };

  if (checkingUsername) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#000', color: 'white' }}>
        Loading...
      </div>
    );
  }

  if (!username) {
    return <LoginView onLogin={handleLogin} />;
  }

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
        <div 
          className="user-profile-container"
          style={{ width: '240px', textAlign: 'right', paddingRight: '20px', color: '#888', fontSize: '14px', position: 'relative', cursor: 'pointer' }}
          onClick={() => setShowUserDropdown(!showUserDropdown)}
        >
          {username} 👤
          {showUserDropdown && (
            <div 
              className="user-dropdown"
              style={{
                position: 'absolute',
                top: '100%',
                right: '20px',
                backgroundColor: '#1e1e1e',
                border: '1px solid #333',
                borderRadius: '4px',
                padding: '10px',
                zIndex: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                minWidth: '120px',
                textAlign: 'left'
              }}
            >
              <div 
                className="dropdown-item" 
                style={{ color: 'white', padding: '8px', cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSignOut();
                }}
              >
                Sign out
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="main-container">
        <aside className="side-panel">
          <button className="create-btn" onClick={() => navigate('/create_issue')}>
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
            <Route path="/" element={<HomeView onBugSelect={handleBugClick} username={username} />} />
            <Route path="/home" element={<HomeView onBugSelect={handleBugClick} username={username} />} />
            <Route path="/issue/:id" element={<BugLoader currentResult={bugResult} setResult={setBugResult} username={username} />} />
            <Route path="/create_issue" element={<CreateIssueView username={username} />} />
            <Route path="/login" element={<LoginView onLogin={handleLogin} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
};

export default App;
