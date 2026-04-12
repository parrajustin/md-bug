import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Box, 
  Drawer, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemText, 
  Button, 
  InputBase, 
  Avatar, 
  Menu, 
  MenuItem,
  IconButton,
  Divider,
  ButtonGroup,
  Paper
} from '@mui/material';
import { styled, alpha } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import HomeIcon from '@mui/icons-material/Home';
import AssignmentIcon from '@mui/icons-material/Assignment';
import StarIcon from '@mui/icons-material/Star';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import NotificationImportantIcon from '@mui/icons-material/NotificationImportant';
import PeopleIcon from '@mui/icons-material/People';
import HistoryIcon from '@mui/icons-material/History';
import VerifiedIcon from '@mui/icons-material/Verified';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { get_api, type ComponentMetadata } from './api/api';

const DRAWER_WIDTH = 250;

const Search = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: theme.shape.borderRadius * 2,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginRight: theme.spacing(2),
  marginLeft: 0,
  width: '100%',
  [theme.breakpoints.up('sm')]: {
    marginLeft: theme.spacing(3),
    width: 'auto',
    minWidth: '400px',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  width: '100%',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create('width'),
    width: '100%',
  },
}));

const Main = styled('main', { shouldForwardProp: (prop) => prop !== 'open' })<{
  open?: boolean;
}>(({ theme, open }) => ({
  flexGrow: 1,
  padding: theme.spacing(3),
  paddingTop: '88px',
  transition: theme.transitions.create('margin', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  marginLeft: `-${DRAWER_WIDTH}px`,
  overflowY: 'auto',
  ...(open && {
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
    marginLeft: 0,
  }),
}));

interface LayoutProps {
  children: React.ReactNode;
  username: string;
  onSignOut: () => void;
  searchValue: string;
  onSearch: (value: string) => void;
  bugComponentId: number | null;
}

const Layout: React.FC<LayoutProps> = ({ children, username, onSignOut, searchValue, onSearch, bugComponentId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [createMenuAnchorEl, setCreateMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [localSearch, setLocalSearch] = useState(searchValue);
  
  const [currentComponentMeta, setCurrentComponentMeta] = useState<ComponentMetadata | null>(null);
  const [permissions, setPermissions] = useState<{ canCreateBug: boolean; isAdmin: boolean }>({
    canCreateBug: false,
    isAdmin: false,
  });

  // Parse componentId from search or URL
  const componentId = useMemo(() => {
    // 1. Check if in bug view
    if (location.pathname.startsWith('/issue/')) {
      return bugComponentId;
    }

    // 2. Check if in component view (Home with componentid:)
    if ((location.pathname === '/' || location.pathname === '/home') && searchValue) {
      const match = searchValue.match(/componentid:(\d+)/i);
      if (match) return parseInt(match[1]);
    }
    
    return null;
  }, [location.pathname, searchValue, bugComponentId]);

  useEffect(() => {
    setLocalSearch(searchValue);
  }, [searchValue]);

  useEffect(() => {
    const fetchPerms = async () => {
      if (componentId === null) {
        setPermissions({ canCreateBug: false, isAdmin: false });
        setCurrentComponentMeta(null);
        return;
      }

      const apiResult = get_api();
      if (apiResult.ok) {
        const res = await apiResult.val.get_component_metadata(username, componentId);
        if (res.ok) {
          const meta = res.val;
          setCurrentComponentMeta(meta);
          
          let canCreate = false;
          let isAdmin = false;

          for (const group of Object.values(meta.access_control.groups)) {
            const isMember = group.members.includes(username) || group.members.includes('PUBLIC');
            if (isMember) {
              if (group.permissions.includes('CreateIssues')) canCreate = true;
              if (group.permissions.includes('ComponentAdmin')) isAdmin = true;
              if (group.permissions.includes('AdminIssues')) {
                canCreate = true;
                isAdmin = true;
              }
            }
          }
          setPermissions({ canCreateBug: canCreate, isAdmin });
        }
      }
    };
    fetchPerms();
  }, [componentId, username]);

  const handleSearchSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearch(localSearch);
    }
  };

  const handleSignOut = () => {
    setAnchorEl(null);
    onSignOut();
  };

  const toggleDrawer = () => {
    setIsDrawerOpen(!isDrawerOpen);
  };

  const navItems = [
    { text: 'Home', icon: <HomeIcon />, path: '/', action: () => onSearch('') },
    { text: 'Assigned to me', icon: <AssignmentIcon />, action: () => navigate('/issue/423673307') },
    { text: 'Non-existent Bug', icon: <NotificationImportantIcon />, action: () => navigate('/issue/999') },
    { text: 'Starred by me', icon: <StarIcon /> },
    { text: 'Upvoted by me', icon: <ThumbUpIcon /> },
    { text: 'CC\'d to me', icon: <NotificationImportantIcon /> },
    { text: 'Collaborating', icon: <PeopleIcon /> },
    { text: 'Reported by me', icon: <HistoryIcon /> },
    { text: 'To be verified', icon: <VerifiedIcon /> },
  ];

  const handleCreateMenuClose = () => {
    setCreateMenuAnchorEl(null);
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      <AppBar 
        position="fixed" 
        sx={{ 
          zIndex: (theme) => theme.zIndex.drawer + 1,
          height: 64,
          justifyContent: 'center'
        }}
      >
        <Toolbar>
          <IconButton
            size="large"
            edge="start"
            color="inherit"
            aria-label="menu"
            sx={{ mr: 2 }}
            onClick={toggleDrawer}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => onSearch('')}
          >
            IssueTracker
          </Typography>
          <Box sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center' }}>
            <Search>
              <SearchIconWrapper>
                <AssignmentIcon fontSize="small" />
              </SearchIconWrapper>
              <StyledInputBase
                placeholder="Search bugs..."
                inputProps={{ 'aria-label': 'search' }}
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                onKeyDown={handleSearchSubmit}
              />
            </Search>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={(e) => setAnchorEl(e.currentTarget)}>
            <Typography variant="body2" color="text.secondary">
              {username}
            </Typography>
            <Avatar sx={{ width: 32, height: 32, fontSize: '0.8rem', bgcolor: 'primary.main' }}>
              {username.charAt(0).toUpperCase()}
            </Avatar>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={() => setAnchorEl(null)}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem onClick={handleSignOut}>Sign out</MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="persistent"
        open={isDrawerOpen}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { 
            width: DRAWER_WIDTH, 
            boxSizing: 'border-box',
            pt: '64px' // Height of AppBar
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <ButtonGroup 
            variant="contained" 
            fullWidth 
            sx={{ 
              borderRadius: '24px',
              overflow: 'hidden',
              boxShadow: 'none',
              bgcolor: 'primary.main',
              '& .MuiButton-root': {
                border: 'none',
                py: 1.5,
                '&:hover': {
                  bgcolor: '#2563eb'
                }
              }
            }}
          >
            <Button 
              startIcon={<AddIcon />}
              onClick={() => navigate('/create_issue')}
              sx={{ 
                flex: '0 0 80%', 
                justifyContent: 'flex-start',
                pl: 2.5,
                fontWeight: 'bold',
                textTransform: 'none',
                borderRadius: '24px 0 0 24px !important'
              }}
            >
              Create Issue
            </Button>
            <Box sx={{ width: '1px', bgcolor: 'rgba(255,255,255,0.3)', my: 1.5, zIndex: 1 }} />
            <Button
              size="small"
              sx={{ 
                flex: '0 0 20%', 
                minWidth: 0,
                p: 0, 
                justifyContent: 'center',
                borderRadius: '0 24px 24px 0 !important'
              }}
              onClick={(e) => setCreateMenuAnchorEl(e.currentTarget)}
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          
          <Menu
            anchorEl={createMenuAnchorEl}
            open={Boolean(createMenuAnchorEl)}
            onClose={handleCreateMenuClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            PaperProps={{
              sx: { width: 218, mt: 0.5 }
            }}
          >
            {/* 1) Create Issue in same component */}
            {componentId !== null && permissions.canCreateBug && (
              <MenuItem onClick={() => { navigate(`/create_issue?component_id=${componentId}`); handleCreateMenuClose(); }}>
                <Typography variant="body2">Create issue in {currentComponentMeta?.name}</Typography>
              </MenuItem>
            )}
            
            {/* 2) Create Component - always visible */}
            <MenuItem onClick={() => { navigate('/create_component'); handleCreateMenuClose(); }}>
              <Typography variant="body2">Create Component</Typography>
            </MenuItem>

            {/* 3) Create Component in this component - only in component view context */}
            {componentId !== null && permissions.isAdmin && location.pathname.startsWith('/issue/') === false && (
              <MenuItem onClick={() => { navigate(`/create_component?parent_id=${componentId}`); handleCreateMenuClose(); }}>
                <Typography variant="body2">Create Component in this component</Typography>
              </MenuItem>
            )}

            {/* 4) Create bug template - only in component view context */}
            {componentId !== null && permissions.isAdmin && location.pathname.startsWith('/issue/') === false && (
              <MenuItem onClick={() => { handleCreateMenuClose(); /* Template creation view not yet implemented */ }}>
                <Typography variant="body2">Create bug template</Typography>
              </MenuItem>
            )}
          </Menu>
        </Box>
        <Divider />
        <List sx={{ px: 1 }}>
          {navItems.map((item) => (
            <ListItem key={item.text} disablePadding>
              <ListItemButton 
                onClick={() => {
                  if (item.action) item.action();
                  else if (item.path) navigate(item.path);
                }}
                selected={item.path ? location.pathname === item.path : false}
                sx={{ 
                  borderRadius: 1,
                  mb: 0.5,
                  '&.Mui-selected': {
                    bgcolor: alpha('#1e3a8a', 0.8),
                    '&:hover': {
                      bgcolor: alpha('#1e3a8a', 1),
                    }
                  }
                }}
              >
                <Box sx={{ mr: 2, display: 'flex', color: 'text.secondary' }}>
                  {item.icon}
                </Box>
                <ListItemText 
                  primary={item.text} 
                  primaryTypographyProps={{ fontSize: '0.9rem' }} 
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Drawer>
      <Main open={isDrawerOpen}>
        {children}
      </Main>
    </Box>
  );
};

export default Layout;
