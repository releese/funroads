import { useMemo, useState } from 'react';
import { Button, KIND as BKIND, SIZE, SHAPE } from 'baseui/button';
import { ButtonGroup, MODE } from 'baseui/button-group';
import { Select, TYPE, type Value } from 'baseui/select';
import { Tabs, Tab } from 'baseui/tabs-motion';
import { Slider } from 'baseui/slider';
import { FormControl } from 'baseui/form-control';
import { StatelessAccordion, Panel } from 'baseui/accordion';
import type { Home } from '../data/raw';
import { HOMES } from '../data/raw';
import {
  activePills,
  clearPill,
  KM_LIMITS,
  NEARBY_KM,
  PROFILE_LABEL,
  resetFilters,
  type Filters,
  type LinkedShape,
  type Profile,
  type SortKey,
  type TypeTab,
} from '../data/filters';
import type { SearchIndex } from '../data/search';
import { searchSuggestions } from '../data/search';
import { formatWindow } from '../data/format';
import { Caption, SectionTitle } from './ui';
import { tokens } from '../theme';

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  onSearchChosen: (f: Filters) => void;
  index: SearchIndex;
  windows: string[];
  typeCounts: Record<TypeTab, number>;
  hasLinked: boolean;
  areaCount: number;
}

const pill = { shape: SHAPE.pill, size: SIZE.compact } as const;
const PROFILES: Profile[] = ['balanced', 'scenic', 'technical', 'quiet'];
const PROFILE_HELP: Record<Profile, string> = {
  balanced: 'Most fun kilometres first',
  scenic: 'Highest scenery score first',
  technical: 'Highest corner score first',
  quiet: 'Highest quiet score first',
};
const TAB_OVERRIDES = { Tab: { style: { paddingLeft: '6px', paddingRight: '6px', flexGrow: 1 } } };

