import { forwardRef } from 'react';
import { styled } from 'baseui';
import { Button, KIND as BKIND, SHAPE } from 'baseui/button';
import type { Home } from '../data/raw';
import type { RouteView } from '../data/model';
import { KindLabel, RouteStats, StatIcon } from './ui';
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
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', minHeight: 32, paddingRight: 56 }}>
          <KindLabel kind={r.kind} color={r.color} />
        </span>
        {selected ? <span style={{ display: 'block', marginTop: 4, fontSize: 12, fontWeight: 500 }}>Selected</span> : null}
        <span style={{ display: 'block', fontSize: 16, lineHeight: '22px', fontWeight: 500, margin: '6px 0 8px', overflowWrap: 'anywhere', textWrap: 'pretty' }}>{r.name}</span>
        <RouteStats route={r} home={home} />
        {r.traits.length ? (
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, lineHeight: '18px', color: tokens.hairlineMid }}>
            {r.traits.join(', ')}
          </span>
        ) : null}
        {r.anchorRoads.length > 1 && !r.name.startsWith(r.anchorRoads[0]) ? (
          <span style={{ display: 'block', fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
            {r.anchorRoads.join(' → ')}
          </span>
        ) : null}
      </CardButton>
      <button
        type="button"
        className="fr-favorite-button"
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${r.name} from favorites` : `Save ${r.name} to favorites`}
        title={favorite ? 'Remove from favorites' : 'Save to favorites'}
        onClick={() => onToggleFavorite(r.key)}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 44,
          height: 44,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: 999,
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
          color: favorite ? tokens.ink : tokens.hairlineMid,
        }}
      >
        <span aria-hidden="true"><StatIcon name="favorite" size={16} filled={favorite} /></span>
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
}

export function ResultsList({ results, home, selectedKey, shown, favorites, onShowMore, onOpen, onHover, onToggleFavorite }: ListProps) {
  if (!results.length) return null;
  const visible = results.slice(0, shown);
  return (
    <div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }} aria-label="Matching routes">
        {visible.map((r) => (
          <li key={r.key}>
            <ResultCard
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
          <Button kind={BKIND.secondary} shape={SHAPE.default} onClick={onShowMore} overrides={{ BaseButton: { style: { width: '100%', minHeight: '48px' } } }}>
            Show {Math.min(PAGE_SIZE, results.length - shown)} more of {(results.length - shown).toLocaleString('en-GB')} remaining
          </Button>
        </div>
      ) : null}
    </div>
  );
}
