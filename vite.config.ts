import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/@arcgis/core')) return 'arcgis-core';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/')
          )
            return 'react-vendor';
          if (
            id.includes('node_modules/i18next') ||
            id.includes('node_modules/react-i18next')
          )
            return 'i18n';
        },
      },
    },
    chunkSizeWarningLimit: 5000,
  },
});
