import { forwardRef } from 'react';
import { Button, KIND as BKIND, SHAPE, SIZE } from 'baseui/button';
import type { Home, LinkedProfile } from '../data/raw';
import { DIMENSIONS } from '../data/raw';
import type { RouteView } from '../data/model';
import { COMPACT_WAYPOINTS, KIND_SHAPE, similarRoutes, stopPin } from '../data/model';
import { formatDate, formatWindow, km, pct } from '../data/format';
import { KindLabel, Meter, Notice, SAFETY_NOTE, SectionTitle, SoftCard } from './ui';
import { ProfileChart, limitMix } from './ProfileChart';
import { tokens } from '../theme';

interface Props {
  route: RouteView;
  home: Home;
  allWindows: string[];
  /** All loaded routes, for the similar-routes rail. */
  allRoutes: RouteView[];
  /** Snapshot date of the catalogue this route came from. */
  generated?: string;
  excludedReasons: string[];
  backLabel: string;
  favorite: boolean;
  /**
   * Phones: Google documents only COMPACT_WAYPOINTS waypoints for mobile
   * browsers, but the Maps app may take the full link, so offer both.
   */
  offerCompactLink: boolean;
  onBack: () => void;
  onOpen: (r: RouteView, el: HTMLElement | null) => void;
  onToggleFavorite: (key: string) => void;
  onShowOnMap?: () => void;
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: `1px solid ${tokens.surfacePressed}`, fontSize: 14 }}>
      <dt style={{ color: tokens.hairlineMid }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: 'right', fontWeight: 500 }}>{children}</dd>
    </div>
  );
}

