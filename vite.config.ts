import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use relative base so the app works both locally and when served from a sub-path (GitHub Pages).
// GitHub Pages will host at https://<user>.github.io/<repo>/ so relative asset URLs resolve correctly.
export default defineConfig({
  plugins: [react()],
  base: './',
});
