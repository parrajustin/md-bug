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
import CreateComponentView from './CreateComponentView';
import ComponentEditorView from './ComponentEditorView';
import { type Result } from 'standard-ts-lib/src/result';
import { StatusError } from 'standard-ts-lib/src/status_error';
import { type StoredSession } from './api/storage';
import { restoreSession, clearSession, getActiveSession, authApi } from './api/auth_api';
import LoginView from './LoginView';
import ChangePasswordView from './ChangePasswordView';
import AccountView from './AccountView';
import './styles.css';

interface BugLoaderProps {
  currentResult: Result<Bug, StatusError> | null;
  setResult: (result: Result<Bug, StatusError> | null) => void;
  username: string;
  onSearch: (query: string) => void;
  onBugIdChange: (id: number | null) => void;
}

const BugLoader: React.FC<BugLoaderProps> = ({ currentResult, setResult, username, onSearch, onBugIdChange }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (id) {
      const bugId = parseInt(id);
      onBugIdChange(bugId);
      const apiResult = get_api();
      if (!apiResult.ok) {
        setResult(apiResult as any);
        return;
      }

      const api = apiResult.val;
      const cachedBug = currentResult?.ok ? currentResult.val : null;

      if (cachedBug && cachedBug.id === bugId) {
        // Optimization: Check state first for the "already cached" bug
        api.get_bug_state(bugId).then((stateResult: any) => {
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
    } else {
      onBugIdChange(null);
    }
  }, [id, username, currentResult, setResult]);

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
  const [session, setSession] = useState<StoredSession | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(true);
  const [activeBugId, setActiveBugId] = useState<number | null>(null);
  
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');

  useEffect(() => {
    // Rehydrate a stored session so a reload does not force a fresh login.
    restoreSession().then((result) => {
      if (result.ok && result.val) {
        setSession(result.val);
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

  const handleLogin = (newSession: StoredSession, forcedChange: boolean) => {
    setSession(newSession);
    setMustChangePassword(forcedChange);
    navigate('/');
  };

  /// After a password change every token for the account is revoked server-side, so the
  /// only correct next step is a fresh sign-in.
  const handlePasswordChanged = () => {
    setSession(null);
    setMustChangePassword(false);
    navigate('/');
  };

  const handleSignOut = async () => {
    const active = getActiveSession();
    if (active) await authApi.logout(active.accessToken);
    await clearSession();
    setSession(null);
    setMustChangePassword(false);
    navigate('/');
  };

  const handleSearch = (query: string) => {
    if (query) {
      setSearchParams({ q: query });
    } else {
      setSearchParams({});
    }
    navigate(`/?${query ? 'q=' + encodeURIComponent(query) : ''}`);
  };

  const componentIdFromBug = bugResult?.ok && activeBugId === bugResult.val.id ? bugResult.val.metadata.component_id : null;

  if (checkingUsername) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#000', color: 'white' }}>
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoginView onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

  // The backend rejects every non-auth endpoint while this flag is set, so there is no
  // point rendering the app behind it.
  if (mustChangePassword) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ChangePasswordView
          username={session.username}
          forced
          onChanged={handlePasswordChanged}
        />
      </ThemeProvider>
    );
  }

  const username = session.username;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Layout 
        username={username} 
        onSignOut={handleSignOut}
        searchValue={searchQuery}
        onSearch={handleSearch}
        bugComponentId={componentIdFromBug}
      >
        <Routes>
          <Route path="/" element={<HomeView onBugSelect={handleBugClick} username={username} search={searchQuery} onSearch={handleSearch} />} />
          <Route path="/home" element={<HomeView onBugSelect={handleBugClick} username={username} search={searchQuery} onSearch={handleSearch} />} />
          <Route path="/issue/:id" element={<BugLoader currentResult={bugResult} setResult={setBugResult} username={username} onSearch={handleSearch} onBugIdChange={setActiveBugId} />} />
          <Route path="/create_issue" element={<CreateIssueView username={username} />} />
          <Route path="/create_component" element={<CreateComponentView username={username} isAdmin={session.isAdmin} />} />
          <Route path="/component/:id" element={<ComponentEditorView username={username} />} />
          <Route path="/account" element={<AccountView username={username} isAdmin={session.isAdmin} />} />
          <Route path="/login" element={<LoginView onLogin={handleLogin} />} />
        </Routes>
      </Layout>
    </ThemeProvider>
  );
};

export default App;
