import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, 
  Typography, 
  Paper, 
  Tabs, 
  Tab, 
  TextField, 
  Button, 
  Stack, 
  Divider, 
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Checkbox,
  IconButton,
  Tooltip,
  Card,
  CardHeader,
  CardContent,
  FormControl,
  InputLabel,
  Select, 
  MenuItem, 
  Autocomplete, 
  Chip,
  Grid
  } from '@mui/material';

import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderIcon from '@mui/icons-material/Folder';
import { get_api, type ComponentMetadata, type Permission, type ComponentSummary } from './api/api';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function CustomTabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

const ALL_PERMISSIONS: Permission[] = [
  'ComponentAdmin',
  'CreateIssues',
  'AdminIssues',
  'EditIssues',
  'CommentOnIssues',
  'ViewIssues'
];

interface ComponentEditorViewProps {
  username: string;
}

const ComponentEditorView: React.FC<ComponentEditorViewProps> = ({ username }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<ComponentMetadata | null>(null);
  const [components, setComponents] = useState<ComponentSummary[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const apiResult = get_api();
      if (apiResult.ok) {
        const [metaRes, compsRes] = await Promise.all([
          apiResult.val.get_component_metadata(username, parseInt(id)),
          apiResult.val.get_component_list(username)
        ]);

        if (metaRes.ok) {
          setMetadata(metaRes.val);
        } else {
          setError(metaRes.val.message);
        }

        if (compsRes.ok) {
          setComponents(compsRes.val);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };
    fetchData();
  }, [id, username]);

  const subComponents = useMemo(() => {
    if (!metadata) return [];
    return components.filter(c => c.parent_id === metadata.id);
  }, [components, metadata]);

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  const handleSave = async () => {
    if (!metadata || !id) return;
    const apiResult = get_api();
    if (!apiResult.ok) return;

    setIsSubmitting(true);
    const res = await apiResult.val.update_component_metadata(username, parseInt(id), metadata);
    if (res.ok) {
      alert("Changes saved successfully");
    } else {
      alert("Failed to save: " + res.val.message);
    }
    setIsSubmitting(false);
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const updateField = (field: keyof ComponentMetadata, value: any) => {
    if (!metadata) return;
    setMetadata({ ...metadata, [field]: value });
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
  if (error || !metadata) return <Box sx={{ p: 4 }}><Typography color="error">Error: {error || "Component not found"}</Typography></Box>;

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ mb: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={() => navigate(-1)} size="small"><ArrowBackIcon /></IconButton>
        <Typography variant="h4" sx={{ fontWeight: 500 }}>
          {metadata.name} <Typography component="span" variant="h4" color="text.secondary">({metadata.id})</Typography>
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Button 
          variant="contained" 
          startIcon={<SaveIcon />} 
          onClick={handleSave} 
          disabled={isSaving}
          sx={{ borderRadius: '24px', px: 3 }}
        >
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </Box>

      <Card variant="outlined">
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="component editor tabs">
            <Tab label="Metadata" />
            <Tab label="Templates" />
            <Tab label="Access" />
          </Tabs>
        </Box>
        <CardContent>
          {/* METADATA TAB */}
          <CustomTabPanel value={tabValue} index={0}>
            <Stack spacing={3} sx={{ maxWidth: 800 }}>
              <TextField 
                label="Name" 
                fullWidth 
                value={metadata.name} 
                onChange={(e) => updateField('name', e.target.value)}
              />
              <TextField 
                label="Description" 
                fullWidth 
                multiline 
                rows={4} 
                value={metadata.description} 
                onChange={(e) => updateField('description', e.target.value)}
              />
            </Stack>
          </CustomTabPanel>

          {/* TEMPLATES TAB */}
          <CustomTabPanel value={tabValue} index={1}>
            <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="outlined" startIcon={<AddIcon />}>Add New Template</Button>
            </Box>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.values(metadata.templates).map((template) => (
                    <TableRow key={template.name} hover>
                      <TableCell sx={{ fontWeight: 500 }}>{template.name || "[Default]"}</TableCell>
                      <TableCell color="text.secondary">{template.description}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" color="error"><DeleteIcon fontSize="small" /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {Object.keys(metadata.templates).length === 0 && (
                    <TableRow><TableCell colSpan={3} align="center">No custom templates defined.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CustomTabPanel>

          {/* ACCESS TAB */}
          <CustomTabPanel value={tabValue} index={2}>
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>Access Group</TableCell>
                    {ALL_PERMISSIONS.map(p => (
                      <TableCell key={p} align="center" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }}>
                        {p.replace(/([A-Z])/g, ' $1').trim()}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(metadata.access_control.groups).map(([name, group]) => (
                    <TableRow key={name} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>{name}</TableCell>
                      {ALL_PERMISSIONS.map(p => {
                        const hasPerm = group.permissions.includes(p);
                        return (
                          <TableCell key={p} align="center">
                            <Checkbox 
                              size="small" 
                              checked={hasPerm} 
                              color={hasPerm ? "primary" : "default"}
                              onChange={(e) => {
                                const newGroups = { ...metadata.access_control.groups };
                                const currentPerms = [...group.permissions];
                                if (e.target.checked) {
                                  currentPerms.push(p);
                                } else {
                                  const idx = currentPerms.indexOf(p);
                                  if (idx > -1) currentPerms.splice(idx, 1);
                                }
                                newGroups[name] = { ...group, permissions: currentPerms };
                                updateField('access_control', { ...metadata.access_control, groups: newGroups });
                              }}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack spacing={3}>
              <Typography variant="h6">Group Members</Typography>
              {Object.entries(metadata.access_control.groups).map(([name, group]) => (
                <Box key={name}>
                  <Typography variant="subtitle2" gutterBottom>{name}</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="user1, user2, PUBLIC..."
                    value={group.members.join(', ')}
                    onChange={(e) => {
                      const newGroups = { ...metadata.access_control.groups };
                      newGroups[name] = { ...group, members: e.target.value.split(',').map(s => s.trim()).filter(s => s !== '') };
                      updateField('access_control', { ...metadata.access_control, groups: newGroups });
                    }}
                    helperText={`Users in ${name} group.`}
                  />
                </Box>
              ))}
            </Stack>
          </CustomTabPanel>
        </CardContent>
      </Card>

      {/* Sub-Components Card */}
      <Card variant="outlined">
        <CardHeader 
          title="Sub-Components" 
          titleTypographyProps={{ variant: 'h6', sx: { fontWeight: 'bold' } }}
        />
        <Divider />
        <CardContent>
          {subComponents.length === 0 && (
            <Typography color="text.secondary">No sub-components found.</Typography>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {subComponents.map((comp) => (
              <Paper 
                key={comp.id} 
                variant="outlined"
                onClick={() => navigate(`/component/${comp.id}`)}
                sx={{ 
                  p: 1.5, 
                  bgcolor: '#1e1e1e',
                  borderColor: 'divider',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  '&:hover': { 
                    bgcolor: '#252525',
                    borderColor: 'primary.main'
                  }
                }}
              >
                <FolderIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {comp.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatComponentPath(comp)}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default ComponentEditorView;
