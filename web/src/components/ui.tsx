import type { ReactNode } from 'react';
import { styled } from 'baseui';
import type { Kind } from '../data/model';
import { KIND_LABEL } from '../data/model';
import { tokens } from '../theme';

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

export function KindLabel({ kind }: { kind: Kind }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
      <KindGlyph kind={kind} />
      {KIND_LABEL[kind]}
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
