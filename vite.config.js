import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        conductor: resolve(__dirname, 'conductor/index.html'),
        clientes: resolve(__dirname, 'clientes.html'),
        viajes: resolve(__dirname, 'viajes.html'),
        admin_conductores: resolve(__dirname, 'admin-conductores.html'),
        admin_pagos: resolve(__dirname, 'admin-pagos.html'),
        admin_comunicaciones: resolve(__dirname, 'admin-comunicaciones.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        track: resolve(__dirname, 'track.html'),
        panel: resolve(__dirname, 'panel.html'),
        agendar: resolve(__dirname, 'agendar.html'),
      },
    },
  },
});
