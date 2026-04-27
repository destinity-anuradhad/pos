import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.destinityinspire.pos',
  appName: 'Destinity Inspire POS',
  webDir: 'frontend/dist/frontend/browser',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#094f70',
      showSpinner: false
    }
  }
};

export default config;
