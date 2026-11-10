/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset paths relative, so the same build works on
// GitHub Pages (/254-battery-bench/) and on any other static host.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'] } },
    },
  },
  test: { environment: 'node' },
});
