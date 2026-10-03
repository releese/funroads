import { forwardRef } from 'react';
import { Button, KIND as BKIND, SHAPE, SIZE } from 'baseui/button';
import type { Home, LinkedProfile } from '../data/raw';
import { DIMENSIONS } from '../data/raw';
import type { RouteView } from '../data/model';
import { KIND_SHAPE, similarRoutes, stopPin } from '../data/model';
import { formatDate, km, pct } from '../data/format';
import { Disclosure, KindLabel, Meter, Notice, RouteStats, SectionTitle, StatIcon } from './ui';
import { ProfileChart, limitMix } from './ProfileChart';
import { tokens } from '../theme';

interface Props {
  route: RouteView;
  home: Home;
  /** All loaded routes, for the similar-routes rail. */
  allRoutes: RouteView[];
  /** Snapshot date of the catalogue this route came from. */
  generated?: string;
  excludedReasons: string[];
  favorite: boolean;
  onClose: () => void;
  onOpen: (r: RouteView, el: HTMLElement | null) => void;
  onToggleFavorite: (key: string) => void;
  onCursorKm: (km: number | null) => void;
}

const DIM_LABEL: Record<(typeof DIMENSIONS)[number], string> = {
  corners: 'Corners',
  flow: 'Flow',
  quiet: 'Quiet (modelled)',
  speed: 'Speed fit',
  elevation: 'Elevation',
  surface: 'Surface',
  scenery: 'Scenery',
};

const FLAG_LABEL: Record<string, string> = {
  far_from_home: 'More than 60 min modeled drive from Zaandam',
  out_and_back: 'Return leg mostly retraces the outbound leg',
  length_outside_ideal: 'Length is outside the ideal 40–120 km',
  home_unreachable: 'No modeled drive from Zaandam',
};

const PROFILE_NAME: Record<LinkedProfile, string> = { scenic: 'scenic', technical: 'technical', quiet: 'quiet' };

export function groupStops<T extends { note: string }>(stops: T[]): [string, number, T][] {
  const m = new Map<string, [number, T]>();
  for (const s of stops) m.set(s.note, [(m.get(s.note)?.[0] ?? 0) + 1, m.get(s.note)?.[1] ?? s]);
  return [...m.entries()].map(([note, [n, first]]) => [note, n, first]);
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: `1px solid ${tokens.surfacePressed}`, fontSize: 14 }}>
      <dt style={{ color: tokens.hairlineMid, minWidth: 0, flex: 1 }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right', fontWeight: 500, maxWidth: '48%', flexShrink: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  );
}

