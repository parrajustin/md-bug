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
import { authApi, clearSession } from './api/auth_api';

const MIN_PASSWORD_LEN = 8;

interface ChangePasswordViewProps {
  username: string;
  /// True when the server is forcing this (a machine-generated or admin-set password).
  /// The screen then has no escape except completing it — matching the backend, which
  /// 403s every other endpoint while the flag is set.
  forced: boolean;
  onChanged: () => void;
  onCancel?: () => void;
}

const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({
  username,
  forced,
  onChanged,
  onCancel,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check locally first so the obvious mistakes do not cost a round trip; the server
    // enforces the same rules regardless.
    if (newPassword.length < MIN_PASSWORD_LEN) {
      setError(`New password must be at least ${MIN_PASSWORD_LEN} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match');
      return;
    }
    if (newPassword === currentPassword) {
      setError('The new password must be different from the current one');
      return;
    }

    setSubmitting(true);
    const result = await authApi.changePassword(username, currentPassword, newPassword);
    setSubmitting(false);

    if (result.err) {
      setError(result.val.message);
      return;
    }

    // Changing the password revokes every token for the account, so whatever session we
    // are holding is already dead. Drop it and make the user sign in again.
    await clearSession();
    onChanged();
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
        sx={{ maxWidth: 460, width: '100%', p: 4 }}
        data-testid="change-password-card"
      >
        <Typography variant="h5" align="center" sx={{ mb: 1, fontWeight: 500 }}>
          Choose a new password
        </Typography>

        {forced ? (
          <Alert severity="warning" sx={{ mb: 3 }} data-testid="forced-notice">
            <strong>{username}</strong> is using a password that was generated for it.
            You must choose your own before you can use the tracker.
          </Alert>
        ) : (
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            Signed in as {username}.
          </Typography>
        )}

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              fullWidth
              type="password"
              label="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              slotProps={{ htmlInput: { 'data-testid': 'current-password' } }}
            />
            <TextField
              fullWidth
              type="password"
              label="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              helperText={`At least ${MIN_PASSWORD_LEN} characters.`}
              slotProps={{ htmlInput: { 'data-testid': 'new-password' } }}
            />
            <TextField
              fullWidth
              type="password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              slotProps={{ htmlInput: { 'data-testid': 'confirm-password' } }}
            />

            {error && (
              <Alert severity="error" data-testid="change-password-error">
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              data-testid="change-password-submit"
              sx={{ py: 1.25 }}
            >
              {submitting ? <CircularProgress size={24} /> : 'Update password'}
            </Button>

            {/* No escape hatch when forced — the account cannot do anything else. */}
            {!forced && onCancel && (
              <Button variant="text" onClick={onCancel} data-testid="change-password-cancel">
                Cancel
              </Button>
            )}
          </Stack>
        </form>
      </Paper>
    </Box>
  );
};

export default ChangePasswordView;
