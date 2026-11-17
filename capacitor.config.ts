import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pokerogue.portrait',
  appName: 'PokéRogue Portrait',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  plugins: {
    ScreenOrientation: {
      orientation: 'portrait',
    },
  },
};

export default config;
