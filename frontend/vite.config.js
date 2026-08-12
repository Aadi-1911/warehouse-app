// Vite build/dev-server config for the frontend.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned rather than left to auto-increment: the backend's CORS_ORIGIN names this exact
    // origin, so a shifted port would start failing every request with a CORS error.
    port: 5173,
    strictPort: true,
  },
});
