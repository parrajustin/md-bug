import React, { useState } from 'react';
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
  Divider
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

interface LayoutProps {
  children: React.ReactNode;
  username: string;
  onSignOut: () => void;
}

const DRAWER_WIDTH = 250;

const Layout: React.FC<LayoutProps> = ({ children, username, onSignOut }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSignOut = () => {
    handleClose();
    onSignOut();
  };

  const navItems = [
    { text: 'Home', icon: <HomeIcon />, path: '/' },
    { text: 'Assigned to me', icon: <AssignmentIcon />, action: () => navigate('/issue/423673307') },
    { text: 'Non-existent Bug', icon: <NotificationImportantIcon />, action: () => navigate('/issue/999') },
    { text: 'Starred by me', icon: <StarIcon /> },
    { text: 'Upvoted by me', icon: <ThumbUpIcon /> },
    { text: 'CC\'d to me', icon: <NotificationImportantIcon /> },
    { text: 'Collaborating', icon: <PeopleIcon /> },
    { text: 'Reported by me', icon: <HistoryIcon /> },
    { text: 'To be verified', icon: <VerifiedIcon /> },
  ];

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
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => navigate('/')}
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
              />
            </Search>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }} onClick={handleMenu}>
            <Typography variant="body2" color="text.secondary">
              {username}
            </Typography>
            <Avatar sx={{ width: 32, height: 32, fontSize: '0.8rem', bgcolor: 'primary.main' }}>
              {username.charAt(0).toUpperCase()}
            </Avatar>
            <Menu
              anchorEl={anchorEl}
              open={Boolean(anchorEl)}
              onClose={handleClose}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <MenuItem onClick={handleSignOut}>Sign out</MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
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
          <Button 
            variant="contained" 
            fullWidth 
            startIcon={<AddIcon />}
            onClick={() => navigate('/create_issue')}
            sx={{ 
              borderRadius: '24px', 
              py: 1.5,
              fontWeight: 'bold',
              bgcolor: 'primary.main',
              '&:hover': {
                bgcolor: '#2563eb'
              }
            }}
          >
            Create Issue
          </Button>
        </Box>
        <Divider />
        <List sx={{ px: 1 }}>
          {navItems.map((item) => (
            <ListItem key={item.text} disablePadding>
              <ListItemButton 
                onClick={item.action || (item.path ? () => navigate(item.path!) : undefined)}
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
      <Box component="main" sx={{ flexGrow: 1, p: 3, pt: '88px', overflowY: 'auto' }}>
        {children}
      </Box>
    </Box>
  );
};

export default Layout;
