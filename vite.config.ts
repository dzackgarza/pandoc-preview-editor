import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/pw-poll': 'http://127.0.0.1:6275',
      '/pw': 'http://127.0.0.1:6275',
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
