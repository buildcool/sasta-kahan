import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sastakahan',
  appName: 'SastaKahan',
  webDir: 'dist',
  plugins: {
    // Native HTTP: no CORS, requests go out from the phone like a normal browser.
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#0E7C66' },
    // Watchlist price checks every ~4 hours, even with the app closed (src/runner/background.ts).
    BackgroundRunner: {
      // The runner's CapacitorKV storage is the Android SharedPreferences file with this name.
      // "CapacitorStorage" is the file @capacitor/preferences uses, so the runner reads and
      // updates the same watchlist, settings and cards as the app.
      label: 'CapacitorStorage',
      src: 'runners/background.js',
      event: 'checkWatchlist',
      repeat: true,
      interval: 240,
      autoStart: true,
    },
  },
};

export default config;
