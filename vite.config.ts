import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages deployment: base must match repository name.
// If you fork under another repo (e.g. myfork/solar-tracker), change to that folder name.
const repoName = 'solar';

export default defineConfig({
  plugins: [react()],
  base: `/${repoName}/`,
});