const SORTS: { id: SortKey; label: string }[] = [
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

export function Controls({ filters: f, onChange, onSearchChosen, index, windows, typeCounts, hasLinked, areaCount }: Props) {
  const [query, setQuery] = useState('');
  const suggestions = useMemo(() => searchSuggestions(index, query, 10), [index, query]);
  const set = (patch: Partial<Filters>) => onChange({ ...f, ...patch });
  const pills = activePills(f, formatWindow);

  const searchValue: Value = f.search
    ? [{ id: f.search.kind === 'road' ? `road:${f.search.key}` : `area:${f.search.id}`, label: f.search.name }]
    : [];
  const options = suggestions.map((s) => ({ id: s.id, label: s.label, description: s.description, selection: s.selection }));

  return (
    <div>
      <SectionTitle id="where-heading">Where</SectionTitle>
      <div role="group" aria-labelledby="where-heading" style={{ display: 'grid', gap: 8 }}>
        <ButtonGroup
          mode={MODE.radio}
          selected={HOMES.indexOf(f.home)}
          aria-label="Home place"
          onClick={(_e, i) => set({ home: HOMES[i] as Home })}
          size={SIZE.compact}
          shape={SHAPE.pill}
        >
          {HOMES.map((h) => (
            <Button key={h} overrides={{ BaseButton: { style: { minHeight: '44px', flex: 1 } } }}>
              From {h}
            </Button>
          ))}
        </ButtonGroup>
        <ButtonGroup
          mode={MODE.radio}
          selected={f.scope === 'national' ? 0 : 1}
          aria-label="Area shown"
          onClick={(_e, i) => set({ scope: i === 0 ? 'national' : 'nearby' })}
          size={SIZE.compact}
          shape={SHAPE.pill}
        >
          <Button overrides={{ BaseButton: { style: { minHeight: '44px', flex: 1 } } }}>All Netherlands</Button>
          <Button overrides={{ BaseButton: { style: { minHeight: '44px', flex: 1 } } }}>
            Nearby ({NEARBY_KM} km straight-line)
          </Button>
        </ButtonGroup>
        {f.scope === 'nearby' ? (
          <FormControl
            label={`Straight-line radius from ${f.home}: ${f.radiusKm} km`}
            caption="A view around home, not driving distance or reach time. Routes are still mined nationally."
          >
            <Slider
              value={[f.radiusKm]}
              min={10}
              max={NEARBY_KM}
              step={5}
              onChange={({ value }) => value && set({ radiusKm: value[0] })}
              valueToLabel={(v) => `${v} km`}
              overrides={{ Thumb: { props: { 'aria-label': 'Straight-line radius in km' } } }}
            />
          </FormControl>
        ) : (
          <Caption>Showing every mined route in the Netherlands. Distance shown is straight-line from {f.home}.</Caption>
        )}
      </div>

      <SectionTitle>
        <label htmlFor="route-search">Search a road or circuit area</label>
      </SectionTitle>
      <Select
        id="route-search"
        type={TYPE.search}
        options={options}
        value={searchValue}
        placeholder="Road name, e.g. Duinlustweg"
        filterOptions={(o) => o}
        onInputChange={(e) => setQuery(e.currentTarget.value)}
        onChange={({ value }) => {
          const opt = value[0] as (typeof options)[number] | undefined;
          setQuery('');
          if (opt) onSearchChosen({ ...f, search: opt.selection });
          else set({ search: null });
        }}
        noResultsMsg={
          query.trim().length < 2 ? 'Type at least two letters' : 'No matching mapped area or road. Town and postcode search is not available yet.'
        }
        getOptionLabel={({ option }) => (
          <div>
            <div style={{ fontWeight: 500 }}>{option?.label}</div>
            <div style={{ fontSize: 12, color: tokens.hairlineMid }}>{option?.description}</div>
          </div>
        )}
        maxDropdownHeight="320px"
        overrides={selectOverrides}
      />
      <Caption>Searches road names and the {areaCount} circuit areas in the data. There is no address or town lookup.</Caption>

      <SectionTitle>Route type</SectionTitle>
      <Tabs
        activeKey={f.type}
        onChange={({ activeKey }) => set({ type: activeKey as TypeTab })}
        activateOnFocus
        overrides={{ TabList: { style: { overflowX: 'auto' } } }}
      >
        <Tab key="all" title={`All ${typeCounts.all.toLocaleString('en-GB')}`} overrides={TAB_OVERRIDES} />
        <Tab key="circuit" title={`Circuits ${typeCounts.circuit}`} overrides={TAB_OVERRIDES} />
        <Tab key="linked" title={`Linked ${typeCounts.linked}`} disabled={!hasLinked} overrides={TAB_OVERRIDES} />
        <Tab key="sprint" title={`Sprints ${typeCounts.sprint.toLocaleString('en-GB')}`} overrides={TAB_OVERRIDES} />
      </Tabs>
      {f.type === 'linked' ? (
        <div style={{ marginTop: 8 }}>
          <ButtonGroup
            mode={MODE.radio}
            selected={['any', 'open', 'loop'].indexOf(f.linkedShape)}
            aria-label="Linked ride shape"
            onClick={(_e, i) => set({ linkedShape: (['any', 'open', 'loop'] as LinkedShape[])[i] })}
            {...pill}
          >
            <Button overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Any linked</Button>
            <Button overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Ends elsewhere</Button>
            <Button overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Returns to start</Button>
          </ButtonGroup>
        </div>
      ) : null}
      <Caption>
        Circuits are the national 40–120 km loops. Linked rides join two or three high-fun stretches, each checked in the
        direction driven. Sprints are one road you may reverse only after a safe, legal turn.
      </Caption>

      <SectionTitle id="profile-heading">Profile</SectionTitle>
      <ButtonGroup
        mode={MODE.radio}
        selected={PROFILES.indexOf(f.profile)}
        aria-labelledby="profile-heading"
        onClick={(_e, i) => set({ profile: PROFILES[i], sort: 'profile' })}
        {...pill}
        overrides={{ Root: { style: { flexWrap: 'wrap', gap: '8px' } } }}
      >
        {PROFILES.map((p) => (
          <Button key={p} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
            {PROFILE_LABEL[p]}
          </Button>
        ))}
      </ButtonGroup>
      <Caption>
        {PROFILE_HELP[f.profile]}. Profiles only reorder eligible routes; they never change which roads qualify.
      </Caption>

      <StatelessAccordionWrapper>
        <FormControl label="Sort by">
          <Select
            id="sort"
            clearable={false}
            searchable={false}
            options={SORTS}
            value={SORTS.filter((s) => s.id === f.sort)}
            onChange={({ value }) => value[0] && set({ sort: value[0].id as SortKey })}
            overrides={selectOverrides}
          />
        </FormControl>
        <FormControl label={`Length: ${f.kmMin}–${f.kmMax} km`}>
          <Slider
            value={[f.kmMin, f.kmMax]}
            min={KM_LIMITS.min}
            max={KM_LIMITS.max}
            step={1}
            onChange={({ value }) => value && set({ kmMin: value[0], kmMax: value[1] })}
            valueToLabel={(v) => `${v} km`}
          />
        </FormControl>
        <FormControl
          label="Estimated drive time"
          caption="Modeled time to drive the route itself, not time to reach it. Older data without an estimate is hidden."
        >
          <Select
            id="drive"
            clearable={false}
            searchable={false}
            options={DRIVE_OPTIONS.map((m) => ({ id: String(m), label: m == null ? 'Any drive time' : `Up to ${m} min` }))}
            value={[
              { id: String(f.maxDriveMin), label: f.maxDriveMin == null ? 'Any drive time' : `Up to ${f.maxDriveMin} min` },
            ]}
            onChange={({ value }) => {
              const id = value[0]?.id;
              set({ maxDriveMin: id == null || id === 'null' ? null : Number(id) });
            }}
            overrides={selectOverrides}
          />
        </FormControl>
        <FormControl label="Sampled departure" caption="Only times the pipeline checked. Other times are unknown, not open.">
          <Select
            id="window"
            searchable={false}
            options={windows.map((w) => ({ id: w, label: formatWindow(w) }))}
            value={f.window ? [{ id: f.window, label: formatWindow(f.window) }] : []}
            placeholder="Any sampled window"
            onChange={({ value }) => set({ window: (value[0]?.id as string) ?? null })}
            overrides={selectOverrides}
          />
        </FormControl>
        {(
          [
            ['minScenery', 'Minimum scenery'],
            ['minQuiet', 'Minimum quiet (modelled)'],
            ['minCorners', 'Minimum corners'],
          ] as const
        ).map(([key, label]) => (
          <FormControl key={key} label={`${label}: ${f[key] || 'off'}`} caption="Rubric score out of 100">
            <Slider
              value={[f[key]]}
              min={0}
              max={100}
              step={5}
              onChange={({ value }) => value && set({ [key]: value[0] })}
              overrides={{ Thumb: { props: { 'aria-label': `${label} score` } } }}
            />
          </FormControl>
        ))}
      </StatelessAccordionWrapper>

      {pills.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }} aria-label="Active filters" role="group">
          {pills.map((p) => (
            <Button
              key={p.id}
              kind={BKIND.secondary}
              {...pill}
              aria-label={`Remove filter: ${p.label}`}
              onClick={() => onChange(clearPill(f, p.id))}
              endEnhancer={() => <span aria-hidden="true">×</span>}
              overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
            >
              {p.label}
            </Button>
          ))}
          <Button kind={BKIND.tertiary} {...pill} onClick={() => onChange(resetFilters(f))} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
            Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatelessAccordionWrapper({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState<React.Key[]>([]);
  return (
    <div style={{ marginTop: 16 }}>
      <StatelessAccordion expanded={expanded} onChange={({ expanded }) => setExpanded(expanded)}>
        <Panel key="more" title="Sort and more filters">
          <div style={{ display: 'grid', gap: 4 }}>{children}</div>
        </Panel>
      </StatelessAccordion>
    </div>
  );
}
