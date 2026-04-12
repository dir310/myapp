import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/myapp/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        conductor: resolve(__dirname, 'conductor/index.html'),
        clientes: resolve(__dirname, 'clientes.html'),
      },
    },
  },
});
