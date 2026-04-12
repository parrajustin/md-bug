import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Card, 
  CardHeader, 
  CardContent, 
  Typography, 
  Box, 
  IconButton, 
  Menu, 
  MenuItem, 
  FormControlLabel, 
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  CircularProgress,
  Tooltip,
  Divider
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderIcon from '@mui/icons-material/Folder';
import EditIcon from '@mui/icons-material/Edit';
import { useNavigate } from 'react-router-dom';
import { get_api, type BugSummary, type ComponentSummary } from './api/api';

interface HomeViewProps {
  onBugSelect: (id: number) => void;
  username: string;
  search?: string;
  onSearch: (query: string) => void;
}

type SortKey = keyof BugSummary;

interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

interface VisibleColumns {
  id: boolean;
  title: boolean;
  status: boolean;
  priority: boolean;
  severity: boolean;
  type: boolean;
  description: boolean;
  created_at: boolean;
  last_updated_at: boolean;
}

const HomeView: React.FC<HomeViewProps> = ({ onBugSelect, username, search, onSearch }) => {
  const navigate = useNavigate();
  const [bugs, setBugs] = useState<BugSummary[]>([]);
  const [components, setComponents] = useState<ComponentSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [canAdmin, setCanAdmin] = useState(false);
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'last_updated_at', direction: 'desc' });
  const [visibleColumns, setVisibleColumns] = useState<VisibleColumns>({
    id: true,
    title: true,
    status: true,
    priority: true,
    severity: false,
    type: false,
    description: false,
    created_at: false,
    last_updated_at: true
  });
  
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [subMenuAnchorEl, setSubMenuAnchorEl] = useState<null | HTMLElement>(null);

  // Parse componentid from search query
  const activeComponentId = useMemo(() => {
    if (!search) return null;
    const match = search.match(/componentid:(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }, [search]);

  // Find the active component details
  const activeComponent = useMemo(() => {
    if (activeComponentId === null) return null;
    return components.find(c => c.id === activeComponentId);
  }, [activeComponentId, components]);

  // Filter components to show only children if an active component is selected
  const filteredComponents = useMemo(() => {
    if (activeComponentId === null) {
      return components.filter(c => c.parent_id === 0);
    }
    return components.filter(c => c.parent_id === activeComponentId);
  }, [activeComponentId, components]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const apiResult = get_api();
      if (apiResult.ok) {
        const [bugsResult, compsResult] = await Promise.all([
          apiResult.val.get_bug_list(username, search),
          apiResult.val.get_component_list(username)
        ]);

        if (bugsResult.ok) {
          setBugs(bugsResult.val);
        } else {
          setError(bugsResult.val.message);
        }

        if (compsResult.ok) {
          setComponents(compsResult.val);
        }
      } else {
        setError("API not available");
      }
      setLoading(false);
    };

    fetchData();
  }, [username, search]);

  // Check permissions for the active component
  useEffect(() => {
    const checkPerms = async () => {
      if (activeComponentId === null) {
        setCanAdmin(false);
        return;
      }
      const apiResult = get_api();
      if (apiResult.ok) {
        const res = await apiResult.val.get_component_metadata(username, activeComponentId);
        if (res.ok) {
          const meta = res.val;
          let admin = false;
          for (const group of Object.values(meta.access_control.groups)) {
            const isMember = group.members.includes(username) || group.members.includes('PUBLIC');
            if (isMember) {
              if (group.permissions.includes('ComponentAdmin') || group.permissions.includes('AdminIssues')) {
                admin = true;
                break;
              }
            }
          }
          setCanAdmin(admin);
        }
      }
    };
    checkPerms();
  }, [activeComponentId, username]);

  const sortedBugs = useMemo(() => {
    const sortableBugs = [...bugs];
    sortableBugs.sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    return sortableBugs;
  }, [bugs, sortConfig]);

  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const toggleColumn = (col: keyof VisibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));
  };

  const formatComponentPath = (c: ComponentSummary) => {
    if (c.folders.length === 0) return c.name;
    return c.folders.join(' > ') + ' > ' + c.name;
  };

  const formatTimestamp = (ts: bigint) => {
    const ms = Number(ts / 1000000n);
    return new Date(ms).toLocaleString();
  };

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setSubMenuAnchorEl(null);
  };

  const handleShowSubMenu = (event: React.MouseEvent<HTMLElement>) => {
    setSubMenuAnchorEl(event.currentTarget);
  };

  const handleComponentClick = (id: number) => {
    if (!search) {
      onSearch(`componentid:${id}`);
      return;
    }

    if (search.toLowerCase().includes('componentid:')) {
      const newSearch = search.replace(/componentid:\d+/i, `componentid:${id}`);
      onSearch(newSearch);
    } else {
      onSearch(`${search} componentid:${id}`.trim());
    }
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

  const columns: Array<{ id: keyof VisibleColumns; label: string }> = [
    { id: 'id', label: 'ID' },
    { id: 'title', label: 'Title' },
    { id: 'status', label: 'Status' },
    { id: 'priority', label: 'Priority' },
    { id: 'severity', label: 'Severity' },
    { id: 'type', label: 'Type' },
    { id: 'description', label: 'Description' },
    { id: 'created_at', label: 'Created' },
    { id: 'last_updated_at', label: 'Updated' },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Component Details Card (Special View) */}
      {activeComponent && (
        <Card sx={{ borderLeft: 6, borderLeftColor: 'primary.main' }}>
          <CardHeader 
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <FolderIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {activeComponent.id}: {activeComponent.name}
                </Typography>
              </Box>
            }
            action={
              canAdmin && (
                <Tooltip title="Edit Component">
                  <IconButton onClick={() => navigate(`/component/${activeComponent.id}`)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )
            }
          />
          <Divider />
          <CardContent>
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
              {activeComponent.description || "No description available for this component."}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Bugs List Card */}
      <Card>
        <CardHeader 
          title={activeComponent ? "Bugs in Component" : "All Bugs"}
          action={
            <Box>
              <IconButton onClick={handleMenuClick}>
                <MoreVertIcon />
              </IconButton>
              <Menu
                anchorEl={menuAnchorEl}
                open={Boolean(menuAnchorEl)}
                onClose={handleMenuClose}
              >
                <MenuItem onClick={handleShowSubMenu}>
                  Show <ChevronRightIcon sx={{ ml: 'auto' }} />
                </MenuItem>
              </Menu>
              <Menu
                anchorEl={subMenuAnchorEl}
                open={Boolean(subMenuAnchorEl)}
                onClose={() => setSubMenuAnchorEl(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                {columns.map((col) => (
                  <MenuItem key={col.id} onClick={() => toggleColumn(col.id)} sx={{ py: 0 }}>
                    <FormControlLabel
                      control={
                        <Checkbox 
                          checked={visibleColumns[col.id]} 
                          size="small"
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleColumn(col.id)}
                        />
                      }
                      label={col.label}
                      sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.85rem' } }}
                    />
                  </MenuItem>
                ))}
              </Menu>
            </Box>
          }
        />
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {columns.filter(c => visibleColumns[c.id]).map((col) => (
                    <TableCell 
                      key={col.id}
                      sortDirection={sortConfig.key === col.id ? sortConfig.direction : false}
                      sx={{ fontWeight: 'bold', bgcolor: '#262626' }}
                    >
                      <TableSortLabel
                        active={sortConfig.key === col.id}
                        direction={sortConfig.key === col.id ? sortConfig.direction : 'asc'}
                        onClick={() => requestSort(col.id as SortKey)}
                      >
                        {col.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedBugs.map((bug) => (
                  <TableRow 
                    key={bug.id} 
                    hover 
                    onClick={() => onBugSelect(bug.id)}
                    sx={{ cursor: 'pointer', '&:last-child td, &:last-child th': { border: 0 } }}
                  >
                    {visibleColumns.id && <TableCell sx={{ color: 'primary.main', fontFamily: 'monospace' }}>{bug.id}</TableCell>}
                    {visibleColumns.title && <TableCell>{bug.title}</TableCell>}
                    {visibleColumns.status && <TableCell>{bug.status}</TableCell>}
                    {visibleColumns.priority && <TableCell>{bug.priority}</TableCell>}
                    {visibleColumns.severity && <TableCell>{bug.severity}</TableCell>}
                    {visibleColumns.type && <TableCell>{bug.type}</TableCell>}
                    {visibleColumns.description && (
                      <TableCell sx={{ 
                        maxWidth: 300, 
                        whiteSpace: 'nowrap', 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis' 
                      }}>
                        {bug.description}
                      </TableCell>
                    )}
                    {visibleColumns.created_at && <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{formatTimestamp(bug.created_at)}</TableCell>}
                    {visibleColumns.last_updated_at && <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{formatTimestamp(bug.last_updated_at)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Components Card */}
      <Card>
        <CardHeader title={activeComponent ? "Sub-Components" : "Components"} />
        <CardContent>
          {filteredComponents.length === 0 && <Typography color="text.secondary">No {activeComponent ? "sub-components" : "components"} found.</Typography>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filteredComponents.map((comp) => (
              <Paper 
                key={comp.id} 
                variant="outlined"
                onClick={() => handleComponentClick(comp.id)}
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

export default HomeView;
