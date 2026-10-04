import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { verifyOffline } from './pwa';

vi.mock('virtual:funroads-release', () => ({ BUILD_ID: 'current-build', CATALOGUES: {} }));

let stop: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function statusWorker(build = 'current-build', ready = true, version = `${build}-version`) {
  return Object.assign(new EventTarget(), {
    state: 'activated',
    postMessage: vi.fn((message: { type: string; country?: string }, ports?: MessagePort[]) => {
      if (message.type === 'OFFLINE_STATUS') ports![0].postMessage({
        type: 'OFFLINE_STATUS', country: message.country, ready, version, build,
      });
    }),
  }) as unknown as ServiceWorker;
}

async function start(waiting: ServiceWorker | null = null, installed = false) {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const active = statusWorker();
  const serviceWorker = Object.assign(new EventTarget(), { controller: active, register: vi.fn() });
  const registration = Object.assign(new EventTarget(), {
    active, waiting, installing: null as ServiceWorker | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  serviceWorker.register.mockResolvedValue(registration);
  const navigatorMock = { onLine: true, serviceWorker };
  vi.stubGlobal('navigator', navigatorMock);
  const reload = vi.fn();
  vi.stubGlobal('location', { href: location.href, search: location.search, hash: location.hash, reload });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: installed } as MediaQueryList);
  const pwa = await import('./pwa');
  stop = pwa.stopPwa;
  await pwa.startPwa('/funroads/sw.js');
  return { pwa, active, serviceWorker, registration, reload, navigatorMock };
}

it('asks the worker to verify its complete version before claiming offline readiness', async () => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const worker = {
    postMessage: vi.fn((message, ports) => {
      expect(message).toEqual({ type: 'OFFLINE_STATUS', country: 'nl' });
      ports[0].postMessage({ type: 'OFFLINE_STATUS', country: 'nl', ready: true, version: 'complete-build' });
    }),
  } as unknown as ServiceWorker;
  await expect(verifyOffline(worker)).resolves.toEqual({ ready: true, version: 'complete-build' });
});

it('does not claim readiness when the worker reports missing files', async () => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const worker = { postMessage: (_message: unknown, ports: MessagePort[]) => {
    ports[0].postMessage({ type: 'OFFLINE_STATUS', country: 'nl', ready: false, version: 'incomplete-build' });
  } } as unknown as ServiceWorker;
  await expect(verifyOffline(worker)).resolves.toEqual({ ready: false, version: 'incomplete-build' });
});

it('fails cleanly if messaging is unavailable', async () => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const worker = { postMessage: () => { throw new Error('Unavailable'); } } as unknown as ServiceWorker;
  await expect(verifyOffline(worker)).rejects.toThrow('Unavailable');
});

it('automatically checks at startup and activates only a verified waiting release', async () => {
  const waiting = statusWorker('next-build', true, 'next-version');
  const { registration, serviceWorker } = await start(waiting);
  expect(serviceWorker.register).toHaveBeenCalledWith('/funroads/sw.js', { updateViaCache: 'none' });
  expect(registration.update).toHaveBeenCalledOnce();
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE', version: 'next-version' });
});

it('keeps an incomplete waiting release inactive', async () => {
  const waiting = statusWorker('next-build', false);
  await start(waiting);
  expect(vi.mocked(waiting.postMessage).mock.calls.some(([message]) => message.type === 'ACTIVATE_UPDATE')).toBe(false);
});

it('saves browsing state before reloading once when the controller changes', async () => {
  const { pwa, serviceWorker, registration, reload } = await start(statusWorker('next-build'));
  const save = vi.fn(() => expect(reload).not.toHaveBeenCalled());
  window.addEventListener(pwa.BEFORE_UPDATE_EVENT, save, { once: true });
  serviceWorker.controller = statusWorker('next-build');
  registration.waiting = null;
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await pwa.checkPwa();
  expect(reload).toHaveBeenCalledOnce();
});

it('does not reload for first-install activation of the current build', async () => {
  const { serviceWorker, reload, pwa } = await start();
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await pwa.checkPwa();
  expect(reload).not.toHaveBeenCalled();
});

