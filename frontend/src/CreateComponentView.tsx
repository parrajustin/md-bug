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
  CircularProgress
} from '@mui/material';
import { get_api, type ComponentSummary, type CreateComponentRequest } from './api/api';

interface CreateComponentViewProps {
  username: string;
}

const CreateComponentView: React.FC<CreateComponentViewProps> = ({ username }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const result = await apiResult.val.get_component_list(username);
        if (result.ok) {
          const comps = result.val;
          setComponents(comps);
          
          // Check for parent_id in URL
          const paramId = searchParams.get('parent_id');
          if (paramId) {
            const id = parseInt(paramId);
            if (id === 0 || comps.some(c => c.id === id)) {
              setParentId(id);
            }
          }
        } else {
          setError(result.val.message);
        }
      } else {
        setError("API not available");
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
    const request: CreateComponentRequest = {
      name,
      description,
      parent_id: parentId,
    };

    const result = await apiResult.val.create_component(username, request);
    if (result.ok) {
      // Navigate to the component view (using search)
      // Since it's a new component, we don't have the ID yet in the response (API returns void)
      // For now, go back home.
      navigate('/');
    } else {
      alert("Failed to create component: " + result.val.message);
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

  if (error) {
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
          <TextField
            fullWidth
            label="Component Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Frontend, Database, API"
            required
            helperText="Lowercase alphanumeric and underscores only."
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

          <FormControl fullWidth>
            <InputLabel>Parent Component</InputLabel>
            <Select
              value={parentId}
              label="Parent Component"
              onChange={(e) => setParentId(Number(e.target.value))}
            >
              <MenuItem value={0}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  [Root] (No parent)
                </Typography>
              </MenuItem>
              {components.map(c => (
                <MenuItem key={c.id} value={c.id}>
                  <Typography variant="body2" noWrap>{formatComponentPath(c)}</Typography>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Divider sx={{ my: 1 }} />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button 
              variant="contained" 
              size="large"
              onClick={handleSubmit} 
              disabled={isSubmitting}
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
