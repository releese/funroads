import { useSyncExternalStore } from 'react';
import { countryFromLocation, type CountryId } from './data/countries';
import { BUILD_ID } from 'virtual:funroads-release';

export const BEFORE_UPDATE_EVENT = 'funroads:before-update';
const RELOAD_KEY = 'funroads:update-reload:v1';

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export interface PwaState {
  offline: 'checking' | 'preparing' | 'ready' | 'unavailable';
  country: CountryId | null;
  online: boolean;
  update: boolean;
  updating: boolean;
  version: string | null;
  error: string | null;
  installAvailable: boolean;
  installed: boolean;
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || !!(navigator as Navigator & { standalone?: boolean }).standalone;
}

let state: PwaState = {
  offline: import.meta.env.PROD && 'serviceWorker' in navigator ? 'checking' : 'unavailable',
  country: null,
  online: navigator.onLine,
  update: false,
  updating: false,
  version: null,
  error: null,
  installAvailable: false,
  installed: isStandalone(),
};
const listeners = new Set<() => void>();
let registration: ServiceWorkerRegistration | null = null;
let installPrompt: InstallPrompt | null = null;
let workerUrl = '';
let lifecycle: AbortController | null = null;
let checking: Promise<void> | null = null;
let reloading = false;
let applyingOnOpen = false;
let pendingBuild: string | null = null;
let requestedWorkers = new WeakSet<ServiceWorker>();

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

export function verifyOffline(worker: ServiceWorker, country: CountryId = 'nl'): Promise<{ ready: boolean; version: string; build?: string }> {
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
      resolve({ ready: data.ready && data.country === country, version: data.version,
        ...(typeof data.build === 'string' ? { build: data.build } : {}) });
    };
    try {
      worker.postMessage({ type: 'OFFLINE_STATUS', country }, [channel.port2]);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}

async function refreshReadiness(apply = false) {
  if (!registration) return;
  setState({ update: !!registration.waiting });
  const controller = navigator.serviceWorker.controller ?? registration.active;
  if (!controller) return;
  try {
    const country = countryFromLocation().id;
    const result = await verifyOffline(controller, country);
    if (controller !== (navigator.serviceWorker.controller ?? registration.active)) return;
    setState({
      offline: result.ready ? 'ready' : 'unavailable',
      country,
      version: result.version,
      error: result.ready ? null : 'Offline files are incomplete. Keep an internet connection for browsing.',
    });
    if (result.ready && result.build && result.build !== BUILD_ID) {
      setState({ update: true });
      if (apply || result.build === pendingBuild) reloadForUpdate(result.build);
    }
    else if (result.ready && result.build === BUILD_ID) {
      controller.postMessage({ type: 'CLIENT_BUILD', build: BUILD_ID });
      pendingBuild = null;
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* Storage is optional. */ }
      setState({ updating: false });
    }
  } catch {
    setState({ offline: 'unavailable', error: 'Offline readiness could not be verified. Browsing online still works.' });
  }
}

function reloadForUpdate(build: string) {
  if (reloading || document.visibilityState === 'hidden') return;
  try {
    const previous = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? 'null');
    if (previous?.build === build && Date.now() - previous.at < 60_000) {
      setState({ updating: false, error: 'The update could not open. Try checking again in a minute.' });
      return;
    }
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ build, at: Date.now() }));
  } catch { /* Verified cached navigation still works without session storage. */ }
  reloading = true;
  setState({ updating: true });
  window.dispatchEvent(new Event(BEFORE_UPDATE_EVENT));
  location.reload();
}

async function activateWaitingUpdate(expected?: ServiceWorker) {
  const waiting = registration?.waiting;
  if (!waiting || reloading || (expected && waiting !== expected)) return;
  try {
    const result = await verifyOffline(waiting, countryFromLocation().id);
    if (registration?.waiting !== waiting) return;
    if (!result.ready || !result.build) {
      setState({ updating: false, error: 'The update is not complete. Your current version is still available.' });
      return;
    }
    setState({ update: true, updating: true });
    pendingBuild = result.build;
    waiting.postMessage({ type: 'ACTIVATE_UPDATE', version: result.version });
  } catch {
    setState({ updating: false, error: 'The update could not be verified. Your current version is still available.' });
  }
}

/** Also used to release listeners during tests or a remounted application. */
export function stopPwa() {
  lifecycle?.abort();
  lifecycle = null;
}

export async function startPwa(url: string) {
  workerUrl = url;
  if (!('serviceWorker' in navigator)) return;
  stopPwa();
  lifecycle = new AbortController();
  const { signal } = lifecycle;
  registration = null;
  applyingOnOpen = true;
  requestedWorkers = new WeakSet();
  setState({ offline: 'checking', error: null });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void checkPwa();
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return;
    // Standalone apps may reopen without a new page load. Ordinary tab switches
    // do not check or apply releases in the middle of a browsing session.
    if (isStandalone()) void checkPwa();
    else if (pendingBuild) void refreshReadiness();
  }, { signal });
  try {
    registration = await navigator.serviceWorker.register(url, { updateViaCache: 'none' });
    const watch = () => {
      const worker = registration?.installing;
      if (!worker) return;
      if (applyingOnOpen) requestedWorkers.add(worker);
      if (state.offline !== 'ready') setState({ offline: 'preparing' });
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'installed') {
          void refreshReadiness(requestedWorkers.has(worker)).then(() => {
            if (requestedWorkers.has(worker)) void activateWaitingUpdate(worker);
          });
        }
        if (worker.state === 'redundant') {
          setState({ offline: state.offline === 'ready' ? 'ready' : 'unavailable', updating: false, error: 'The new offline version could not be stored. Try again online.' });
          applyingOnOpen = false;
        }
      }, { signal });
    };
    registration.addEventListener('updatefound', watch, { signal });
    navigator.serviceWorker.addEventListener('controllerchange', () => { void refreshReadiness(applyingOnOpen); }, { signal });
    watch();
    await refreshReadiness(true);
    await activateWaitingUpdate();
    if (navigator.onLine && document.visibilityState !== 'hidden') await checkPwa();
    applyingOnOpen = false;
  } catch {
    applyingOnOpen = false;
    setState({ offline: 'unavailable', error: 'Offline storage could not start. Browsing online still works.' });
  }
}

export async function checkPwa() {
  if (!registration) {
    if (workerUrl) await startPwa(workerUrl);
    return;
  }
  if (checking) return checking;
  applyingOnOpen = true;
  if (registration.installing) requestedWorkers.add(registration.installing);
  setState({ error: null });
  checking = (async () => {
    try {
      await registration!.update();
      await refreshReadiness(true);
      await activateWaitingUpdate();
    } catch {
      setState({ error: 'Could not check for updates. Connect to the internet and try again.' });
    }
  })();
  try { await checking; } finally {
    checking = null;
    applyingOnOpen = false;
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
