import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2020' },
  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/tg': 'http://127.0.0.1:8787' } },
});