export const RouteDetail = forwardRef<HTMLHeadingElement, Props>(function RouteDetail(
  { route: r, home, allRoutes, generated, excludedReasons, favorite, onClose, onOpen, onToggleFavorite, onCursorKm },
  headingRef,
) {
  const dist = r.distanceKm?.[home];
  const gmaps = r.gmaps;
  const c = r.circuit;
  const detail = r.profile;
  const mix = limitMix(detail);
  const similar = similarRoutes(r, allRoutes);
  const badges = [
    ...r.profileLists.map((p) => `Top 12 ${PROFILE_NAME[p]} linked ride nationally`),
    ...(r.nearbyLists[home] ?? []).map((p) => `Top 12 ${PROFILE_NAME[p]} within 100 km of ${home}`),
  ];

  return (
    <article aria-labelledby="detail-heading" className="fr-detail">
      <header className="fr-detail-actions">
        <KindLabel kind={r.kind} color={r.color} />
        <Button
          kind={BKIND.secondary}
          shape={SHAPE.square}
          size={SIZE.compact}
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => onToggleFavorite(r.key)}
          overrides={{ BaseButton: { style: { minHeight: '44px', minWidth: '44px' } } }}
        >
          <StatIcon name="favorite" size={20} filled={favorite} />
        </Button>
        <Button kind={BKIND.secondary} shape={SHAPE.square} size={SIZE.compact} onClick={onClose} aria-label="Close details" title="Close details" overrides={{ BaseButton: { style: { minHeight: '44px', minWidth: '44px' } } }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </Button>
      </header>

      <div className="fr-detail-content fr-scroll" key={r.key}>
      <h2
        id="detail-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ fontSize: 24, lineHeight: '32px', fontWeight: 700, margin: '0 0 4px', overflowWrap: 'anywhere' }}
      >
        {r.name}
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: tokens.hairlineMid }}>
        {KIND_SHAPE[r.kind]}
        {c ? ` · ${c.areaName}` : ''}
      </p>
      <dl style={{ margin: '16px 0 0' }}>
        <Row label={<span className="fr-route-stat"><StatIcon name="home" />Straight-line from {home}</span>}>{dist != null ? `${dist} km` : 'Distance unknown'}</Row>
        <Row label={<span className="fr-route-stat"><StatIcon name="route" />Length</span>}>{km(r.km)}</Row>
        <Row label={<span className="fr-route-stat"><StatIcon name="clock" />Estimated drive time</span>}>{r.driveMin != null ? `~${r.driveMin} min` : 'Unknown'}</Row>
        <Row label={<span className="fr-route-stat"><StatIcon name="score" />{r.funScoreBasis === 'route-total' ? 'Fun score' : 'Road fun (average)'}</span>}>{Math.round(r.funScore)} / 100</Row>
      </dl>
      {detail.why[0] ? <p style={{ fontSize: 16, lineHeight: '24px' }}>{detail.why[0]}</p> : null}
      {detail.stops.length || c?.flags.length ? (
        <>
          <SectionTitle>Heads-up along the route</SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: '20px' }}>
            {groupStops(detail.stops).map(([note, count, first]) => (
              <li key={note}>{note} ({count > 1 ? `${count} places` : '1 place'}, “{stopPin(first.type)}” pin on the map)</li>
            ))}
            {c?.flags.map((flag) => <li key={flag}>{FLAG_LABEL[flag] ?? flag}</li>)}
          </ul>
        </>
      ) : null}
      {excludedReasons.length ? (
        <div style={{ margin: '16px 0' }}>
          <Notice tone="warning">
            <strong>This route no longer matches your filters.</strong> {excludedReasons.join('. ')}.{' '}
            It stays open here so you can finish reading; go back to see current results.
          </Notice>
        </div>
      ) : null}

      {detail.why.length || r.traits.length || badges.length ? (
        <Disclosure title="Why this route">
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 16, lineHeight: '24px' }}>
            {detail.why.map((w) => <li key={w}>{w}</li>)}
            {r.traits.length ? <li>Traits: {r.traits.join(', ')}</li> : null}
            {badges.map((badge) => <li key={badge}>{badge}</li>)}
          </ul>
        </Disclosure>
      ) : null}

      {detail.elev.length || detail.curv.length ? (
        <Disclosure title="Elevation and curvature">
          <ProfileChart circuit={detail} totalKm={r.km} onCursorKm={onCursorKm} />
        </Disclosure>
      ) : null}

      {r.roads.length || r.sharesWith.length || mix.length ? (
        <Disclosure title="Roads and route composition">
          {r.anchorRoads.length ? (
            <p style={{ fontSize: 14, lineHeight: '20px', margin: '0 0 8px' }}>
              High-fun stretches in driving order: {r.anchorRoads.join(' → ')}. Each was checked in this direction
              only, so none is a reversible sprint. Other listed roads may connect or return between them.
            </p>
          ) : null}
          {r.sharesWith.length ? (
            <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: '20px', color: tokens.hairlineMid }}>
              Runs along {r.sharesWith.map((overlap) => `${overlap.name} (${Math.round(overlap.share * 100)}% of its line)`).join(' and ')}.
              {' '}Shared circuits are drawn faintly underneath this route on the map.
            </p>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {r.roads.map((road) => (
              <li key={road.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, borderBottom: `1px solid ${tokens.surfacePressed}` }}>
                <span>{road.name}</span>
                <span style={{ color: tokens.hairlineMid }}>
                  {km(road.km)} · fun {road.fun}
                </span>
              </li>
            ))}
          </ul>
          {mix.length ? (
            <>
              <p className="fr-route-stat" style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 500 }}><StatIcon name="limit" />Posted limits</p>
              <ul style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))', gap: 8, listStyle: 'none', padding: 0, margin: 0 }}>
                {mix.map((limit) => (
                  <li key={limit.lim} style={{ display: 'grid', gap: 4, padding: 8, borderRadius: 8, backgroundColor: tokens.canvasSofter }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{limit.lim} km/h</span>
                    <span style={{ fontSize: 12, color: tokens.hairlineMid }}>{pct(limit.share)} of route</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Disclosure>
      ) : null}

      <Disclosure title="Score breakdown (0–100)">
        <div style={{ display: 'grid', gap: 6 }}>
          {DIMENSIONS.map((dimension) => <Meter key={dimension} label={DIM_LABEL[dimension]} value={r.dims[dimension]} />)}
        </div>
      </Disclosure>

      <Disclosure title="Route facts and sources">
        <dl style={{ margin: 0 }}>
          <Row label="Fun kilometres">{km(r.funKm)}</Row>
          {r.connectorShare != null ? <Row label="Lower-scored connector roads">{pct(r.connectorShare)} of distance</Row> : null}
          {r.retraceShare != null ? <Row label="Driven twice, once each way">{r.retraceShare < 0.01 ? 'None' : `${pct(r.retraceShare)} of distance`}</Row> : null}
          {c ? <Row label="Modeled reach from Zaandam">{c.reachMinFromZaandam != null ? `~${c.reachMinFromZaandam} min` : 'Unknown'}</Row> : null}
          {detail.climbM != null ? <Row label="Climb">+{detail.climbM} m</Row> : null}
          {detail.cornerCount ? <Row label="Corners">{detail.cornerCount.tight} tight · {detail.cornerCount.sweet} sweet-spot · {detail.cornerCount.flowing} flowing</Row> : null}
          {r.clusterId != null ? <Row label="Local cluster">#{r.clusterId} (unnamed)</Row> : null}
          <Row label="Road data snapshot">{formatDate(generated)}</Row>
        </dl>
      </Disclosure>

      <Disclosure title="Before you drive">
        <p style={{ margin: 0, fontSize: 14, lineHeight: '20px' }}>
          Check current signs and restrictions. Access is based on sampled data, not live permission. Navigation may reroute.
        </p>
        {r.kind === 'sprint' ? (
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px' }}>
            Turn around only where safe and legal. The route endpoint is not a verified turning place.
          </p>
        ) : null}
        {r.kind === 'linked-open' ? (
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px' }}>
            Only this direction was checked. Plan your own legal return.
          </p>
        ) : null}
        <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: '20px' }}>
          Start and end are road-network points, not verified parking or meeting places.
        </p>
      </Disclosure>

      {similar.length ? (
        <Disclosure title="Similar routes">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {similar.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="fr-similar-route"
                  onClick={(e) => onOpen(s, e.currentTarget)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    font: 'inherit',
                    color: tokens.ink,
                    backgroundColor: tokens.canvas,
                    border: `1px solid ${tokens.surfacePressed}`,
                    borderRadius: tokens.radiusCard,
                    padding: tokens.space.md,
                    cursor: 'pointer',
                    minHeight: '44px',
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <KindLabel kind={s.kind} color={s.color} />
                    <span className="fr-route-stat" style={{ fontSize: 14, fontWeight: 500 }}>
                      <StatIcon name="score" />
                      {Math.round(s.funScore)}
                      <span style={{ color: tokens.hairlineMid, fontWeight: 400 }}>/100</span>
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 16, lineHeight: '22px', fontWeight: 500, margin: '4px 0 2px', overflowWrap: 'anywhere' }}>{s.name}</span>
                  <RouteStats route={s} home={home} />
                </button>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      </div>
      {gmaps ? <footer className="fr-detail-navigation">
        <Button $as="a" href={gmaps} target="_blank" rel="noopener noreferrer" aria-label="Open in Google Maps" title="Open in Google Maps" kind={BKIND.secondary} shape={SHAPE.default} size={SIZE.compact}
          overrides={{ BaseButton: { style: { minHeight: '44px', gap: '8px', width: '100%' } } }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M21 3L3 10l7 3 3 7 8-17zM10 13L21 3" /></svg>
          Navigate
        </Button>
      </footer> : null}
    </article>
  );
});
