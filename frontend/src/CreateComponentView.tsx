import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  TextField, 
  Button, 
  Stack, 
  Select, 
  MenuItem, 
  FormControl, 
  InputLabel, 
  Divider,
  CircularProgress,
  Alert,
  FormHelperText,
  FormControlLabel,
  Switch
} from '@mui/material';
import { get_api, type ComponentSummary, type CreateComponentRequest } from './api/api';

interface CreateComponentViewProps {
  username: string;
  /// Root components can only be created by an administrator — the backend has no parent
  /// ACL to consult, so it checks the account flag instead. Non-admins never see the
  /// toggle, and would get a 403 if they somehow reached the endpoint.
  isAdmin: boolean;
}

const CreateComponentView: React.FC<CreateComponentViewProps> = ({ username, isAdmin }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /// Distinguishes "the page could not load" (render an error page) from "the submission
  /// failed" (keep the form and show the message inline).
  const [loadFailed, setLoadFailed] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number>(0);
  const [asRoot, setAsRoot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const result = await apiResult.val.get_component_list();
        if (result.ok) {
          const comps = result.val;
          setComponents(comps);
          
          // Check for parent_id in URL
          const paramId = searchParams.get('parent_id');
          const requested = paramId ? parseInt(paramId) : NaN;
          if (!Number.isNaN(requested) && comps.some(c => c.id === requested)) {
            setParentId(requested);
          } else if (comps.length > 0) {
            // Default to the first real component rather than the unusable [Root]
            // entry, so the form opens ready to submit.
            setParentId(comps[0].id);
          }
        } else {
          setError(result.val.message);
          setLoadFailed(true);
        }
      } else {
        setError("API not available");
        setLoadFailed(true);
      }
      setLoading(false);
    };
    fetchData();
  }, [username, searchParams]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      alert("Name is required");
      return;
    }

    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);

    // Root components go to a separate admin-only endpoint; `create_component` rejects
    // parent_id 0 unconditionally and always will.
    const result = asRoot
      ? await apiResult.val.create_root_component({ name, description })
      : await apiResult.val.create_component({
          name,
          description,
          parent_id: parentId,
        } as CreateComponentRequest);

    if (result.ok) {
      navigate('/');
    } else {
      setError(result.val.message);
    }
    setIsSubmitting(false);
  };

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && loadFailed) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography variant="h5" color="error" gutterBottom>Error Loading Data</Typography>
        <Typography color="text.secondary">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto' }}>
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 500 }}>Create New Component</Typography>
      
      <Paper variant="outlined" sx={{ p: 4 }}>
        <Stack spacing={3}>
          {components.length === 0 && !asRoot && (
            <Alert severity="info" data-testid="no-components-notice">
              {isAdmin ? (
                <>
                  No components exist yet, so there is nothing to nest under. Turn on
                  <strong> Create as a root component</strong> to make the first one.
                </>
              ) : (
                <>
                  No components exist yet, so there is nothing to nest under. Only an
                  administrator can create a root component — ask one to set up the first.
                </>
              )}
            </Alert>
          )}

          {isAdmin && (
            <FormControlLabel
              control={
                <Switch
                  checked={asRoot}
                  onChange={(e) => setAsRoot(e.target.checked)}
                  data-testid="root-toggle"
                />
              }
              label="Create as a root component (no parent)"
            />
          )}

          <TextField
            fullWidth
            label="Component Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Frontend, Database, API"
            required
            helperText="Lowercase alphanumeric and underscores only."
            slotProps={{ htmlInput: { 'data-testid': 'component-name' } }}
          />

          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this component for?"
          />

          {asRoot ? (
            <Alert severity="warning" data-testid="root-mode-notice">
              This will create a top-level component with <strong>{username}</strong> as
              its only administrator. Everyone else gets contributor access.
            </Alert>
          ) : (
          <FormControl fullWidth>
            <InputLabel>Parent Component</InputLabel>
            <Select
              value={parentId}
              label="Parent Component"
              onChange={(e) => setParentId(Number(e.target.value))}
            >
              {/* `create_component` rejects parent_id 0 by design, so this stays
                  disabled — roots come from the toggle above (admins) or the CLI.
                  Kept visible so the constraint is discoverable. */}
              <MenuItem value={0} disabled>
                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                  {isAdmin ? '[Root] — use the toggle above' : '[Root] — admins only'}
                </Typography>
              </MenuItem>
              {components.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <Typography variant="body2" noWrap>{formatComponentPath(c)}</Typography>
                </MenuItem>
              ))}
            </Select>
            {parentId === 0 && (
              <FormHelperText error>
                Pick a parent component{isAdmin ? ', or switch on "Create as a root component" above.' : '. Only an administrator can create a root component.'}
              </FormHelperText>
            )}
          </FormControl>
          )}

          {error && !loadFailed && (
            <Alert severity="error" data-testid="create-error">{error}</Alert>
          )}

          <Divider sx={{ my: 1 }} />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button 
              variant="contained" 
              size="large"
              onClick={handleSubmit}
              disabled={isSubmitting || (!asRoot && parentId === 0)}
              sx={{ px: 4, borderRadius: '24px' }}
            >
              {isSubmitting ? 'Creating...' : 'Create Component'}
            </Button>
            <Button 
              variant="outlined" 
              size="large"
              onClick={() => navigate('/')}
              sx={{ px: 4, borderRadius: '24px' }}
            >
              Cancel
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  );
};

export default CreateComponentView;
