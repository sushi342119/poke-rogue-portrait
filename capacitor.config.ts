import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pokerogue.portrait',
  appName: 'PokéRogue',
  webDir: 'dist',
  backgroundColor: '#0d131a',
  zoomEnabled: false,
  server: {
    androidScheme: 'https',
  },
};

export default config;
