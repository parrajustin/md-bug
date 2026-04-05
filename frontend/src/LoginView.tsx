import React, { useState } from 'react';
import { storage } from './api/storage';

interface LoginViewProps {
  onLogin: (username: string) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    const result = await storage.setUsername(username.trim());
    if (result.ok) {
      onLogin(username.trim());
    } else {
      setError('Failed to save username: ' + result.val.message);
    }
  };

  return (
    <div className="login-view" style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      height: '100vh',
      backgroundColor: '#000',
      color: 'white'
    }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '40px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '30px' }}>IssueTracker</h1>
        <p style={{ textAlign: 'center', color: '#888', marginBottom: '30px' }}>
          Please enter a username to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', color: '#ccc' }}>Username</label>
            <input 
              type="text" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#1e1e1e',
                border: '1px solid #333',
                borderRadius: '4px',
                color: 'white',
                fontSize: '16px'
              }}
              placeholder="e.g. john_doe"
              autoFocus
            />
          </div>
          {error && <div style={{ color: '#ff4d4d', marginBottom: '20px', fontSize: '14px' }}>{error}</div>}
          <button 
            type="submit" 
            className="primary-btn" 
            style={{ width: '100%', padding: '12px', fontSize: '16px' }}
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginView;
