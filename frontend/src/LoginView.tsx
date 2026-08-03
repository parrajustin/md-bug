import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { authApi, persistSession } from './api/auth_api';
import type { StoredSession } from './api/storage';

interface LoginViewProps {
  /// Called on a successful login. `mustChangePassword` is true for accounts whose
  /// password was set by someone else (the bootstrap admin, or any admin-created user),
  /// in which case the app must route to the change-password screen — every other
  /// endpoint 403s until the password is rotated.
  onLogin: (session: StoredSession, mustChangePassword: boolean) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    if (!password) {
      setError('Please enter a password');
      return;
    }

    setSubmitting(true);
    const result = await authApi.login(username.trim(), password);
    setSubmitting(false);

    if (result.err) {
      setError(result.val.message);
      return;
    }

    const { session, mustChangePassword } = result.safeUnwrap();
    // Persist before handing control back so a reload keeps the session.
    await persistSession(session);
    onLogin(session, mustChangePassword);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Paper
        variant="outlined"
        sx={{ maxWidth: 420, width: '100%', p: 4 }}
        data-testid="login-card"
      >
        <Typography variant="h4" align="center" sx={{ mb: 1, fontWeight: 500 }}>
          IssueTracker
        </Typography>
        <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
          Sign in to continue.
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin"
              autoFocus
              autoComplete="username"
              slotProps={{ htmlInput: { 'data-testid': 'login-username' } }}
            />
            <TextField
              fullWidth
              type="password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              slotProps={{ htmlInput: { 'data-testid': 'login-password' } }}
            />

            {error && (
              <Alert severity="error" data-testid="login-error">
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              data-testid="login-submit"
              sx={{ py: 1.25 }}
            >
              {submitting ? <CircularProgress size={24} /> : 'Sign in'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
};

export default LoginView;
