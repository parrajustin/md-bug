import React, { useState, useEffect } from 'react';
import { useNavigate, Routes, Route, useParams, useSearchParams } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './theme';
import Layout from './Layout';
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
  onSearch: (query: string) => void;
}

const BugLoader: React.FC<BugLoaderProps> = ({ currentResult, setResult, username, onSearch }) => {
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
          if (stateResult.ok && stateResult.val.state_id === cachedBug.state_id) {
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
  }, [id, username, currentResult, setResult]);

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
        <button onClick={() => navigate('/')} className="primary-btn">Back Home</button>
      </div>
    );
  }

  if (currentResult?.ok) {
    return (
      <BugView 
        bug={currentResult.val} 
        onHome={() => navigate('/')} 
        username={username}
        onSearch={onSearch}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [bugResult, setBugResult] = useState<Result<Bug, StatusError> | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  useEffect(() => {
    storage.getUsername().then(result => {
      if (result.ok && result.val.some) {
        setUsername(result.val.safeValue());
      }
      setCheckingUsername(false);
    });
  }, []);

  // Sync state FROM URL (handles browser back/forward)
  useEffect(() => {
    const q = searchParams.get('q') || '';
    if (q !== searchQuery) {
      setSearchQuery(q);
    }
  }, [searchParams]);

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
    navigate('/');
  };

  const handleSearch = (query: string) => {
    // Navigate immediately to home with the query string.
    // This updates the URL, which triggers the useEffect to update searchQuery state.
    if (query) {
      setSearchParams({ q: query });
    } else {
      setSearchParams({});
    }
    navigate(`/?${query ? 'q=' + encodeURIComponent(query) : ''}`);
  };

  if (checkingUsername) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#000', color: 'white' }}>
        Loading...
      </div>
    );
  }

  if (!username) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoginView onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Layout 
        username={username} 
        onSignOut={handleSignOut}
        searchValue={searchQuery}
        onSearch={handleSearch}
      >
        <Routes>
          <Route path="/" element={<HomeView onBugSelect={handleBugClick} username={username} search={searchQuery} onSearch={handleSearch} />} />
          <Route path="/home" element={<HomeView onBugSelect={handleBugClick} username={username} search={searchQuery} onSearch={handleSearch} />} />
          <Route path="/issue/:id" element={<BugLoader currentResult={bugResult} setResult={setBugResult} username={username} onSearch={handleSearch} />} />
          <Route path="/create_issue" element={<CreateIssueView username={username} />} />
          <Route path="/login" element={<LoginView onLogin={handleLogin} />} />
        </Routes>
      </Layout>
    </ThemeProvider>
  );
};

export default App;
