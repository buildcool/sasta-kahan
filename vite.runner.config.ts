import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds src/runner/background.ts into one plain script for Capacitor Background Runner
// (dist/runners/background.js, loaded by capacitor.config.ts → plugins.BackgroundRunner.src).
export default defineConfig({
  resolve: { alias: { '@acemir/cssom': fileURLToPath(new URL('./src/runner/cssom-stub.ts', import.meta.url)) } },
  build: {
    outDir: 'dist/runners',
    emptyOutDir: false,
    target: 'es2020',
    minify: true,
    lib: { entry: 'src/runner/background.ts', formats: ['iife'], name: 'SastaKahanRunner', fileName: () => 'background.js' },
  },
});
