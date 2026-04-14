import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        conductor: resolve(__dirname, 'conductor.html'),
        clientes: resolve(__dirname, 'clientes.html'),
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
});
