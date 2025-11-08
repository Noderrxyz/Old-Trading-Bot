// Type declarations for external modules
declare module 'react';
declare module '@mui/material';
declare module '@mui/material/styles';
declare module '@mui/icons-material/*';

// Global JSX namespace declaration
declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

// Extend theme type for Material UI
declare module '@mui/material/styles' {
  interface Theme {
    status: {
      danger: string;
    };
  }
  // allow configuration using `createTheme`
  interface ThemeOptions {
    status?: {
      danger?: string;
    };
  }
} 