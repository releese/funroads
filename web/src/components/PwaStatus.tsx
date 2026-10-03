import { Button, KIND, SHAPE, SIZE } from 'baseui/button';
import { checkPwa, installPwa, usePwaState } from '../pwa';
import { Notice } from './ui';

export function PwaStatus({ engaged }: { engaged: boolean }) {
  const pwa = usePwaState();
  return (
    <section aria-label="App and offline status" style={{ marginBottom: 24 }}>
      <Notice>
        <div role="status">
          <strong>{pwa.offline === 'ready' ? 'Routes available offline'
            : pwa.offline === 'preparing' ? 'Preparing offline route data…'
            : pwa.offline === 'checking' ? 'Checking offline availability…'
            : 'Offline availability not confirmed'}</strong>
          <p style={{ margin: '8px 0 0' }}>
            {pwa.online ? 'Internet connection detected.' : 'You are offline.'} The external basemap is not included in offline storage.
            {pwa.offline === 'ready' ? ' Cached route details and the results list remain usable without map tiles.' : ''}
          </p>
          {!import.meta.env.PROD ? <p>Offline storage is disabled in this development preview.</p> : null}
          {pwa.update ? <p><strong>Update available.</strong> Close all FunRoads browser tabs and installed app windows, then reopen to use it. Your current version stays together; reloading alone may not activate the update.</p> : null}
          {pwa.error ? <p>{pwa.error}</p> : null}
        </div>
        {import.meta.env.PROD && 'serviceWorker' in navigator ? <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
          onClick={() => { void checkPwa(); }} overrides={{ BaseButton: { style: { minHeight: '44px', marginTop: '12px' } } }}>Check offline data and updates</Button> : null}
      </Notice>
      {!pwa.installed ? (
        <div style={{ fontSize: 14, lineHeight: '20px', marginTop: 12 }}>
          {pwa.installAvailable && engaged ? <Button shape={SHAPE.default} onClick={() => { void installPwa(); }}
            overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Install FunRoads</Button> : null}
          <p>To keep FunRoads on your home screen, use your browser’s install menu. On iPhone or iPad, use Share → Add to Home Screen. Installation does not download an offline basemap.</p>
        </div>
      ) : null}
      {pwa.version ? <p style={{ fontSize: 12, color: '#4b4b4b' }}>Verified offline app version: {pwa.version}. Road snapshot dates are listed below.</p> : null}
    </section>
  );
}
