import { Button, KIND, SHAPE, SIZE } from 'baseui/button';
import { Select } from 'baseui/select';
import { FormControl } from 'baseui/form-control';
import { StatefulPopover, PLACEMENT } from 'baseui/popover';
import { activePills, clearPill, PROFILE_LABEL, resetFilters, ROUTE_TYPES, selectedTypes, type LinkedShape } from '../data/filters';
import { HomeChoices, ProfileChoices, RoadSearch, SORTS, selectInputOverrides, type ControlProps } from './Controls';
import { Caption, KindGlyph, ProfileIcon, StatIcon } from './ui';
import { tokens } from '../theme';
import { COUNTRIES, countryHref, rememberCountry, type Country } from '../data/countries';

export function CountryPicker({ country }: { country: Country }) {
  return (
    <div style={{ pointerEvents: 'auto' }}>
      <StatefulPopover placement={PLACEMENT.bottomLeft} focusLock returnFocus
        overrides={{ Body: { style: { borderRadius: '16px' } }, Inner: { style: { backgroundColor: tokens.canvas, borderRadius: '16px' } } }}
        content={() => (
          <nav aria-label="Choose country" style={{ display: 'grid', gap: 4, padding: 8, width: 'min(240px, calc(100vw - 32px))' }}>
            {COUNTRIES.map((option) => (
              <Button key={option.id} $as="a" href={countryHref(option.id)}
                onClick={() => rememberCountry(option.id)}
                aria-current={option.id === country.id ? 'page' : undefined}
                kind={option.id === country.id ? KIND.primary : KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
                overrides={{ BaseButton: { style: { minHeight: '44px', justifyContent: 'flex-start' } } }}>
                {option.name}
              </Button>
            ))}
          </nav>
        )}>
        <Button kind={KIND.tertiary} shape={SHAPE.default} size={SIZE.compact}
          aria-label={`Change country: ${country.name}`}
          overrides={{ BaseButton: { props: { className: 'fr-country-button' }, style: {
            minHeight: '44px', fontSize: '12px', fontWeight: 500, lineHeight: '16px',
            padding: '0', alignItems: 'flex-start',
          } } }}>
          <span>
            {country.name}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
          </span>
        </Button>
      </StatefulPopover>
    </div>
  );
}

export function DiscoveryControls(p: ControlProps & { onOpenFilters: () => void; showSearch?: boolean; favoritesOnly: boolean; onFavoritesOnly: (enabled: boolean) => void }) {
  const { filters: f, onChange } = p;
  const pills = activePills(f);
  const types = selectedTypes(f);
  const count = pills.length + (types.length !== 3 ? 1 : 0) + (p.favoritesOnly ? 1 : 0);
  const popoverOverrides = { Body: { style: { borderRadius: '16px', border: `1px solid ${tokens.surfacePressed}` } }, Inner: { style: { backgroundColor: tokens.canvas, borderRadius: '16px' } } };
  const rankingLabel = f.sort === 'profile' ? PROFILE_LABEL[f.profile] : SORTS.find((sort) => sort.id === f.sort)?.label;
  return (
    <div>
      {p.showSearch !== false ? <RoadSearch {...p} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatefulPopover placement={PLACEMENT.bottomLeft} focusLock returnFocus overrides={popoverOverrides}
          content={({ close }) => <div style={{ width: 'min(264px, calc(100vw - 32px))', padding: 12, boxSizing: 'border-box' }}>
            <HomeChoices filters={f} country={p.country} onChange={(next) => { onChange(next); close(); }} />
          </div>}>
          <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact} aria-label={`Change home: ${f.home}`}
            overrides={{ BaseButton: { style: { minHeight: '44px', paddingLeft: '8px', paddingRight: '8px', gap: '4px', fontSize: '12px', flexShrink: 0 } } }}>
            <StatIcon name="home" />{f.home}
          </Button>
        </StatefulPopover>
        <StatefulPopover placement={PLACEMENT.bottomLeft} focusLock returnFocus
          overrides={popoverOverrides}
          content={({ close }) => (
            <div role="group" aria-label="Route ranking" style={{ width: 'min(300px, calc(100vw - 32px))', boxSizing: 'border-box', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Driving style</p>
                <Button kind={KIND.tertiary} shape={SHAPE.square} size={SIZE.compact} onClick={close} aria-label="Close route ranking" title="Close"
                  overrides={{ BaseButton: { style: { minHeight: '44px', minWidth: '44px', padding: '0' } } }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </Button>
              </div>
              <ProfileChoices filters={f} onChange={onChange} />
              <p style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 500 }}>Or order by</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4 }}>
                {SORTS.filter((sort) => sort.id !== 'profile').map((sort) => (
                  <Button key={sort.id} kind={f.sort === sort.id ? KIND.primary : KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
                    aria-pressed={f.sort === sort.id} onClick={() => onChange({ ...f, sort: sort.id })}
                    title={sort.id === 'nearest' ? 'Straight-line distance from your selected home' : undefined}
                    overrides={{ BaseButton: { style: { minHeight: '44px', fontSize: '14px', textAlign: 'left', justifyContent: 'flex-start', gap: '6px', paddingLeft: '8px', paddingRight: '8px' } } }}>
                    <StatIcon name={sort.id === 'nearest' ? 'home' : sort.id === 'score' ? 'score' : 'route'} />
                    {sort.id === 'nearest' ? 'Nearest' : sort.id === 'shortest' ? 'Shortest' : sort.id === 'longest' ? 'Longest' : sort.label}
                  </Button>
                ))}
              </div>
              <Caption>Changes order, not which routes are included.</Caption>
            </div>
          )}>
          <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact} aria-label={`Rank routes: ${rankingLabel}`}
            overrides={{ BaseButton: { style: { minHeight: '44px', flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: '6px', paddingLeft: '8px', paddingRight: '8px', fontSize: '12px', textAlign: 'left' } } }}>
            {f.sort === 'profile' ? <ProfileIcon profile={f.profile} /> : <StatIcon name={f.sort === 'nearest' ? 'home' : f.sort === 'score' ? 'score' : 'route'} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rankingLabel}</span>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
          </Button>
        </StatefulPopover>
        <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact} onClick={p.onOpenFilters} aria-label={`Filters (${count})`}
          overrides={{ BaseButton: { style: { minHeight: '44px', whiteSpace: 'nowrap', gap: '4px', paddingLeft: '8px', paddingRight: '8px', fontSize: '12px', flexShrink: 0 } } }}><StatIcon name="filter" />Filters{count ? ` (${count})` : ''}</Button>
      </div>
      {pills.length || p.favoritesOnly ? (
        <div role="group" aria-label="Active filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {pills.map((pill) => <Button key={pill.id} kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
            aria-label={`Remove filter: ${pill.label}`} onClick={() => onChange(clearPill(f, pill.id))}
            overrides={{ BaseButton: { style: { minHeight: '44px', maxWidth: '100%', textAlign: 'left' } } }}>
            {pill.label}<span aria-hidden="true">&nbsp;×</span>
          </Button>)}
          {p.favoritesOnly ? <Button kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact} aria-label="Remove filter: Favorites only"
            onClick={() => p.onFavoritesOnly(false)} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}><StatIcon name="favorite" />Favorites only ×</Button> : null}
          <Button kind={KIND.tertiary} shape={SHAPE.default} size={SIZE.compact} onClick={() => { onChange(resetFilters(f)); p.onFavoritesOnly(false); }}
            overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Reset filters</Button>
        </div>
      ) : null}
    </div>
  );
}

