import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          pkmn: ['@pkmn/sim', '@pkmn/dex', '@pkmn/protocol', '@pkmn/randoms', '@pkmn/sets', '@pkmn/img'],
        },
      },
    },
  },
});
