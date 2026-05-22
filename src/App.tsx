import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef } from 'react';
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
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const initialMount = useRef(true);

  // Move focus to the main landmark on route change so AT announces the new
  // page and keyboard users don't get stranded on the previous nav link.
  // Skip the very first render so we don't steal focus on page load.
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [location.pathname]);

  return (
    <>
      <SkipLink />
      <Header />
      <main id="main-content" ref={mainRef} tabIndex={-1}>
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
