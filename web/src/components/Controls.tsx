import { forwardRef, useMemo, useState, type ComponentProps } from 'react';
import { Button, SIZE } from 'baseui/button';
import { ButtonGroup, MODE } from 'baseui/button-group';
import { Select, StyledInputContainer, TYPE, type Value } from 'baseui/select';
import { Slider } from 'baseui/slider';
import { Checkbox, STYLE_TYPE as CHECK_STYLE } from 'baseui/checkbox';
import { FormControl } from 'baseui/form-control';
import { Tabs, Tab } from 'baseui/tabs-motion';
import { HOMES } from '../data/raw';
import {
  KM_LIMITS,
  NEARBY_KM,
  PROFILE_LABEL,
  type Filters,
  type Profile,
  type SortKey,
  type TypeTab,
} from '../data/filters';
import type { SearchIndex } from '../data/search';
import { searchSuggestions } from '../data/search';
import { Caption, ProfileIcon, StatIcon } from './ui';
import { tokens } from '../theme';

export interface ControlProps {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearchChosen: (f: Filters) => void;
  index: SearchIndex;
  windows: string[];
  typeCounts: Record<TypeTab, number>;
  hasLinked: boolean;
  areaCount: number;
}

const groupOverrides = {
  Root: { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px', padding: '4px', backgroundColor: tokens.canvasSofter, borderRadius: '12px' } },
};
const choiceOverrides = {
  BaseButton: { props: { 'aria-pressed': undefined }, style: { minHeight: '44px', paddingLeft: '8px', paddingRight: '8px', fontSize: '14px', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px' } },
};
const PROFILES: Profile[] = ['balanced', 'scenic', 'technical', 'quiet'];
const PROFILE_HELP: Record<Profile, string> = {
  balanced: 'Most fun kilometres first',
  scenic: 'Highest scenery score first',
  technical: 'Highest corner score first',
  quiet: 'Highest quiet score first',
};
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'profile', label: 'Profile ranking' },
  { id: 'funKm', label: 'Fun kilometres' },
  { id: 'score', label: 'Fun score' },
  { id: 'shortest', label: 'Shortest first' },
  { id: 'longest', label: 'Longest first' },
  { id: 'nearest', label: 'Nearest (straight-line)' },
];
const DRIVE_OPTIONS = [null, 15, 30, 60, 120] as const;

const selectOverrides = {
  ControlContainer: { style: { minHeight: '48px' } },
};
const sliderOverrides = {
  Track: { style: { paddingTop: '22px', paddingBottom: '22px', paddingLeft: '12px', paddingRight: '12px' } },
  TickBar: { style: { paddingLeft: '12px', paddingRight: '12px', paddingBottom: '0' } },
  Tick: { style: { fontSize: '12px', lineHeight: '16px' } },
};
const FilterSelectInput = forwardRef<HTMLDivElement, ComponentProps<typeof StyledInputContainer>>(function FilterSelectInput(props, ref) {
  return <StyledInputContainer {...props} ref={ref} role="combobox" aria-expanded={props.$isOpen} aria-haspopup="listbox" />;
});
// Base Web's non-searchable select omits its combobox role.
export const selectInputOverrides = (label: string) => ({
  InputContainer: { component: FilterSelectInput, props: { 'aria-label': label } },
});

export function HomeChoices({ filters: f, onChange }: Pick<ControlProps, 'filters' | 'onChange'>) {
  return (
    <ButtonGroup mode={MODE.radio} selected={HOMES.indexOf(f.home)} aria-label="Home place"
      onClick={(_event, index) => onChange({ ...f, home: HOMES[index] })} size={SIZE.compact} overrides={groupOverrides}>
      {HOMES.map((home) => <Button key={home} role="radio" aria-checked={f.home === home} overrides={choiceOverrides}>{home}</Button>)}
    </ButtonGroup>
  );
}

export function ProfileChoices({ filters: f, onChange }: Pick<ControlProps, 'filters' | 'onChange'>) {
  return (
    <ButtonGroup mode={MODE.radio} selected={f.sort === 'profile' ? PROFILES.indexOf(f.profile) : -1}
      aria-label="Driving style" onClick={(_event, index) => onChange({ ...f, profile: PROFILES[index], sort: 'profile' })}
      size={SIZE.compact} overrides={groupOverrides}>
      {PROFILES.map((profile) => <Button key={profile} role="radio" aria-checked={f.sort === 'profile' && f.profile === profile} title={PROFILE_HELP[profile]}
        overrides={{ BaseButton: { ...choiceOverrides.BaseButton, style: { ...choiceOverrides.BaseButton.style, gap: '6px' } } }}><ProfileIcon profile={profile} />{PROFILE_LABEL[profile]}</Button>)}
    </ButtonGroup>
  );
}

export function RoadSearch({ filters: f, onChange, onSearchChosen, index }: Pick<ControlProps, 'filters' | 'onChange' | 'onSearchChosen' | 'index'>) {
  const [query, setQuery] = useState('');
  const suggestions = useMemo(() => searchSuggestions(index, query, 10), [index, query]);

  const searchValue: Value = f.search
    ? [{ id: f.search.kind === 'road' ? `road:${f.search.key}` : `area:${f.search.id}`, label: f.search.name }]
    : [];
  const options = suggestions.map((s) => ({ id: s.id, label: s.label, description: s.description, selection: s.selection }));
  return (
    <FormControl label="Search a road or circuit area">
      <Select id="route-search" type={TYPE.search} options={options} value={searchValue}
        placeholder="Road name, e.g. Duinlustweg" filterOptions={(o) => o}
        onInputChange={(e) => setQuery(e.currentTarget.value)}
        onChange={({ value }) => {
          const opt = value[0] as (typeof options)[number] | undefined;
          setQuery('');
          if (opt) onSearchChosen({ ...f, search: opt.selection });
          else onChange({ ...f, search: null });
        }}
        noResultsMsg={query.trim().length < 2 ? 'Type at least two letters' : 'No matching road or circuit area. Town and postcode search is not available.'}
        getOptionLabel={({ option }) => <div><div style={{ fontWeight: 500 }}>{option?.label}</div><div style={{ fontSize: 12, color: tokens.hairlineMid }}>{option?.description}</div></div>}
        maxDropdownHeight="240px" overrides={{ ControlContainer: selectOverrides.ControlContainer }} />
    </FormControl>
  );
}

export function Controls({ filters: f, onChange, favoritesOnly, onFavoritesOnly, favoriteCount }: ControlProps & {
  favoritesOnly: boolean; onFavoritesOnly: (enabled: boolean) => void; favoriteCount: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const [section, setSection] = useState<React.Key>('route');
  const formOverrides = {
    ControlContainer: { style: { marginBottom: '8px' } },
    LabelContainer: { style: { marginTop: '4px', marginBottom: '4px' } },
    Label: { style: { fontSize: '14px', marginBottom: '0' } },
    Caption: { style: { fontSize: '12px', lineHeight: '18px', marginTop: '4px', marginBottom: '0' } },
  };
  const tabOverrides = {
    Tab: { style: { flexGrow: 1, minHeight: '44px' } },
    TabPanel: { style: { padding: '16px 0 0' } },
  };

  return (
    <Tabs activeKey={section} onChange={({ activeKey }) => setSection(activeKey)} renderAll={false}
      overrides={{ TabList: { props: { 'aria-label': 'Filter view' } } }}>
      <Tab key="route" title={<span className="fr-route-stat"><StatIcon name="route" />Route</span>} overrides={tabOverrides}>
        <Checkbox checked={favoritesOnly} checkmarkType={CHECK_STYLE.toggle}
          onChange={(event) => onFavoritesOnly(event.currentTarget.checked)}
          overrides={{ Root: { style: { minHeight: '44px', alignItems: 'center' } } }}>
          <span className="fr-route-stat"><StatIcon name="favorite" />Favorites only ({favoriteCount} saved)</span>
        </Checkbox>
        <Checkbox checked={f.scope === 'nearby'} checkmarkType={CHECK_STYLE.toggle}
          onChange={(event) => set({ scope: event.currentTarget.checked ? 'nearby' : 'national' })}
          overrides={{ Root: { style: { minHeight: '44px', alignItems: 'center' } } }}>
          <span className="fr-route-stat"><StatIcon name="home" />Limit distance</span>
        </Checkbox>
        {f.scope === 'nearby' ? (
          <FormControl
            label={<span className="fr-route-stat"><StatIcon name="home" />Radius: {f.radiusKm} km</span>}
            caption={`Straight-line from ${f.home}. Routes without distance data are excluded.`}
            overrides={formOverrides}
          >
            <Slider
              value={[f.radiusKm]}
              min={10}
              max={NEARBY_KM}
              step={5}
              onChange={({ value }) => value && set({ radiusKm: value[0] })}
              valueToLabel={(v) => `${v} km`}
              overrides={{ ...sliderOverrides, Thumb: { props: { 'aria-label': 'Straight-line radius in km' } } }}
            />
          </FormControl>
        ) : null}

      <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
        <FormControl label={<span className="fr-route-stat"><StatIcon name="route" />Length: {f.kmMin}–{f.kmMax} km</span>} overrides={formOverrides}>
          <Slider
            value={[f.kmMin, f.kmMax]}
            min={KM_LIMITS.min}
            max={KM_LIMITS.max}
            step={1}
            onChange={({ value }) => value && set({ kmMin: value[0], kmMax: value[1] })}
            valueToLabel={(v) => `${v} km`}
            overrides={{ ...sliderOverrides, Thumb: { props: { 'aria-label': 'Route length in km' } } }}
          />
        </FormControl>
        <FormControl label={<span className="fr-route-stat"><StatIcon name="score" />Minimum fun: {f.minFun || 'off'}</span>} overrides={formOverrides}>
          <Slider value={[f.minFun ?? 0]} min={0} max={100} step={5} onChange={({ value }) => value && set({ minFun: value[0] })}
            overrides={{ ...sliderOverrides, Thumb: { props: { 'aria-label': 'Minimum fun score' } } }} />
        </FormControl>
        <FormControl
          label={<span className="fr-route-stat"><StatIcon name="clock" />Time on the route</span>}
          caption="Not travel time. Unknown estimates are hidden when limited."
          overrides={formOverrides}
        >
          <ButtonGroup mode={MODE.radio} selected={DRIVE_OPTIONS.indexOf(f.maxDriveMin as typeof DRIVE_OPTIONS[number])}
            aria-label="Estimated drive time" size={SIZE.compact} onClick={(_event, index) => set({ maxDriveMin: DRIVE_OPTIONS[index] })}
            overrides={{ Root: { style: { ...groupOverrides.Root.style, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' } } }}>
            {DRIVE_OPTIONS.map((minutes) => <Button key={String(minutes)} role="radio" aria-checked={f.maxDriveMin === minutes}
              aria-label={minutes == null ? 'Any drive time' : `Up to ${minutes} minutes`} overrides={choiceOverrides}>
              {minutes == null ? 'Any' : minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
            </Button>)}
          </ButtonGroup>
        </FormControl>
      </div>
      </Tab>
      <Tab key="more" title={<span className="fr-route-stat"><StatIcon name="filter" />More</span>} overrides={tabOverrides}>
        {(
          [
            ['minScenery', 'Minimum scenery'],
            ['minQuiet', 'Minimum quiet (modelled)'],
            ['minCorners', 'Minimum corners'],
          ] as const
        ).map(([key, label]) => (
          <FormControl key={key} label={<span className="fr-route-stat"><ProfileIcon profile={key === 'minScenery' ? 'scenic' : key === 'minQuiet' ? 'quiet' : 'technical'} />{label}: {f[key] || 'off'}</span>} overrides={formOverrides}>
            <Slider
              value={[f[key]]}
              min={0}
              max={100}
              step={5}
              onChange={({ value }) => value && set({ [key]: value[0] })}
              overrides={{ ...sliderOverrides, Thumb: { props: { 'aria-label': `${label} score` } } }}
            />
          </FormControl>
        ))}
        <Caption>Minimum scores use a 0–100 scale.</Caption>
      </Tab>
    </Tabs>
  );
}