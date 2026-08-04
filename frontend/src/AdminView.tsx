import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { authApi, getActiveSession, type AdminUser } from './api/auth_api';

interface AdminViewProps {
  username: string;
}

/// Admin-only console for managing accounts.
///
/// `App` only routes here for an admin, but that is a convenience rather than the
/// control: every endpoint behind this page checks `is_admin` server-side, so reaching
/// the route another way achieves nothing.
const AdminView: React.FC<AdminViewProps> = ({ username }) => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);
  /// The generated password, shown once so it can be handed over.
  const [created, setCreated] = useState<{ username: string; password: string } | null>(
    null
  );

  const loadUsers = useCallback(async () => {
    const session = getActiveSession();
    if (!session) return;
    const result = await authApi.listUsers(session.accessToken);
    if (result.ok) {
      setUsers(result.val);
    } else {
      setError(result.val.message);
    }
  }, []);

  useEffect(() => {
    loadUsers().finally(() => setLoading(false));
  }, [loadUsers]);

  const handleCreate = async () => {
    const session = getActiveSession();
    if (!session || !newUsername.trim()) return;

    setCreating(true);
    setError(null);
    const result = await authApi.createUser(
      session.accessToken,
      newUsername.trim(),
      newIsAdmin
    );
    setCreating(false);

    if (result.err) {
      setError(result.val.message);
      return;
    }
    setCreated(result.safeUnwrap());
    setNewUsername('');
    setNewIsAdmin(false);
    await loadUsers();
  };

  const handleToggleDisabled = async (target: string, disabled: boolean) => {
    const session = getActiveSession();
    if (!session) return;

    setError(null);
    const result = await authApi.setUserDisabled(session.accessToken, target, disabled);
    if (result.err) {
      setError(result.val.message);
      return;
    }
    await loadUsers();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }} data-testid="admin-view">
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 500 }}>
        Administration
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} data-testid="admin-error">
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        <Card variant="outlined">
          <CardHeader
            title="Create a user"
            slotProps={{ title: { variant: 'h6', sx: { fontWeight: 'bold' } } }}
          />
          <Divider />
          <CardContent>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
              The password is generated and shown once. Hand it over; the account cannot
              do anything until the holder replaces it.
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <TextField
                size="small"
                label="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                slotProps={{ htmlInput: { 'data-testid': 'new-username' } }}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={newIsAdmin}
                    onChange={(e) => setNewIsAdmin(e.target.checked)}
                    data-testid="new-is-admin"
                  />
                }
                label="Administrator"
              />
              <Button
                variant="contained"
                onClick={handleCreate}
                disabled={creating || !newUsername.trim()}
                data-testid="create-user"
              >
                {creating ? 'Creating…' : 'Create user'}
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader
            title="Accounts"
            slotProps={{ title: { variant: 'h6', sx: { fontWeight: 'bold' } } }}
          />
          <Divider />
          <CardContent>
            <Table size="small" data-testid="user-table">
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Access</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.uid} data-testid={`user-row-${u.username}`}>
                    <TableCell>
                      {u.username}
                      {u.is_admin && (
                        <Chip label="Admin" size="small" color="primary" sx={{ ml: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>
                      {u.disabled ? (
                        <Chip label="Disabled" size="small" color="error" />
                      ) : u.must_change_password ? (
                        <Chip label="Must set password" size="small" color="warning" />
                      ) : (
                        <Chip label="Active" size="small" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {/* Disabling yourself would leave nobody able to undo it, so the
                          server rejects it and the button is not offered. */}
                      {u.username === username ? (
                        <Typography variant="caption" color="text.secondary">
                          That&apos;s you
                        </Typography>
                      ) : (
                        <Button
                          size="small"
                          color={u.disabled ? 'primary' : 'error'}
                          onClick={() => handleToggleDisabled(u.username, !u.disabled)}
                          data-testid={`toggle-disabled-${u.username}`}
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={created !== null} onClose={() => setCreated(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Give this password to {created?.username}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This is the only time it will be shown. If it is lost, the account needs a new
            one.
          </Alert>
          <TextField
            fullWidth
            multiline
            value={created?.password ?? ''}
            slotProps={{
              htmlInput: { readOnly: true, 'data-testid': 'generated-password' },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreated(null)} data-testid="dismiss-password">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminView;
