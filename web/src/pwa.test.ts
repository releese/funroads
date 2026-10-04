import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import { verifyOffline } from './pwa';

afterEach(() => { vi.unstubAllGlobals(); });

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

it('preserves a waiting update without forcing activation', async () => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const active = { postMessage: (_message: unknown, ports: MessagePort[]) => {
    ports[0].postMessage({ type: 'OFFLINE_STATUS', country: 'nl', ready: true, version: 'old-complete-build' });
  } };
  const waiting = { postMessage: vi.fn() };
  const registration = { active, waiting, installing: null, addEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: { register, addEventListener: vi.fn() } });
  const { startPwa, checkPwa } = await import('./pwa');
  await startPwa('/funroads/sw.js');
  await checkPwa();
  expect(register).toHaveBeenCalledWith('/funroads/sw.js', { updateViaCache: 'none' });
  expect(registration.update).toHaveBeenCalledOnce();
  expect(waiting.postMessage).not.toHaveBeenCalled();
});

it.each(['nl', undefined])('does not accept Estonia readiness from a worker reporting country %s', async (country) => {
  vi.stubGlobal('MessageChannel', NodeMessageChannel);
  const worker = { postMessage: (_message: unknown, ports: MessagePort[]) => {
    ports[0].postMessage({ type: 'OFFLINE_STATUS', country, ready: true, version: 'other-country-build' });
  } } as unknown as ServiceWorker;
  await expect(verifyOffline(worker, 'ee')).resolves.toEqual({ ready: false, version: 'other-country-build' });
});
