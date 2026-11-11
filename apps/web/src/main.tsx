import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createAppRouter } from './app/router.tsx';
import { parseWebEnv } from './lib/env.ts';
import { createFirebaseAuth } from './lib/firebase.ts';
import { createApiClient } from './lib/trpc.ts';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing from index.html');

const config = parseWebEnv(import.meta.env);

function createServices() {
  if (!config.ok) return null;
  const firebaseAuth = createFirebaseAuth(config.env);
  const apiClient = createApiClient(
    async () => (await firebaseAuth.currentUser?.getIdToken()) ?? null,
    undefined,
    config.env.VITE_API_URL,
  );
  return { firebaseAuth, apiClient, allowedDomain: config.env.VITE_ALLOWED_EMAIL_DOMAIN };
}

const router = createAppRouter({
  services: createServices(),
  missingConfig: config.ok ? [] : config.missing,
});

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
