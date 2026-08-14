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
    // Without this, Vite binds only to 127.0.0.1/localhost — unreachable from a phone or any
    // other device on the LAN even though they're on the same network. `true` binds to 0.0.0.0
    // (all interfaces), so http://<this machine's LAN IP>:5173 becomes reachable too. Dev/test
    // convenience only — doesn't affect the production build (`vite build` output is static
    // files served by whatever's hosting them, this dev-server setting is irrelevant there).
    host: true,
  },
});
