import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sastakahan',
  appName: 'SastaKahan',
  webDir: 'dist',
  plugins: {
    // Native HTTP: no CORS, requests go out from the phone like a normal browser.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#0E7C66' },
  },
};

export default config;
