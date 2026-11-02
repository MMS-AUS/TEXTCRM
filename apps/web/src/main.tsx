import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { parseWebEnv } from './lib/env.ts';
import { createFirebaseAuth } from './lib/firebase.ts';
import { createApiClient } from './lib/trpc.ts';
import { ConfigErrorPage } from './pages/ConfigErrorPage.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing from index.html');
const root = createRoot(rootElement);

const config = parseWebEnv(import.meta.env);

// /design is a static component gallery: no data, so it needs no sign-in or Firebase config.
// It moves into the router with the app shell (Step 1.3).
// Loaded as a separate chunk, so the gallery adds nothing to the app bundle.
if (window.location.pathname.replace(/\/+$/, '') === '/design') {
  void import('./pages/design/DesignPage.tsx').then(({ DesignPage }) => {
    root.render(
      <StrictMode>
        <DesignPage />
      </StrictMode>,
    );
  });
} else if (!config.ok) {
  root.render(
    <StrictMode>
      <ConfigErrorPage missing={config.missing} />
    </StrictMode>,
  );
} else {
  const firebaseAuth = createFirebaseAuth(config.env);
  const apiClient = createApiClient(
    async () => (await firebaseAuth.currentUser?.getIdToken()) ?? null,
  );
  root.render(
    <StrictMode>
      <App
        firebaseAuth={firebaseAuth}
        apiClient={apiClient}
        allowedDomain={config.env.VITE_ALLOWED_EMAIL_DOMAIN}
      />
    </StrictMode>,
  );
}
