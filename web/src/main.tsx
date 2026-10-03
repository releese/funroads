import React from 'react';
import { createRoot } from 'react-dom/client';
import { Client as Styletron } from 'styletron-engine-monolithic';
import { Provider as StyletronProvider } from 'styletron-react';
import { BaseProvider } from 'baseui';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/700.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'uplot/dist/uPlot.min.css';
import './global.css';
import { theme } from './theme';
import { App } from './components/App';

const engine = new Styletron();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
      .catch(() => { /* Browsing still works when offline storage is unavailable. */ });
  });
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" style={{ padding: 32, fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 560 }}>
        <h1 style={{ fontSize: 24 }}>FunRoads could not display this view</h1>
        <p>Something went wrong while drawing the page. Reload to try again; the route data on disk is unchanged.</p>
        <button type="button" onClick={() => location.reload()} style={{ minHeight: 44, padding: '0 20px', borderRadius: 999, border: 0, background: '#000', color: '#fff', font: 'inherit' }}>
          Reload
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StyletronProvider value={engine}>
      <BaseProvider theme={theme}>
        <ErrorBoundary>
          <App dataBase={import.meta.env.BASE_URL} />
        </ErrorBoundary>
      </BaseProvider>
    </StyletronProvider>
  </React.StrictMode>,
);