export const RouteDetail = forwardRef<HTMLHeadingElement, Props>(function RouteDetail(
  { route: r, home, allWindows, allRoutes, generated, excludedReasons, backLabel, favorite, offerCompactLink, onBack, onOpen, onToggleFavorite, onShowOnMap, onCursorKm },
  headingRef,
) {
  const dist = r.distanceKm?.[home];
  const gmaps = r.gmaps;
  const compact = offerCompactLink && r.gmapsCompact && r.gmapsCompact !== gmaps ? r.gmapsCompact : null;
  const closes = r.kind === 'circuit' || r.kind === 'linked-loop';
  const c = r.circuit;
  const detail = r.profile;
  const mix = limitMix(detail);
  const similar = similarRoutes(r, allRoutes);
  const badges = [
    ...r.profileLists.map((p) => `Top 12 ${PROFILE_NAME[p]} linked ride nationally`),
    ...(r.nearbyLists[home] ?? []).map((p) => `Top 12 ${PROFILE_NAME[p]} within 100 km of ${home}`),
  ];

  return (
    <article aria-labelledby="detail-heading" style={{ paddingBottom: 32 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Button kind={BKIND.secondary} shape={SHAPE.pill} size={SIZE.compact} onClick={onBack} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
          <span aria-hidden="true">←&nbsp;</span>
          {backLabel}
        </Button>
        {onShowOnMap ? (
          <Button kind={BKIND.secondary} shape={SHAPE.pill} size={SIZE.compact} onClick={onShowOnMap} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
            Show on map
          </Button>
        ) : null}
        <Button
          kind={BKIND.secondary}
          shape={SHAPE.pill}
          size={SIZE.compact}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(r.key)}
          overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
        >
          <span aria-hidden="true">{favorite ? '★ ' : '☆ '}</span>
          {favorite ? 'Saved' : 'Save'}
        </Button>
      </div>

      {excludedReasons.length ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning">
            <strong>This route no longer matches your filters.</strong> {excludedReasons.join('. ')}.{' '}
            It stays open here so you can finish reading; go back to see current results.
          </Notice>
        </div>
      ) : null}

      <KindLabel kind={r.kind} />
      <h2
        id="detail-heading"
        ref={headingRef}
        tabIndex={-1}
        style={{ fontSize: 24, lineHeight: '32px', fontWeight: 700, margin: '8px 0 4px' }}
      >
        {r.name}
      </h2>
      <p style={{ margin: 0, fontSize: 14, color: tokens.hairlineMid }}>
        {KIND_SHAPE[r.kind]}
        {c ? ` · ${c.areaName}` : ''}
      </p>
      {r.sharesWith.length ? (
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: '20px', color: tokens.hairlineMid }}>
          {r.sharesWith.length === 1 ? 'Runs along' : 'Runs along the circuits'}{' '}
          {r.sharesWith.map((o) => `${o.name} (${Math.round(o.share * 100)}% of its line)`).join(' and ')}.{' '}
          Shared circuits are drawn faintly underneath this route on the map.
        </p>
      ) : null}

      <dl style={{ margin: '16px 0 0' }}>
        <Row label="Length">{km(r.km)}</Row>
        <Row label="Estimated drive time">{r.driveMin != null ? `~${r.driveMin} min` : 'Unknown'}</Row>
        <Row label={r.funScoreBasis === 'route-total' ? 'Fun score' : 'Road fun (average)'}>{Math.round(r.funScore)} / 100</Row>
        <Row label="Fun kilometres">{km(r.funKm)}</Row>
        {r.connectorShare != null ? <Row label="Lower-scored connector roads">{pct(r.connectorShare)} of distance</Row> : null}
        {r.retraceShare != null ? (
          <Row label="Driven twice, once each way">{r.retraceShare < 0.01 ? 'None' : `${pct(r.retraceShare)} of distance`}</Row>
        ) : null}
        <Row label={`Straight-line from ${home}`}>{dist != null ? `${dist} km` : 'Not in data for this route type'}</Row>
        {c ? (
          <Row label="Modeled reach from Zaandam">{c.reachMinFromZaandam != null ? `~${c.reachMinFromZaandam} min` : 'Unknown'}</Row>
        ) : null}
        {detail.climbM != null ? <Row label="Climb">+{detail.climbM} m</Row> : null}
        {detail.cornerCount ? (
          <Row label="Corners">
            {detail.cornerCount.tight} tight · {detail.cornerCount.sweet} sweet-spot · {detail.cornerCount.flowing} flowing
          </Row>
        ) : null}
        {r.clusterId != null ? <Row label="Local cluster">#{r.clusterId} (unnamed)</Row> : null}
        <Row label="Road data snapshot">{formatDate(generated)}</Row>
      </dl>

      {badges.length ? (
        <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
          {badges.map((b) => (
            <li key={b} style={{ background: tokens.canvasSoft, borderRadius: 999, padding: '6px 12px', fontSize: 14, fontWeight: 500 }}>
              {b}
            </li>
          ))}
        </ul>
      ) : null}

      {detail.why.length || r.traits.length ? (
        <>
          <SectionTitle>Why it is here</SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 16, lineHeight: '24px' }}>
            {detail.why.map((w) => <li key={w}>{w}</li>)}
            {r.traits.length ? <li>Traits: {r.traits.join(', ')}</li> : null}
          </ul>
        </>
      ) : null}

      <SectionTitle>Score breakdown (0–100)</SectionTitle>
      <div style={{ display: 'grid', gap: 6 }}>
        {DIMENSIONS.map((d) => (
          <Meter key={d} label={DIM_LABEL[d]} value={r.dims[d]} />
        ))}
      </div>
      {r.catalog === 'sprint' ? (
        <p style={{ fontSize: 12, color: tokens.hairlineMid, margin: '6px 0 0' }}>Sprint scores are stored 0–1 and shown ×100.</p>
      ) : null}

      {r.roads.length ? (
        <>
          <SectionTitle>Roads</SectionTitle>
          {r.anchorRoads.length ? (
            <p style={{ fontSize: 14, lineHeight: '20px', margin: '0 0 8px' }}>
              High-fun stretches in driving order: {r.anchorRoads.join(' → ')}. Each was checked in this direction
              only, so none is a reversible sprint. Other listed roads may connect or return between them.
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
        </>
      ) : null}

      {detail.elev.length || detail.curv.length ? (
        <>
          <SectionTitle>Elevation and curvature</SectionTitle>
          <ProfileChart circuit={detail} totalKm={r.km} onCursorKm={onCursorKm} />
          {mix.length ? (
            <p style={{ fontSize: 14, margin: '8px 0 0' }}>
              Posted limits along the route: {mix.map((m) => `${m.lim} km/h for ${pct(m.share)}`).join(', ')}. These are legal maximums, not targets.
            </p>
          ) : null}
        </>
      ) : null}

      {detail.stops.length ? (
        <>
          <SectionTitle>Heads-up along the route</SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: '20px' }}>
            {groupStops(detail.stops).map(([note, n, first]) => (
              <li key={note}>
                {note} ({n > 1 ? `${n} places` : '1 place'}, “{stopPin(first.type)}” pin on the map)
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {c?.flags.length ? (
        <ul style={{ margin: '12px 0 0', paddingLeft: 20, fontSize: 14 }}>
          {c.flags.map((f) => (
            <li key={f}>{FLAG_LABEL[f] ?? f}</li>
          ))}
        </ul>
      ) : null}

      <SectionTitle>Access and safety</SectionTitle>
      <SoftCard>
        {r.kind === 'sprint' ? (
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>
            {r.returnNote ?? 'Reverse the line only after finding a safe, legal place to turn around.'} The end point is
            not a verified turning place.
          </p>
        ) : null}
        {r.kind === 'linked-open' ? (
          <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: '20px', fontWeight: 500 }}>
            This ride ends away from its start and was checked in this direction only. Do not assume it can be driven in
            reverse; plan your own legal way back.
          </p>
        ) : null}
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: '20px' }}>
          The {closes ? 'start and finish' : 'start and end'} are points on the road network, not checked parking, meeting or
          turning places.
        </p>
        <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: '20px' }}>
          Legal in {r.windows.length} of {allWindows.length} sample departures checked in the pinned data. These dates are fixed
          samples, not a check for today:
        </p>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: '20px' }}>
          {r.windows.map((w) => (
            <li key={w}>{formatWindow(w)}</li>
          ))}
        </ul>
        <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: '20px' }}>{SAFETY_NOTE}</p>
      </SoftCard>

      <SectionTitle>Take it with you</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {gmaps ? (
          <Button
            $as="a"
            href={gmaps}
            target="_blank"
            rel="noopener noreferrer"
            shape={SHAPE.pill}
            overrides={{ BaseButton: { style: { minHeight: '48px' } } }}
          >
            Open in Google Maps
          </Button>
        ) : null}
        {compact ? (
          <Button
            $as="a"
            href={compact}
            target="_blank"
            rel="noopener noreferrer"
            kind={BKIND.secondary}
            shape={SHAPE.pill}
            overrides={{ BaseButton: { style: { minHeight: '48px' } } }}
          >
            {COMPACT_WAYPOINTS}-stop link
          </Button>
        ) : null}
      </div>
      <p style={{ fontSize: 14, lineHeight: '20px', color: tokens.hairlineMid, margin: '8px 0 0' }}>
        {gmaps
          ? `${r.gmapsSource === 'line' ? 'The link follows points taken from this route’s line. ' : ''}${
              compact
                ? `If Google Maps on your phone drops stops or will not open the route, use the ${COMPACT_WAYPOINTS}-stop link instead; it strays from the line more. `
                : ''
            }Google Maps may choose its own roads between those points, so compare it with the line here; it does not confirm access.${r.kind === 'sprint' ? ' It covers one direction only.' : ''}`
          : 'No navigation link exists for this route yet.'}
      </p>

      {similar.length ? (
        <>
          <SectionTitle>More like this</SectionTitle>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {similar.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
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
                    <KindLabel kind={s.kind} />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      {Math.round(s.funScore)}
                      <span style={{ color: tokens.hairlineMid, fontWeight: 400 }}>/100</span>
                    </span>
                  </span>
                  <span style={{ display: 'block', fontSize: 16, lineHeight: '24px', fontWeight: 700, margin: '4px 0 2px' }}>{s.name}</span>
                  <span style={{ display: 'block', fontSize: 14, lineHeight: '20px', color: tokens.hairlineMid }}>
                    {km(s.km)}
                    {s.driveMin != null ? ` · ~${s.driveMin} min drive` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
});
