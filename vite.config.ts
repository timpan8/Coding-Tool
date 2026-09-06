import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';

let commit = 'development';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* Uncommitted first build. */ }
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(`0.1.0 · ${process.env.GITHUB_SHA?.slice(0, 7) || commit}`) },
  build: { modulePreload: { polyfill: false } },
  server: { strictPort: true },
  // Playwright owns e2e/; without this vitest claims those files and fails on its missing globals.
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
});
