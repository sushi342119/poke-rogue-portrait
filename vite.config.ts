import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/showdown-cdn': {
        target: 'https://play.pokemonshowdown.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/showdown-cdn/, ''),
      },
    },
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
