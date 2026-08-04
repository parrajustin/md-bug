import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { get_api, type BugSummary, type ComponentSummary } from './api/api';
import { authApi, getActiveSession, type PersonalToken } from './api/auth_api';

interface AccountViewProps {
  username: string;
  isAdmin: boolean;
}

const AccountView: React.FC<AccountViewProps> = ({ username, isAdmin }) => {
  const navigate = useNavigate();

  const [ownedComponents, setOwnedComponents] = useState<ComponentSummary[]>([]);
  const [myBugs, setMyBugs] = useState<BugSummary[]>([]);
  const [tokens, setTokens] = useState<PersonalToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  /// The plaintext token, shown once. The server never reveals it again.
  const [revealed, setRevealed] = useState<{ identity: string; token: string } | null>(
    null
  );

  const loadTokens = useCallback(async () => {
    const session = getActiveSession();
    if (!session) return;
    const result = await authApi.listPersonalTokens(session.accessToken);
    if (result.ok) setTokens(result.val);
  }, []);

  useEffect(() => {
    const load = async () => {
      const apiResult = get_api();
      if (!apiResult.ok) {
        setError('API not available');
        setLoading(false);
        return;
      }
      const api = apiResult.val;

      const components = await api.get_component_list();
      if (components.ok) {
        setOwnedComponents(components.val.filter((c) => c.creator === username));
      } else {
        setError(components.val.message);
      }

      // `involves:` matches reporter, assignee, verifier, collaborators or cc in one
      // query — distinct search keywords are ANDed, so this cannot be expressed by
      // combining `reporter:` and `assignee:`.
      const bugs = await api.get_bug_list(`involves:${username}`);
      if (bugs.ok) setMyBugs(bugs.val);

      await loadTokens();
      setLoading(false);
    };
    load();
  }, [username, loadTokens]);

  const handleCreateToken = async () => {
    const session = getActiveSession();
    if (!session) return;

    setCreating(true);
    setError(null);
    const result = await authApi.createPersonalToken(session.accessToken);
    setCreating(false);

    if (result.err) {
      setError(result.val.message);
      return;
    }
    setRevealed(result.safeUnwrap());
    await loadTokens();
  };

  const handleRevoke = async (id: number) => {
    const session = getActiveSession();
    if (!session) return;
    const result = await authApi.revokePersonalToken(session.accessToken, id);
    if (result.err) {
      setError(result.val.message);
      return;
    }
    await loadTokens();
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }} data-testid="account-view">
      <Stack direction="row" spacing={2} sx={{ mb: 4, alignItems: 'center' }}>
        <Typography variant="h4" sx={{ fontWeight: 500 }}>
          {username}
        </Typography>
        {isAdmin && <Chip label="Administrator" color="primary" size="small" />}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} data-testid="account-error">
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        <Card variant="outlined">
          <CardHeader
            title="Components you own"
            slotProps={{ title: { variant: 'h6', sx: { fontWeight: 'bold' } } }}
          />
          <Divider />
          <CardContent>
            {ownedComponents.length === 0 ? (
              <Typography color="text.secondary" data-testid="no-components">
                You have not created any components.
              </Typography>
            ) : (
              <List dense disablePadding data-testid="owned-components">
                {ownedComponents.map((c) => (
                  <ListItem key={c.id} disablePadding>
                    <ListItemButton onClick={() => navigate(`/component/${c.id}`)}>
                      <ListItemText
                        primary={c.name}
                        secondary={
                          c.folders.length > 0 ? c.folders.join(' > ') : 'Top level'
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader
            title="Bugs you are on"
            slotProps={{ title: { variant: 'h6', sx: { fontWeight: 'bold' } } }}
          />
          <Divider />
          <CardContent>
            {myBugs.length === 0 ? (
              <Typography color="text.secondary" data-testid="no-bugs">
                You are not on any bugs.
              </Typography>
            ) : (
              <List dense disablePadding data-testid="my-bugs">
                {myBugs.map((b) => (
                  <ListItem key={b.id} disablePadding>
                    <ListItemButton onClick={() => navigate(`/issue/${b.id}`)}>
                      <ListItemText primary={b.title} secondary={`#${b.id} · ${b.status}`} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader
            title="Bot access tokens"
            slotProps={{ title: { variant: 'h6', sx: { fontWeight: 'bold' } } }}
          />
          <Divider />
          <CardContent>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
              Each token is its own identity, named automatically. Add that name to a
              component group or a bug&apos;s access list exactly as you would a username.
              A token can be granted <strong>less</strong> than you have, never more — and
              loses access automatically if you do. Bots do <strong>not</strong> inherit
              <code> PUBLIC</code> access; they must be added explicitly.
            </Typography>

            <Box sx={{ mb: 2 }}>
              <Button
                variant="contained"
                onClick={handleCreateToken}
                disabled={creating}
                data-testid="create-token"
              >
                {creating ? 'Creating…' : 'Create token'}
              </Button>
            </Box>

            {tokens.length === 0 ? (
              <Typography color="text.secondary" data-testid="no-tokens">
                You have no bot tokens.
              </Typography>
            ) : (
              <List dense disablePadding data-testid="token-list">
                {tokens.map((t) => (
                  <ListItem
                    key={t.id}
                    secondaryAction={
                      <Tooltip title="Revoke">
                        <IconButton
                          edge="end"
                          onClick={() => handleRevoke(t.id)}
                          data-testid={`revoke-${t.id}`}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <ListItemText
                      primary={t.identity ?? t.label ?? `Token ${t.id}`}
                      secondary={t.identity ? t.label : 'Legacy token — acts as you'}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>
      </Stack>

      {/* Shown once: the server stores only a hash and can never display it again. */}
      <Dialog open={revealed !== null} onClose={() => setRevealed(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Copy your token now</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This is the only time it will be shown. If you lose it, revoke it and make a
            new one.
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Identity (add this to components and bugs):
          </Typography>
          <TextField
            fullWidth
            value={revealed?.identity ?? ''}
            sx={{ mb: 2 }}
            slotProps={{
              htmlInput: { readOnly: true, 'data-testid': 'revealed-identity' },
            }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Token (secret):
          </Typography>
          <TextField
            fullWidth
            multiline
            value={revealed?.token ?? ''}
            slotProps={{ htmlInput: { readOnly: true, 'data-testid': 'revealed-token' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<ContentCopyIcon />}
            onClick={() => {
              if (revealed) void navigator.clipboard?.writeText(revealed.token);
            }}
          >
            Copy
          </Button>
          <Button onClick={() => setRevealed(null)} data-testid="dismiss-token">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AccountView;
