import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Grid
} from '@mui/material';
import { get_api, type ComponentSummary, type CreateBugRequest } from './api/api';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface CreateIssueViewProps {
  username: string;
}

const CreateIssueView: React.FC<CreateIssueViewProps> = ({ username }) => {
  const navigate = useNavigate();
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [componentId, setComponentId] = useState<number | ''>('');
  const [type, setType] = useState('Bug');
  const [priority, setPriority] = useState('P2');
  const [severity, setSeverity] = useState('S2');
  const [assignee, setAssignee] = useState('');
  const [verifier, setVerifier] = useState('');
  const [collaborators, setCollaborators] = useState('');
  const [cc, setCc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchComponents = async () => {
      const apiResult = get_api();
      if (apiResult.ok) {
        const result = await apiResult.val.get_component_list(username);
        if (result.ok) {
          setComponents(result.val);
          if (result.val.length > 0) {
            setComponentId(result.val[0].id);
          }
        } else {
          setError(result.val.message);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };
    fetchComponents();
  }, [username]);

  const renderMarkdown = (content: string) => {
    const rawHtml = marked.parse(content) as string;
    return { __html: DOMPurify.sanitize(rawHtml, { RETURN_TRUSTED_TYPE: true }) as unknown as string };
  };

  const handleSubmit = async () => {
    if (!title.trim() || componentId === '') {
      alert("Title and Component are required");
      return;
    }

    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);
    const request: CreateBugRequest = {
      component_id: componentId as number,
      template_name: '', // Default template
      title,
      description,
      type,
      priority,
      severity,
      assignee: assignee || undefined,
      verifier: verifier || undefined,
      collaborators: collaborators.split(',').map(s => s.trim()).filter(s => s !== ''),
      cc: cc.split(',').map(s => s.trim()).filter(s => s !== ''),
    };

    const result = await apiResult.val.create_bug(username, request);
    if (result.ok) {
      navigate(`/issue/${result.val}`);
    } else {
      alert("Failed to create issue: " + result.val.message);
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
        <Typography variant="h5" color="error" gutterBottom>Error Loading Components</Typography>
        <Typography color="text.secondary">{error}</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h4" sx={{ mb: 4, fontWeight: 500 }}>Create New Issue</Typography>
      
      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Main Form Column */}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack spacing={3}>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Stack spacing={3}>
                <TextField
                  fullWidth
                  label="Title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What's the issue?"
                  required
                />

                <TextField
                  fullWidth
                  multiline
                  minRows={10}
                  label="Description (Markdown)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace' } }}
                />
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ p: 3, bgcolor: 'rgba(0,0,0,0.1)' }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>Preview</Typography>
              <Box 
                sx={{ minHeight: 100 }}
                dangerouslySetInnerHTML={renderMarkdown(description || '*No description provided*')} 
              />
            </Paper>

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button 
                variant="contained" 
                size="large"
                onClick={handleSubmit} 
                disabled={isSubmitting}
                sx={{ px: 4, borderRadius: '24px' }}
              >
                {isSubmitting ? 'Creating...' : 'Create Issue'}
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
        </Box>

        {/* Sidebar Metadata Column */}
        <Box sx={{ width: { xs: '100%', md: 350 }, flexShrink: 0 }}>
          <Paper variant="outlined" sx={{ p: 3, position: 'sticky', top: 88 }}>
            <Typography variant="h6" gutterBottom>Metadata</Typography>
            <Divider sx={{ mb: 3 }} />
            
            <Stack spacing={3}>
              <FormControl fullWidth size="small" required>
                <InputLabel>Component</InputLabel>
                <Select
                  value={componentId}
                  label="Component"
                  onChange={(e) => setComponentId(Number(e.target.value))}
                >
                  {components.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      <Typography variant="body2" noWrap>{formatComponentPath(c)}</Typography>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select
                  value={type}
                  label="Type"
                  onChange={(e) => setType(e.target.value)}
                >
                  <MenuItem value="Bug">Bug</MenuItem>
                  <MenuItem value="Feature">Feature</MenuItem>
                  <MenuItem value="Task">Task</MenuItem>
                </Select>
              </FormControl>

              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Priority</InputLabel>
                    <Select
                      value={priority}
                      label="Priority"
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      {['P0', 'P1', 'P2', 'P3', 'P4'].map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Severity</InputLabel>
                    <Select
                      value={severity}
                      label="Severity"
                      onChange={(e) => setSeverity(e.target.value)}
                    >
                      {['S0', 'S1', 'S2', 'S3', 'S4'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <TextField
                fullWidth
                size="small"
                label="Assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Username"
              />

              <TextField
                fullWidth
                size="small"
                label="Verifier"
                value={verifier}
                onChange={(e) => setVerifier(e.target.value)}
                placeholder="Username"
              />

              <TextField
                fullWidth
                size="small"
                label="Collaborators"
                value={collaborators}
                onChange={(e) => setCollaborators(e.target.value)}
                placeholder="user1, user2"
              />

              <TextField
                fullWidth
                size="small"
                label="CC"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="user1, user2"
              />
            </Stack>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default CreateIssueView;
