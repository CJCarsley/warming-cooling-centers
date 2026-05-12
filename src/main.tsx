import { StrictMode, Suspense } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
// ArcGIS light theme (must precede App.css so our overrides apply)
import '@arcgis/core/assets/esri/themes/light/main.css';
// i18next initialization — side effect must run before any component renders
import './i18n';
import { Amplify } from 'aws-amplify';
import esriConfig from '@arcgis/core/config';
import outputs from '../amplify_outputs.json';
import App from './App';
import { getPublicArcGISToken } from './utils/arcgisToken';

Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

// Inject our proxy token for every ArcGIS JS API request to our org's services.
// The before() handler is async — getPublicArcGISToken() serves from cache after
// the first call so there is no per-request network overhead.
esriConfig.request.interceptors ??= [];
esriConfig.request.interceptors.push({
  urls: 'https://services.arcgis.com/pDAi2YK0L0QxVJHj/',
  before: async (params) => {
    const token = await getPublicArcGISToken();
    params.requestOptions ??= {};
    params.requestOptions.query = {
      ...(params.requestOptions.query as Record<string, unknown> ?? {}),
      token,
    };
  },
});

if (import.meta.env.DEV) {
  void import('@axe-core/react').then(({ default: axe }) => {
    void axe(React, ReactDOM, 1000);
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
);
