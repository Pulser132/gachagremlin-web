import { defineConfig } from 'vite';

// Project Pages sites are served under /<repo-name>/, so every asset URL
// must be built relative to that subpath rather than the domain root.
export default defineConfig({
  base: '/gachagremlin-web/',
});
