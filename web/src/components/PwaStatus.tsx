import { Button, KIND, SHAPE, SIZE } from 'baseui/button';
import { checkPwa, installPwa, usePwaState } from '../pwa';
import { Notice } from './ui';
import { DEFAULT_COUNTRY, type Country } from '../data/countries';

export function PwaStatus({ engaged, country = DEFAULT_COUNTRY }: { engaged: boolean; country?: Country }) {
  const pwa = usePwaState();
  const ready = pwa.offline === 'ready' && pwa.country === country.id;
  return (
    <section aria-label="App and offline status" style={{ marginBottom: 24 }}>
      <Notice>
        <div role="status">
          <strong>{ready ? `${country.name} routes available offline`
            : pwa.offline === 'preparing' ? 'Preparing offline route data…'
            : pwa.offline === 'checking' ? 'Checking offline availability…'
            : 'Offline availability not confirmed'}</strong>
          <p style={{ margin: '8px 0 0' }}>
            {pwa.online ? 'Internet connection detected.' : 'You are offline.'} The external basemap is not included in offline storage.
            {ready ? ' Cached route details and the results list remain usable without map tiles.' : ''}
          </p>
          {!import.meta.env.PROD ? <p>Offline storage is disabled in this development preview.</p> : null}
          {pwa.updating ? <p><strong>Applying verified update…</strong> FunRoads will reopen automatically. Your browsing choices are preserved when browser storage is available.</p>
            : pwa.update ? <p><strong>Update available.</strong> Refresh or reopen FunRoads to apply it, or use the check button below.</p> : null}
          <p>Updates apply on refresh or open, including reopening the installed app. There is no background polling or automatic mid-session refresh. Offline apps keep their last complete version and check again on their next connected open.</p>
          {pwa.error ? <p>{pwa.error}</p> : null}
        </div>
        {import.meta.env.PROD && 'serviceWorker' in navigator ? <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
          onClick={() => { void checkPwa(); }} overrides={{ BaseButton: { style: { minHeight: '44px', marginTop: '12px' } } }}>Check for updates</Button> : null}
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
