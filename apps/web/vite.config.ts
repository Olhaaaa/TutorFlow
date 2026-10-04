import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // у розробці фронтенд і API на різних портах; проксі знімає питання CORS,
    // а в продакшні їх віддає один процес, тому код однаковий
    proxy: { '/api': 'http://localhost:8080' },
  },
  // збірка кладеться туди, звідки її віддає Nest
  build: { outDir: '../../services/api/static', emptyOutDir: true },
});
