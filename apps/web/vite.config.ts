import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Аліас @ → src: цього чекають компоненти shadcn/ui, які копіюються
    // в проєкт із реєстру й імпортують одне одного як '@/components/ui/...'
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // у розробці фронтенд і API на різних портах; проксі знімає питання CORS,
    // а в продакшні їх віддає один процес, тому код однаковий
    proxy: { '/api': 'http://localhost:8080' },
  },
  // збірка кладеться туди, звідки її віддає Nest
  build: { outDir: '../../services/api/static', emptyOutDir: true },
});
