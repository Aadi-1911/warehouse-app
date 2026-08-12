// Browser entry point — the one place React attaches itself to the real DOM.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// StrictMode is development-only. It intentionally double-invokes effects and renders to
// surface side-effect bugs early (see the `cancelled` guard in useAuth.jsx); it compiles out
// of production builds entirely.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
