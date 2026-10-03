import { useSyncExternalStore } from 'react';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export interface PwaState {
  offline: 'checking' | 'preparing' | 'ready' | 'unavailable';
  online: boolean;
  update: boolean;
  version: string | null;
  error: string | null;
  installAvailable: boolean;
  installed: boolean;
}

let state: PwaState = {
  offline: import.meta.env.PROD && 'serviceWorker' in navigator ? 'checking' : 'unavailable',
  online: navigator.onLine,
  update: false,
  version: null,
  error: null,
  installAvailable: false,
  installed: window.matchMedia?.('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | null = null;
let installPrompt: InstallPrompt | null = null;
let workerUrl = '';

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function usePwaState() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state);
}

window.addEventListener('online', () => setState({ online: true }));
window.addEventListener('offline', () => setState({ online: false }));
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event as InstallPrompt;
  setState({ installAvailable: true });
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  setState({ installed: true, installAvailable: false });
});

export function verifyOffline(worker: ServiceWorker): Promise<{ ready: boolean; version: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Offline readiness could not be verified.'));
    }, 5000);
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== 'OFFLINE_STATUS' || typeof data.ready !== 'boolean' || typeof data.version !== 'string') return;
      finish();
      resolve({ ready: data.ready, version: data.version });
    };
    try {
      worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

async function refreshReadiness() {
  if (!registration) return;
  setState({ update: !!registration.waiting });
  if (!registration.active) return;
  try {
    const result = await verifyOffline(registration.active);
    setState({
      offline: result.ready ? 'ready' : 'unavailable',
      version: result.version,
      error: result.ready ? null : 'Offline files are incomplete. Keep an internet connection for browsing.',
    });
  } catch {
    setState({ offline: 'unavailable', error: 'Offline readiness could not be verified. Browsing online still works.' });
  }
}

export async function startPwa(url: string) {
  workerUrl = url;
  if (!('serviceWorker' in navigator)) return;
  setState({ offline: 'checking', error: null });
  try {
    registration = await navigator.serviceWorker.register(url, { updateViaCache: 'none' });
    const watch = () => {
      const worker = registration?.installing;
      if (!worker) return;
      if (state.offline !== 'ready') setState({ offline: 'preparing' });
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'installed') void refreshReadiness();
        if (worker.state === 'redundant') {
          setState({ offline: state.offline === 'ready' ? 'ready' : 'unavailable', error: 'The new offline version could not be stored. Try again online.' });
        }
      });
    };
    registration.addEventListener('updatefound', watch);
    navigator.serviceWorker.addEventListener('controllerchange', () => { void refreshReadiness(); });
    watch();
    await refreshReadiness();
  } catch {
    setState({ offline: 'unavailable', error: 'Offline storage could not start. Browsing online still works.' });
  }
}

export async function checkPwa() {
  if (!registration) {
    if (workerUrl) await startPwa(workerUrl);
    return;
  }
  setState({ error: null });
  try {
    await registration.update();
    await refreshReadiness();
  } catch {
    setState({ error: 'Could not check for updates. Connect to the internet and try again.' });
  }
}

export async function installPwa() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = null;
  setState({ installAvailable: false });
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    setState({ error: 'Installation did not open. Try your browser’s install menu.' });
  }
}
