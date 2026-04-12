import React, { useState, useEffect } from 'react';
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
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import { get_api, type ComponentMetadata, type Permission, type BugTemplate, type UserMetadataEntry } from './api/api';

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

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const apiResult = get_api();
      if (apiResult.ok) {
        const res = await apiResult.val.get_component_metadata(username, parseInt(id));
        if (res.ok) {
          setMetadata(res.val);
        } else {
          setError(res.val.message);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };
    fetchData();
  }, [id, username]);

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
    <Box sx={{ width: '100%' }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
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
              
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" color="primary">Defaults for new bugs</Typography>
              
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Bug Type</InputLabel>
                    <Select value={metadata.bug_type || ''} label="Bug Type" onChange={(e) => updateField('bug_type', e.target.value)}>
                      <MenuItem value="Bug">Bug</MenuItem>
                      <MenuItem value="Feature">Feature</MenuItem>
                      <MenuItem value="Task">Task</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Priority</InputLabel>
                    <Select value={metadata.priority || ''} label="Priority" onChange={(e) => updateField('priority', e.target.value)}>
                      {['P0', 'P1', 'P2', 'P3', 'P4'].map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Severity</InputLabel>
                    <Select value={metadata.severity || ''} label="Severity" onChange={(e) => updateField('severity', e.target.value)}>
                      {['S0', 'S1', 'S2', 'S3', 'S4'].map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>

              <TextField 
                label="Assignee" 
                fullWidth 
                size="small" 
                value={metadata.verifier || ''} 
                onChange={(e) => updateField('verifier', e.target.value)} 
              />

              <Autocomplete
                multiple
                options={[]}
                freeSolo
                value={metadata.collaborators}
                onChange={(_e, val) => updateField('collaborators', val)}
                renderTags={(value: string[], getTagProps) =>
                  value.map((option: string, index: number) => (
                    <Chip variant="outlined" label={option} {...getTagProps({ index })} />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="Collaborators" placeholder="Add user..." size="small" />
                )}
              />

              <Autocomplete
                multiple
                options={[]}
                freeSolo
                value={metadata.cc}
                onChange={(_e, val) => updateField('cc', val)}
                renderTags={(value: string[], getTagProps) =>
                  value.map((option: string, index: number) => (
                    <Chip variant="outlined" label={option} {...getTagProps({ index })} />
                  ))
                }
                renderInput={(params) => (
                  <TextField {...params} label="CC" placeholder="Add user..." size="small" />
                )}
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
    </Box>
  );
};

export default ComponentEditorView;
