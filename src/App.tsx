import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentDir } from './hooks/useDocumentDir';
import SkipLink from './components/Layout/SkipLink';
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import MapViewComponent from './components/Map/MapView';
import './App.css';

const LoginPage = lazy(() => import('./pages/admin/LoginPage'));
const FacilityListPage = lazy(() => import('./pages/FacilityListPage'));
const AccessibilityStatement = lazy(() => import('./pages/AccessibilityStatement'));

function LoadingSpinner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '300px',
        fontSize: '1rem',
        color: 'var(--color-text-secondary)',
      }}
      role="status"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}

function AppShell() {
  const { i18n } = useTranslation();
  useDocumentDir(i18n.language);

  return (
    <>
      <SkipLink />
      <Header />
      <main id="main-content" tabIndex={-1}>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route path="/" element={<MapViewComponent />} />
            <Route path="/list" element={<FacilityListPage />} />
            <Route path="/accessibility" element={<AccessibilityStatement />} />
            <Route path="/admin/*" element={<LoginPage />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
