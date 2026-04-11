import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#3b82f6', // --accent-color
    },
    background: {
      default: '#0b0b0b', // --bg-color
      paper: '#1a1a1a',   // --card-bg
    },
    text: {
      primary: '#e0e0e0', // --text-color
      secondary: '#888',
    },
    divider: '#333',
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    h2: {
      fontSize: '1.5rem',
      fontWeight: 500,
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1f1f1f', // --topbar-bg
          borderBottom: '1px solid #333',
          boxShadow: 'none',
          height: '64px',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#121212', // --sidepanel-bg
          borderRight: '1px solid #333',
          width: 250,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 8,
        },
      },
    },
  },
});
