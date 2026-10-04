import { useState, type ReactNode } from 'react';
import { styled } from 'baseui';
import { StatelessAccordion, Panel } from 'baseui/accordion';
import type { Kind, RouteView } from '../data/model';
import type { Home } from '../data/raw';
import type { Country } from '../data/countries';
import type { Profile } from '../data/filters';
import { KIND_LABEL } from '../data/model';
import { km } from '../data/format';
import { tokens } from '../theme';

export function SourceNotice({ country }: { country: Country }) {
  return <>{country.attribution}{country.sourceLinks?.map(({ label, url }) =>
    <span key={url}> · <a href={url} target="_blank" rel="noopener noreferrer">{label}</a></span>)}</>;
}

export const SectionTitle = styled('h2', {
  fontSize: '14px',
  lineHeight: '20px',
  fontWeight: 700,
  margin: `${tokens.space.x2} 0 ${tokens.space.sm}`,
  color: tokens.ink,
});

export const Caption = styled('p', {
  fontSize: '14px',
  lineHeight: '20px',
  color: tokens.hairlineMid,
  margin: `${tokens.space.xs} 0 0`,
});

export const SoftCard = styled('div', {
  backgroundColor: tokens.canvasSoft,
  borderRadius: tokens.radiusCard,
  padding: tokens.space.lg,
});

export const Fact = styled('span', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: tokens.space.xxs,
  fontSize: '14px',
  lineHeight: '20px',
  color: tokens.hairlineMid,
});

/** Optional content is mounted only while open, including expensive charts. */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  return (
    <StatelessAccordion expanded={expanded} onChange={({ expanded }) => setExpanded(expanded)} renderAll={false}
      overrides={{
        Header: { style: { minHeight: '48px', paddingLeft: '0', paddingRight: '0' } },
        Content: { style: { padding: '8px 0 16px', transitionDuration: '250ms', transitionDelay: '100ms' } },
        ContentAnimationContainer: { style: { transitionDuration: '250ms' } },
        ToggleIconGroup: { style: { transitionDuration: '250ms' } },
      }}>
      <Panel key="content" title={title}>{children}</Panel>
    </StatelessAccordion>
  );
}

/** A short line sample that matches the map pattern for each route family. */
export function KindGlyph({ kind, size = 28 }: { kind: Kind; size?: number }) {
  const dash =
    kind === 'circuit' ? undefined : kind === 'linked-loop' ? '9 3' : kind === 'linked-open' ? '5 4' : '0.5 4';
  const closes = kind === 'circuit' || kind === 'linked-loop';
  return (
    <svg width={size} height={12} viewBox="0 0 28 12" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <line
        x1="3"
        y1="6"
        x2={closes ? 21 : 25}
        y2="6"
        stroke="#000"
        strokeWidth={kind === 'sprint' ? 3 : 2.5}
        strokeDasharray={dash}
        strokeLinecap={kind === 'sprint' ? 'round' : 'butt'}
      />
      {closes ? <circle cx="23.5" cy="6" r="3" fill="none" stroke="#000" strokeWidth="1.5" /> : null}
    </svg>
  );
}

export function KindLabel({ kind, color }: { kind: Kind; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
      {color ? <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: color, flex: 'none', border: `1px solid ${tokens.hairlineMid}` }} /> : null}
      <KindGlyph kind={kind} />
      {KIND_LABEL[kind]}
    </span>
  );
}

/** Shared, decorative metadata symbols; meaning stays in the accompanying text. */
export function StatIcon({ name, size = 14, filled = false }: { name: 'route' | 'clock' | 'home' | 'score' | 'limit' | 'filter' | 'favorite'; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={name === 'favorite' && filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
      {name === 'route' ? <><path d="M5 5h10a4 4 0 010 8H9a4 4 0 000 8h10" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="21" r="2" /></> :
        name === 'clock' ? <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></> :
          name === 'score' ? <><path d="M4 18a9 9 0 1116 0M5 18h14M12 13l4-4" /><circle cx="12" cy="13" r="1.5" /></> :
            name === 'limit' ? <><rect x="5" y="3" width="14" height="14" rx="2" /><path d="M12 17v5M9 8h6M9 12h6" /></> :
              name === 'favorite' ? <path d="M12 3l2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 3 1.1-6.3L3 9.6l6.3-.9L12 3z" /> :
                name === 'filter' ? <><path d="M3 6h6M13 6h8M3 12h12M19 12h2M3 18h2M9 18h12" /><circle cx="11" cy="6" r="2" /><circle cx="17" cy="12" r="2" /><circle cx="7" cy="18" r="2" /></> :
          <path d="M3 11l9-8 9 8M5 9v12h14V9M10 21v-7h4v7" />}
    </svg>
  );
}

export function ProfileIcon({ profile }: { profile: Profile }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      {profile === 'balanced' ? <path d="M12 3v17M6 21h12M4 7h16M6 7l-4 8h8L6 7zM18 7l-4 8h8l-4-8z" /> :
        profile === 'scenic' ? <><circle cx="17" cy="6" r="2" /><path d="M2 20l7-12 6 10 3-5 4 7H2z" /></> :
          profile === 'technical' ? <path d="M7 3h8a4 4 0 010 8H9a4 4 0 000 8h8M7 1v4M17 17v4" /> :
            <path d="M5 19C-1 5 10 3 21 3c0 11-2 22-16 16zM4 21L16 9" />}
    </svg>
  );
}

export function RouteStats({ route, home }: { route: RouteView; home?: Home }) {
  const distance = home ? route.distanceKm?.[home] : null;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: 12, lineHeight: '18px', color: tokens.hairlineMid }}>
      <span className="fr-route-stat" aria-label={`Length ${km(route.km)}`} title="Route length">
        <StatIcon name="route" />{km(route.km)}
      </span>
      <span className="fr-route-stat" aria-label={route.driveMin != null ? `Estimated route drive time ${route.driveMin} minutes` : 'Route drive time unknown'} title="Time on the route">
        <StatIcon name="clock" />{route.driveMin != null ? `~${route.driveMin} min` : 'Unknown'}
      </span>
      {home ? <span className="fr-route-stat" aria-label={distance != null ? `${distance} km straight-line from ${home}` : `Straight-line distance from ${home} unknown`} title={`Straight-line from ${home}, not driving distance`}>
        <StatIcon name="home" />{distance != null ? `${distance} km direct` : 'Distance unknown'}
      </span> : null}
    </span>
  );
}

export function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pctValue = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '88px 1fr 40px', gap: 8, alignItems: 'center', fontSize: 14 }}>
      <span>{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        style={{ height: 8, background: tokens.surfacePressed, borderRadius: 999, overflow: 'hidden' }}
      >
        <span style={{ display: 'block', height: '100%', width: `${pctValue}%`, background: tokens.ink }} />
      </span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Math.round(value)}</span>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <div
      style={{
        borderRadius: 16,
        padding: '12px 16px',
        fontSize: 14,
        lineHeight: '20px',
        background: tone === 'warning' ? '#000' : tokens.canvasSoft,
        color: tone === 'warning' ? '#fff' : '#000',
      }}
    >
      {children}
    </div>
  );
}

export const SAFETY_NOTE =
  'Access windows are sampled departures from pinned data, not live permission. Check current signs and restrictions before driving.';
