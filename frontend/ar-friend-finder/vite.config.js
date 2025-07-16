import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://c8fe3e3e0653.ngrok-free.app',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: { outDir: 'dist' },
});
