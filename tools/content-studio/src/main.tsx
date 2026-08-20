import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { listenForServiceWorkerActivation, registerStudioServiceWorker } from './pwa/service-worker';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

void registerStudioServiceWorker((registration) => {
  window.dispatchEvent(new CustomEvent('content-studio-update', { detail: registration }));
}).catch(() => undefined);

listenForServiceWorkerActivation(() => window.location.reload());