it('waits for a sleeping instance to become visible, then reloads even offline', async () => {
  const { serviceWorker, registration, navigatorMock, reload } = await start(statusWorker('next-build'));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  serviceWorker.controller = statusWorker('next-build');
  registration.waiting = null;
  navigatorMock.onLine = false;
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(serviceWorker.controller.postMessage).toHaveBeenCalled());
  expect(reload).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it('does not poll, check on reconnect or reload an ordinary active tab mid-session', async () => {
  vi.useFakeTimers();
  const { pwa, registration, serviceWorker, reload } = await start();
  registration.update.mockClear();
  await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
  expect(registration.update).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).not.toHaveBeenCalled();
  serviceWorker.controller = statusWorker('next-build');
  serviceWorker.dispatchEvent(new Event('controllerchange'));
  await vi.waitFor(() => expect(serviceWorker.controller.postMessage).toHaveBeenCalled());
  expect(reload).not.toHaveBeenCalled();
  await pwa.checkPwa();
  expect(registration.update).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});

it('checks when a standalone PWA is reopened or a page returns from the back-forward cache', async () => {
  const { registration, pwa } = await start(null, true);
  registration.update.mockClear();
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.waitFor(() => expect(registration.update).toHaveBeenCalledOnce());
  await pwa.checkPwa(); // Finish the coalesced reopen check before another open.
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(2));
});

it('does not treat installation from an ordinary browser tab as a standalone reopen', async () => {
  const { registration, reload } = await start();
  registration.update.mockClear();
  const waiting = statusWorker('next-build');
  registration.waiting = waiting;
  window.dispatchEvent(new Event('appinstalled'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(registration.update).not.toHaveBeenCalled();
  expect(waiting.postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('leaves browser-discovered mid-session updates waiting until the next explicit check', async () => {
  const { registration, reload, pwa } = await start();
  const worker = statusWorker('next-build');
  Object.defineProperty(worker, 'state', { value: 'installing', writable: true });
  registration.installing = worker;
  registration.dispatchEvent(new Event('updatefound'));
  registration.waiting = worker;
  registration.installing = null;
  Object.defineProperty(worker, 'state', { value: 'installed' });
  worker.dispatchEvent(new Event('statechange'));
  await vi.waitFor(() => expect(registration.active.postMessage).toHaveBeenCalled());
  expect(vi.mocked(worker.postMessage).mock.calls.some(([message]) => message.type === 'ACTIVATE_UPDATE')).toBe(false);
  expect(reload).not.toHaveBeenCalled();
  await pwa.checkPwa();
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'ACTIVATE_UPDATE', version: 'next-build-version' });
});

it('coalesces simultaneous update checks', async () => {
  const { pwa, registration } = await start();
  let finish!: () => void;
  registration.update.mockClear().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = pwa.checkPwa();
  const second = pwa.checkPwa();
  expect(registration.update).toHaveBeenCalledOnce();
  finish();
  await Promise.all([first, second]);
});

it('prevents repeated reloads into the same mismatched release', async () => {
  const { serviceWorker, reload, pwa } = await start();
  sessionStorage.setItem('funroads:update-reload:v1', JSON.stringify({ build: 'next-build', at: Date.now() }));
  serviceWorker.controller = statusWorker('next-build');
  await pwa.checkPwa();
  expect(reload).not.toHaveBeenCalled();
});

it('recovers a failed initial registration on the next open', async () => {
  const { pwa, serviceWorker } = await start();
  serviceWorker.register.mockRejectedValueOnce(new Error('Offline'));
  await pwa.startPwa('/funroads/sw.js');
  const attempts = serviceWorker.register.mock.calls.length;
  await pwa.startPwa('/funroads/sw.js');
  expect(serviceWorker.register).toHaveBeenCalledTimes(attempts + 1);
});

it.each(['nl', undefined])('does not accept Estonia readiness from a worker reporting country %s', async (country) => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const worker = { postMessage: (_message: unknown, ports: MessagePort[]) => {
    ports[0].postMessage({ type: 'OFFLINE_STATUS', country, ready: true, version: 'other-country-build' });
  } } as unknown as ServiceWorker;
  await expect(verifyOffline(worker, 'ee')).resolves.toEqual({ ready: false, version: 'other-country-build' });
});
