import { StrictMode, Suspense } from 'react';
import React from 'react';
import ReactDOM from 'react-dom/client';
// ArcGIS light theme (must precede App.css so our overrides apply)
import '@arcgis/core/assets/esri/themes/light/main.css';
// i18next initialization — side effect must run before any component renders
import './i18n';
import { Amplify } from 'aws-amplify';
import outputs from '../amplify_outputs.json';
import App from './App';

Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

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
