import { forwardRef, useEffect, useRef } from 'react';
import { styled } from 'baseui';
import { Button, KIND as BKIND, SHAPE } from 'baseui/button';
import type { Home } from '../data/raw';
import type { RouteView } from '../data/model';
import { KIND_SHAPE } from '../data/model';
import { km } from '../data/format';
import { KindLabel } from './ui';
import { tokens } from '../theme';

export const PAGE_SIZE = 40;

const CardButton = styled<'button', { $selected: boolean }>('button', ({ $selected }) => ({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  color: tokens.ink,
  backgroundColor: $selected ? tokens.canvasSoft : tokens.canvas,
  border: `2px solid ${$selected ? tokens.ink : tokens.surfacePressed}`,
  borderRadius: tokens.radiusCard,
  padding: tokens.space.lg,
  cursor: 'pointer',
  minHeight: '44px',
  ':hover': { backgroundColor: tokens.canvasSofter },
}));

interface CardProps {
  route: RouteView;
  home: Home;
  selected: boolean;
  favorite: boolean;
  onOpen: (r: RouteView, el: HTMLElement) => void;
  onHover: (key: string | null) => void;
  onToggleFavorite: (key: string) => void;
}

export const ResultCard = forwardRef<HTMLButtonElement, CardProps>(function ResultCard(
  { route: r, home, selected, favorite, onOpen, onHover, onToggleFavorite },
  ref,
) {
  const dist = r.distanceKm?.[home];
  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <CardButton
        ref={ref}
        type="button"
        $selected={selected}
        aria-current={selected ? 'true' : undefined}
        data-route-key={r.key}
        onClick={(e) => onOpen(r, e.currentTarget)}
        onMouseEnter={() => onHover(r.key)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(r.key)}
        onBlur={() => onHover(null)}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', paddingRight: 40 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: r.color, flex: 'none', border: `1px solid ${tokens.hairlineMid}` }}
            />
            <KindLabel kind={r.kind} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 500 }} aria-label={`Fun score ${Math.round(r.funScore)} out of 100`}>
            {Math.round(r.funScore)}
            <span style={{ color: tokens.hairlineMid, fontWeight: 400 }}>/100</span>
          </span>
        </span>
        <span style={{ display: 'block', fontSize: 18, lineHeight: '24px', fontWeight: 700, margin: '6px 0 2px' }}>{r.name}</span>
        <span style={{ display: 'block', fontSize: 14, lineHeight: '20px', color: tokens.hairlineMid }}>
          {km(r.km)} · {r.driveMin != null ? `~${r.driveMin} min drive` : 'drive time unknown'} ·{' '}
          {dist != null ? `${dist} km straight-line from ${home}` : r.circuit ? r.circuit.areaName : 'distance unknown'}
        </span>
        <span style={{ display: 'block', fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
          {KIND_SHAPE[r.kind]}
          {r.traits.length ? ` · ${r.traits.join(', ')}` : ''}
        </span>
        {r.anchorRoads.length > 1 && !r.name.startsWith(r.anchorRoads[0]) ? (
          <span style={{ display: 'block', fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
            {r.anchorRoads.join(' → ')}
          </span>
        ) : null}
        {r.sharesWith.length ? (
          <span style={{ display: 'block', fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid, marginTop: 2 }}>
            <span aria-hidden="true">‖ </span>
            Runs along {r.sharesWith[0].name} ({Math.round(r.sharesWith[0].share * 100)}% of its line)
          </span>
        ) : null}
      </CardButton>
      <button
        type="button"
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${r.name} from favorites` : `Save ${r.name} to favorites`}
        title={favorite ? 'Remove from favorites' : 'Save to favorites'}
        onClick={() => onToggleFavorite(r.key)}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 44,
          height: 44,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: 999,
          background: favorite ? tokens.surfacePressed : tokens.canvasSoft,
          cursor: 'pointer',
          fontSize: 20,
          lineHeight: 1,
          color: favorite ? tokens.ink : tokens.hairlineMid,
        }}
      >
        <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
      </button>
    </span>
  );
});

interface ListProps {
  results: RouteView[];
  home: Home;
  selectedKey: string | null;
  shown: number;
  favorites: ReadonlySet<string>;
  onShowMore: () => void;
  onOpen: (r: RouteView, el: HTMLElement) => void;
  onHover: (key: string | null) => void;
  onToggleFavorite: (key: string) => void;
  /** Bumped when the map picks a route; the list scrolls to and focuses that card. */
  focusRequest: { key: string; nonce: number } | null;
}

export function ResultsList({ results, home, selectedKey, shown, favorites, onShowMore, onOpen, onHover, onToggleFavorite, focusRequest }: ListProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current.get(focusRequest.key);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      el.focus({ preventScroll: true });
    }
  }, [focusRequest]);

  if (!results.length) return null;
  const visible = results.slice(0, shown);
  return (
    <div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Matching routes">
        {visible.map((r) => (
          <li key={r.key}>
            <ResultCard
              ref={(el) => {
                if (el) refs.current.set(r.key, el);
                else refs.current.delete(r.key);
              }}
              route={r}
              home={home}
              selected={r.key === selectedKey}
              favorite={favorites.has(r.key)}
              onOpen={onOpen}
              onHover={onHover}
              onToggleFavorite={onToggleFavorite}
            />
          </li>
        ))}
      </ul>
      {shown < results.length ? (
        <div style={{ marginTop: 12 }}>
          <Button kind={BKIND.secondary} shape={SHAPE.pill} onClick={onShowMore} overrides={{ BaseButton: { style: { width: '100%', minHeight: '48px' } } }}>
            Show {Math.min(PAGE_SIZE, results.length - shown)} more of {(results.length - shown).toLocaleString('en-GB')} remaining
          </Button>
        </div>
      ) : null}
    </div>
  );
}