export function RouteTypeChoices({ filters: f, onChange, hasLinked }: Pick<ControlProps, 'filters' | 'onChange' | 'hasLinked'>) {
  const types = selectedTypes(f);
  return (
    <>
      <div role="group" aria-label="Route types" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, marginTop: 8 }}>
        {ROUTE_TYPES.map((type) => <Button key={type} kind={KIND.secondary} shape={SHAPE.default} size={SIZE.compact}
          disabled={type === 'linked' && !hasLinked} aria-pressed={types.includes(type)}
          onClick={() => onChange({ ...f, type: types.includes(type) ? types.filter((selected) => selected !== type) : [...types, type] })}
          overrides={{ BaseButton: { style: { minHeight: '44px', fontSize: '12px', paddingLeft: '4px', paddingRight: '4px', gap: '4px',
            backgroundColor: types.includes(type) ? tokens.canvasSofter : tokens.canvas,
            border: `1px solid ${types.includes(type) ? tokens.mute : tokens.surfacePressed}` } } }}>
          <KindGlyph kind={type === 'linked' ? 'linked-open' : type} size={20} />
          {({ circuit: 'Circuits', linked: 'Linked', sprint: 'Sprints' })[type]}
        </Button>)}
      </div>
      {types.length === 1 && types[0] === 'linked' ? (
        <FormControl label="Linked ride shape">
          <Select aria-label="Linked ride shape" searchable={false} clearable={false}
            options={[{ id: 'any', label: 'Any linked ride' }, { id: 'open', label: 'Ends elsewhere' }, { id: 'loop', label: 'Returns to start' }]}
            value={[{ id: f.linkedShape }]} onChange={({ value }) => value[0] && onChange({ ...f, linkedShape: value[0].id as LinkedShape })}
            overrides={selectInputOverrides('Linked ride shape')} />
        </FormControl>
      ) : null}
    </>
  );
}
