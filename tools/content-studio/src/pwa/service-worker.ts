export interface ServiceWorkerState {
  supported: boolean;
  updateAvailable: boolean;
  registration: ServiceWorkerRegistration | null;
}

export async function registerStudioServiceWorker(onUpdate: (registration: ServiceWorkerRegistration) => void): Promise<ServiceWorkerState> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) {
    return { supported: 'serviceWorker' in navigator, updateAvailable: false, registration: null };
  }
  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  const reportWaiting = () => {
    if (registration.waiting) onUpdate(registration);
  };
  reportWaiting();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && navigator.serviceWorker.controller) onUpdate(registration);
    });
  });
  return { supported: true, updateAvailable: Boolean(registration.waiting), registration };
}

export function applyServiceWorkerUpdate(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export function listenForServiceWorkerActivation(reload: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => undefined;
  let reloading = false;
  let wasControlled = Boolean(navigator.serviceWorker.controller);
  const listener = () => {
    // The first controller is the initial install, not an application update.
    // Reloading here can interrupt an image selection made during installation.
    if (!wasControlled) {
      wasControlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', listener);
  return () => navigator.serviceWorker.removeEventListener('controllerchange', listener);
}
