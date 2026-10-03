import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStyletron } from 'baseui';
import { Button, KIND as BKIND, SHAPE, SIZE } from 'baseui/button';
import { Checkbox, STYLE_TYPE as CHECK_STYLE } from 'baseui/checkbox';
import { Spinner } from 'baseui/spinner';
import { Modal, ModalBody, ModalHeader, ModalFooter, ModalButton, ROLE } from 'baseui/modal';
import type { LonLat } from '../data/raw';
import { buildCatalogue, buildCollections, type Catalogue, type Collection, type RouteView } from '../data/model';
import { applyFilters, DEFAULT_FILTERS, exclusionReasons, resetFilters, type Filters } from '../data/filters';
import { loadFavoriteNames, loadFavorites, saveFavoriteNames, saveFavorites, toggleFavorite } from '../data/favorites';
import { buildSearchIndex } from '../data/search';
import { loadAll } from '../data/load';
import { formatDate, plural } from '../data/format';
import { MapView, type FitRequest, type MapStatus, type Padding } from '../map/MapView';
import { pointAtFraction, unionBBox, MAX_CONTEXT_LINES } from '../map/geo';
import { useDebounced, useMediaQuery } from '../hooks';
import { MQ, tokens } from '../theme';
import { Controls } from './Controls';
import { ResultsList, PAGE_SIZE } from './Results';
import { RouteDetail } from './RouteDetail';
import { Caption, KindGlyph, Notice, SAFETY_NOTE, SectionTitle } from './ui';

interface LoadState {
  status: 'loading' | 'ready' | 'error';
  catalogue: Catalogue | null;
  problems: string[];
  progress: string;
}

const EMPTY_POOL: RouteView[] = [];

export function App({ dataBase }: { dataBase: string }) {
  const [css] = useStyletron();
  const isMobile = useMediaQuery(MQ.mobile);
  const isTablet = useMediaQuery(MQ.tablet);
  const reducedMotion = useMediaQuery(MQ.reducedMotion);
  const coarsePointer = useMediaQuery(MQ.coarsePointer);

  const [load, setLoad] = useState<LoadState>({ status: 'loading', catalogue: null, problems: [], progress: '' });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [railOpen, setRailOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [cursorKm, setCursorKm] = useState<number | null>(null);
  const [cardFocus, setCardFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => loadFavorites());
  const [favOnly, setFavOnly] = useState(false);
  const [favNames, setFavNames] = useState<Record<string, string>>(() => loadFavoriteNames());
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const onToggleFavorite = useCallback((key: string) => {
    setFavs((s) => {
      const next = toggleFavorite(s, key);
      saveFavorites(next);
      return next;
    });
  }, []);

  const opener = useRef<HTMLElement | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const shellMain = useRef<HTMLDivElement>(null);
  const nonce = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadAll(dataBase, (loaded, total) => {
      if (cancelled) return;
      const mb = (n: number) => (n / 1e6).toFixed(1);
      setLoad((s) => ({ ...s, progress: total ? `${mb(loaded)} of ${mb(total)} MB` : `${mb(loaded)} MB` }));
    }).then(({ routes, linked }) => {
      if (cancelled) return;
      const problems: string[] = [];
      if (routes.error) problems.push(`Circuits and sprints could not be loaded (${routes.error}).`);
      if (linked.error) problems.push(`Linked rides could not be loaded (${linked.error}).`);
      const dropped = [...(routes.value?.dropped ?? []), ...(linked.value?.dropped ?? [])];
      if (dropped.length) problems.push(`${plural(dropped.length, 'record')} skipped because required fields were missing or malformed.`);
      if (!routes.value && !linked.value) {
        setLoad({ status: 'error', catalogue: null, problems, progress: '' });
        return;
      }
      const catalogue = buildCatalogue(routes.value?.doc ?? null, linked.value?.doc ?? null);
      setLoad({ status: 'ready', catalogue, problems, progress: '' });
    });
    return () => {
      cancelled = true;
    };
  }, [dataBase]);

  const cat = load.catalogue;

  // Remember the names of saved routes while they exist, so a later
  // regeneration that drops them can still say which ones went.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const k of favs) {
      const name = cat?.byKey.get(k)?.name ?? favNames[k];
      if (name) next[k] = name;
    }
    const keys = Object.keys(next);
    if (keys.length === Object.keys(favNames).length && keys.every((k) => favNames[k] === next[k])) return;
    setFavNames(next);
    saveFavoriteNames(next);
  }, [cat, favs, favNames]);

  const removeStaleFavorites = () => {
    if (!cat) return;
    const next = new Set([...favs].filter((k) => cat.byKey.has(k)));
    setFavs(next);
    saveFavorites(next);
  };

  const index = useMemo(() => (cat ? buildSearchIndex(cat) : { entries: [] }), [cat]);
  const collections = useMemo(() => (cat ? buildCollections(cat) : []), [cat]);
  const collection = useMemo(() => collections.find((c) => c.id === collectionId) ?? null, [collections, collectionId]);
  const result = useMemo(() => {
    const base = cat
      ? applyFilters(cat.routes, filters)
      : { results: [], hiddenNoDistance: 0, hiddenNoDrive: 0, typeCounts: { all: 0, circuit: 0, linked: 0, sprint: 0 } };
    let out = base;
    // A collection is a curated ranking, not a filter: it replaces the order
    // and membership with its own keys, resolved against the live catalogue.
    if (collection && cat) {
      const ranked = collection.keys.map((k) => cat.byKey.get(k)).filter((r): r is RouteView => !!r);
      out = { ...base, results: ranked };
    }
    if (!favOnly) return out;
    return { ...out, results: out.results.filter((r) => favs.has(r.key)) };
  }, [cat, filters, favOnly, favs, collection]);
  const selected = (selectedKey && cat?.byKey.get(selectedKey)) || null;
  const excludedReasons = selected ? exclusionReasons(selected, filters) : [];
  const announced = useDebounced(load.status === 'ready' ? `${plural(result.results.length, 'route')} match` : '', 700);

  useEffect(() => setShown(PAGE_SIZE), [filters]);

  const detailVisible = !!selected && (isMobile ? mobileDetail : true);
  const padding: Padding = isMobile
    ? { top: 24, right: 24, bottom: 24, left: 24 }
    : { top: 48, right: selected ? parseInt(tokens.detailWidth) + 40 : 64, bottom: 48, left: 48 };

  const requestFit = (bbox: FitRequest['bbox'] | null) => {
    if (bbox) setFit({ bbox, nonce: ++nonce.current });
  };

  const openRoute = useCallback(
    (r: RouteView, from: HTMLElement | null) => {
      opener.current = from;
      setSelectedKey(r.key);
      // At tablet widths the detail panel would cover the map beside the rail.
      if (isTablet) setRailOpen(false);
      requestFit(r.bbox);
      if (isMobile) setMobileDetail(true);
      requestAnimationFrame(() => detailHeading.current?.focus());
    },
    [isMobile, isTablet],
  );

  const onMapSelect = useCallback(
    (key: string) => {
      opener.current = null;
      setSelectedKey(key);
      if (isTablet) setRailOpen(false);
      const r = cat?.byKey.get(key);
      if (r) requestFit(r.bbox);
      const i = result.results.findIndex((x) => x.key === key);
      if (i >= 0) setShown((s) => Math.max(s, i + 1));
      if (isMobile) {
        setSheetOpen(false);
      } else {
        setCardFocus({ key, nonce: ++nonce.current });
      }
    },
    [cat, result.results, isMobile, isTablet],
  );

  const clearSelection = () => {
    setSelectedKey(null);
    setMobileDetail(false);
    setCursorKm(null);
  };

  const closeDetail = useCallback(() => {
    if (isMobile) {
      setMobileDetail(false);
    } else {
      setSelectedKey(null);
    }
    setCursorKm(null);
    const el = opener.current;
    requestAnimationFrame(() => {
      if (el && el.isConnected) el.focus();
      else if (selectedKey) document.querySelector<HTMLElement>(`[data-route-key="${CSS.escape(selectedKey)}"]`)?.focus();
    });
  }, [isMobile, selectedKey]);

  const onSearchChosen = (next: Filters) => {
    setFilters(next);
    if (cat) {
      const matches = applyFilters(cat.routes, next).results.slice(0, 200);
      requestFit(unionBBox(matches.map((r) => r.bbox)));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || aboutOpen) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="listbox"], [role="combobox"]')) return;
      if (detailVisible) closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailVisible, closeDetail, aboutOpen]);

  // The full-screen mobile detail is modal: keep the page behind it out of tab order.
  useEffect(() => {
    const el = shellMain.current;
    if (!el) return;
    if (isMobile && detailVisible) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [isMobile, detailVisible]);

  useEffect(() => {
    if (mapStatus === 'unavailable' && isMobile) setSheetOpen(true);
  }, [mapStatus, isMobile]);

  const cursor: LonLat | null = useMemo(
    () => (selected && cursorKm != null && selected.km > 0 ? pointAtFraction(selected.line, cursorKm / selected.km) : null),
    [selected, cursorKm],
  );

  const rail = (
    <RailContent
      load={load}
      filters={filters}
      setFilters={setFilters}
      onSearchChosen={onSearchChosen}
      index={index}
      result={result}
      selectedKey={selectedKey}
      shown={shown}
      setShown={setShown}
      openRoute={openRoute}
      setHoverKey={setHoverKey}
      cardFocus={cardFocus}
      showLegend={isMobile}
      favorites={favs}
      favoriteNames={favNames}
      onRemoveStale={removeStaleFavorites}
      favOnly={favOnly}
      setFavOnly={setFavOnly}
      onToggleFavorite={onToggleFavorite}
      collections={collections}
      collection={collection}
      onOpenCollection={(id) => {
        setCollectionId(id);
        setShown(PAGE_SIZE);
        if (isMobile) setSheetOpen(true);
      }}
      onCloseCollection={() => setCollectionId(null)}
    />
  );

  const detail = selected ? (
    <RouteDetail
      ref={detailHeading}
      route={selected}
      home={filters.home}
      allWindows={cat?.windows ?? []}
      allRoutes={cat?.routes ?? EMPTY_POOL}
      generated={selected.catalog === 'linked' ? cat?.meta.linkedGenerated : cat?.meta.routesGenerated}
      excludedReasons={excludedReasons}
      backLabel={isMobile ? 'Back to results' : 'Close details'}
      favorite={favs.has(selected.key)}
      offerCompactLink={isMobile || coarsePointer}
      onBack={closeDetail}
      onOpen={openRoute}
      onToggleFavorite={onToggleFavorite}
      onShowOnMap={
        isMobile && mapStatus !== 'unavailable'
          ? () => {
              setMobileDetail(false);
              setSheetOpen(false);
              requestFit(selected.bbox);
            }
          : undefined
      }
      onCursorKm={setCursorKm}
    />
  ) : null;

  return (
    <div className={css({ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
      <div ref={shellMain} className={css({ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 })}>
        <header
          className={css({
            height: tokens.topBar,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: `0 ${isMobile ? tokens.space.lg : tokens.space.x3}`,
            paddingTop: 'env(safe-area-inset-top)',
            borderBottom: `1px solid ${tokens.surfacePressed}`,
            backgroundColor: tokens.canvas,
          })}
        >
          <div className={css({ display: 'flex', alignItems: 'baseline', gap: '12px', minWidth: 0 })}>
            <h1 className={css({ fontSize: '20px', lineHeight: '28px', fontWeight: 700, margin: 0, whiteSpace: 'nowrap' })}>FunRoads NL</h1>
            {!isMobile ? (
              <span className={css({ fontSize: '14px', color: tokens.hairlineMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>
                Legal, enjoyable Dutch roads · pinned data from {formatDate(cat?.meta.routesGenerated)}
              </span>
            ) : null}
          </div>
          <div className={css({ display: 'flex', gap: '8px', flexShrink: 0, whiteSpace: 'nowrap' })}>
            {isTablet ? (
              <Button
                kind={BKIND.secondary}
                shape={SHAPE.pill}
                size={SIZE.compact}
                aria-expanded={railOpen}
                aria-controls="discovery-rail"
                onClick={() => setRailOpen((o) => !o)}
                overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
              >
                <span style={{ whiteSpace: 'nowrap' }}>{railOpen ? 'Hide list' : 'Show list'}</span>
              </Button>
            ) : null}
            <Button kind={BKIND.secondary} shape={SHAPE.pill} size={SIZE.compact} onClick={() => setAboutOpen(true)} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
              <span style={{ whiteSpace: 'nowrap' }}>About the data</span>
            </Button>
          </div>
        </header>

        <main
          className={css({
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            position: 'relative',
          })}
        >
          {!isMobile && (railOpen || !isTablet) ? (
            <aside
              id="discovery-rail"
              aria-label="Discover routes"
              className={css({
                width: isTablet ? '340px' : tokens.railWidth,
                flex: 'none',
                overflowY: 'auto',
                padding: `${tokens.space.sm} ${tokens.space.x2} ${tokens.space.x2}`,
                borderRight: `1px solid ${tokens.surfacePressed}`,
                backgroundColor: tokens.canvas,
              })}
            >
              {rail}
            </aside>
          ) : null}

          <div className={css({ flex: 1, minHeight: isMobile ? '120px' : 0, position: 'relative', backgroundColor: tokens.canvasSofter })}>
            <MapView
              ranked={result.results}
              contextPool={cat?.routes ?? EMPTY_POOL}
              selected={selected}
              hoverKey={hoverKey}
              fit={fit}
              padding={padding}
              reducedMotion={reducedMotion}
              cursor={cursor}
              onSelect={onMapSelect}
              onStatus={setMapStatus}
            />
            <MapStatusBanner status={mapStatus} />
            {!isMobile ? (
              <div className={css({ position: 'absolute', right: selected ? `calc(${tokens.detailWidth} + 24px)` : '16px', bottom: '40px' })}>
                <Legend />
              </div>
            ) : null}
            {!isMobile && selected ? (
              <section
                aria-label="Route details"
                className={css({
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  bottom: '36px',
                  width: `min(${tokens.detailWidth}, calc(100% - 24px))`,
                  overflowY: 'auto',
                  backgroundColor: tokens.canvas,
                  borderRadius: tokens.radiusCard,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.16)',
                  padding: tokens.space.x2,
                  zIndex: 2,
                })}
              >
                {detail}
              </section>
            ) : null}
          </div>

          {isMobile ? (
            <section
              aria-label="Routes"
              className={css({
                flex: 'none',
                height: mapStatus === 'unavailable' ? '100%' : sheetOpen ? '68%' : '132px',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: tokens.canvas,
                borderTopLeftRadius: tokens.radiusCard,
                borderTopRightRadius: tokens.radiusCard,
                boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
                transition: 'height 200ms ease',
                paddingBottom: 'env(safe-area-inset-bottom)',
              })}
            >
              <div className={css({ padding: `${tokens.space.md} ${tokens.space.lg}`, display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' })}>
                <div className={css({ flex: 1, minWidth: 0 })}>
                  <div className={css({ fontSize: '16px', fontWeight: 700 })}>
                    {load.status === 'ready' ? plural(result.results.length, 'route') : load.status === 'loading' ? 'Loading routes…' : 'Routes unavailable'}
                  </div>
                  <div className={css({ fontSize: '14px', color: tokens.hairlineMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>
                    {selected ? `Selected: ${selected.name}` : filters.scope === 'nearby' ? `Within ${filters.radiusKm} km straight-line of ${filters.home}` : 'All Netherlands'}
                  </div>
                </div>
                {selected ? (
                  <Button size={SIZE.compact} shape={SHAPE.pill} onClick={(e) => openRoute(selected, e.currentTarget as HTMLElement)} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>
                    Details
                  </Button>
                ) : null}
                {selected ? (
                  <Button
                    kind={BKIND.secondary}
                    size={SIZE.compact}
                    shape={SHAPE.circle}
                    aria-label="Clear selection and show all routes"
                    title="Clear selection"
                    onClick={clearSelection}
                    overrides={{ BaseButton: { style: { minHeight: '44px', minWidth: '44px' } } }}
                  >
                    <span aria-hidden="true">✕</span>
                  </Button>
                ) : null}
                {mapStatus !== 'unavailable' ? (
                  <Button
                    kind={BKIND.secondary}
                    size={SIZE.compact}
                    shape={SHAPE.pill}
                    aria-expanded={sheetOpen}
                    aria-controls="sheet-body"
                    onClick={() => setSheetOpen((o) => !o)}
                    overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
                  >
                    {sheetOpen ? 'Show map' : 'Filters & list'}
                  </Button>
                ) : null}
              </div>
              <div id="sheet-body" className={css({ flex: 1, overflowY: 'auto', padding: `0 ${tokens.space.lg} ${tokens.space.lg}` })}>
                {rail}
              </div>
            </section>
          ) : null}
        </main>
      </div>

      {isMobile && detailVisible ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-heading"
          className={css({
            position: 'fixed',
            inset: 0,
            zIndex: 20,
            backgroundColor: tokens.canvas,
            overflowY: 'auto',
            padding: `calc(${tokens.space.lg} + env(safe-area-inset-top)) ${tokens.space.lg} calc(${tokens.space.lg} + env(safe-area-inset-bottom))`,
          })}
        >
          {detail}
        </div>
      ) : null}

      <div className="fr-visually-hidden" aria-live="polite" aria-atomic="true">
        {announced}
      </div>

      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} role={ROLE.dialog} autoFocus closeable>
        <ModalHeader>About the data</ModalHeader>
        <ModalBody>
          <AboutText cat={cat} />
        </ModalBody>
        <ModalFooter>
          <ModalButton shape={SHAPE.pill} onClick={() => setAboutOpen(false)}>
            Close
          </ModalButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function MapStatusBanner({ status }: { status: MapStatus }) {
  const [css] = useStyletron();
  if (status === 'ready' || status === 'loading') return null;
  const text =
    status === 'unavailable'
      ? 'The map could not start on this device. Every route is in the list; route data © OpenStreetMap contributors (ODbL), Rijkswaterstaat, NDW, AHN/PDOK, CBS.'
      : status === 'basemap-failed'
        ? 'Basemap tiles could not load, so routes are drawn on a plain background. The list still has every route.'
        : 'Some map tiles failed to load. The list still has every route.';
  return (
    <div role="status" className={css({ position: 'absolute', top: '12px', left: '12px', right: '72px', maxWidth: '420px', zIndex: 1 })}>
      <Notice tone={status === 'unavailable' ? 'warning' : 'info'}>{text}</Notice>
    </div>
  );
}

function Legend() {
  return (
    <div
      style={{ background: '#fff', borderRadius: 16, padding: '10px 14px', boxShadow: '0 2px 8px rgba(0,0,0,0.16)', fontSize: 12, lineHeight: '20px', maxWidth: 260 }}
      aria-label="Map legend"
      role="group"
    >
      {(['circuit', 'linked-loop', 'linked-open', 'sprint'] as const).map((k) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KindGlyph kind={k} />
          <span>{k === 'circuit' ? 'Circuit' : k === 'linked-loop' ? 'Linked loop' : k === 'linked-open' ? 'Linked ride (ends elsewhere)' : 'Sprint'}</span>
        </div>
      ))}
      <div style={{ color: '#4b4b4b', marginTop: 4 }}>
        Dots mark every start. Up to {MAX_CONTEXT_LINES} top-ranked lines in view are drawn; the list has all. Tints only tell
        neighbouring routes apart; a route drawn beside a dark circuit runs along the same road. Select a route to see it alone.
        Start, finish and end labels mark route endpoints, not checked parking, meeting or turning places. L/R pins mark
        engaged corners; Cam, Bump and Bike pins mark a speed camera, speed bumps and roads busy with cyclists.
      </div>
    </div>
  );
}

interface RailProps {
  load: LoadState;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onSearchChosen: (f: Filters) => void;
  index: ReturnType<typeof buildSearchIndex>;
  result: ReturnType<typeof applyFilters>;
  selectedKey: string | null;
  shown: number;
  setShown: (fn: (n: number) => number) => void;
  openRoute: (r: RouteView, el: HTMLElement) => void;
  setHoverKey: (k: string | null) => void;
  cardFocus: { key: string; nonce: number } | null;
  showLegend: boolean;
  favorites: ReadonlySet<string>;
  favoriteNames: Record<string, string>;
  onRemoveStale: () => void;
  favOnly: boolean;
  setFavOnly: (on: boolean) => void;
  onToggleFavorite: (key: string) => void;
  collections: Collection[];
  collection: Collection | null;
  onOpenCollection: (id: string) => void;
  onCloseCollection: () => void;
}

function RailContent(p: RailProps) {
  const { load, filters, result } = p;
  const cat = load.catalogue;
  if (load.status === 'loading') {
    return (
      <div role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '24px 0' }}>
        <Spinner $size="32px" />
        <span>Loading route data{load.progress ? ` (${load.progress})` : ''}…</span>
      </div>
    );
  }
  if (load.status === 'error' || !cat) {
    return (
      <div style={{ paddingTop: 16 }}>
        <Notice tone="warning">
          <strong>Route data could not be loaded.</strong> {load.problems.join(' ')}
        </Notice>
      </div>
    );
  }
  const hasLinked = cat.counts['linked-open'] + cat.counts['linked-loop'] > 0;
  const liveFavorites = [...p.favorites].filter((k) => cat.byKey.has(k)).length;
  const stale = [...p.favorites].filter((k) => !cat.byKey.has(k));
  const staleNames = stale.map((k) => p.favoriteNames[k]).filter(Boolean);
  return (
    <div>
      {load.problems.length ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="warning">{load.problems.join(' ')}</Notice>
        </div>
      ) : null}
      {p.collection ? (
        <div style={{ marginTop: 12 }}>
          <Button
            kind={BKIND.secondary}
            shape={SHAPE.pill}
            size={SIZE.compact}
            onClick={p.onCloseCollection}
            overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
          >
            <span aria-hidden="true">←&nbsp;</span>All routes
          </Button>
          <SectionTitle $style={{ marginTop: '12px' }}>{p.collection.title}</SectionTitle>
          <Caption>{p.collection.description} A curated ranking; the filters below are paused while this list is open.</Caption>
        </div>
      ) : (
        <>
          <Controls
            filters={filters}
            onChange={p.setFilters}
            onSearchChosen={p.onSearchChosen}
            index={p.index}
            windows={cat.windows}
            typeCounts={result.typeCounts}
            hasLinked={hasLinked}
            areaCount={cat.areas.length}
          />
          {p.collections.length ? (
            <div style={{ marginTop: 20 }}>
              <SectionTitle>Curated lists</SectionTitle>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {p.collections.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => p.onOpenCollection(c.id)}
                      style={{
                        display: 'flex',
                        width: '100%',
                        textAlign: 'left',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        font: 'inherit',
                        color: tokens.ink,
                        backgroundColor: tokens.canvasSoft,
                        border: 'none',
                        borderRadius: tokens.radiusCard,
                        padding: `${tokens.space.md} ${tokens.space.lg}`,
                        cursor: 'pointer',
                        minHeight: '48px',
                      }}
                    >
                      <span>
                        <span style={{ display: 'block', fontSize: 16, lineHeight: '24px', fontWeight: 500 }}>{c.title}</span>
                        <span style={{ display: 'block', fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
                          {plural(c.keys.length, 'route')}
                        </span>
                      </span>
                      <span aria-hidden="true" style={{ color: tokens.hairlineMid, fontSize: 18 }}>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <div style={{ marginTop: 16 }}>
        <Checkbox
          checked={p.favOnly}
          onChange={(e) => p.setFavOnly(e.currentTarget.checked)}
          checkmarkType={CHECK_STYLE.toggle}
          overrides={{ Root: { style: { minHeight: '44px', alignItems: 'center' } } }}
        >
          Favorites only ({liveFavorites} saved)
        </Checkbox>
        {stale.length ? (
          <div style={{ marginTop: 8 }}>
            <Notice tone="info">
              {plural(stale.length, 'saved route')} {stale.length === 1 ? 'is' : 'are'} no longer in the catalogue after a data
              update{staleNames.length ? `: ${staleNames.join(', ')}` : ''}. Search for the road to find a similar route.
              <div style={{ marginTop: 8 }}>
                <Button
                  kind={BKIND.secondary}
                  shape={SHAPE.pill}
                  size={SIZE.compact}
                  onClick={p.onRemoveStale}
                  overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
                >
                  Remove from saved
                </Button>
              </div>
            </Notice>
          </div>
        ) : null}
      </div>
      <SectionTitle $style={{ fontSize: '20px', lineHeight: '28px', marginTop: '8px' }}>
        {p.collection ? `${p.collection.title} · ${plural(result.results.length, 'route')}` : plural(result.results.length, 'route')}
      </SectionTitle>
      {!p.collection && result.hiddenNoDistance ? (
        <Caption>
          {plural(result.hiddenNoDistance, 'circuit')} not shown: the data has no straight-line distance for national circuits, so
          they cannot join a nearby view. Switch to All Netherlands to see them.
        </Caption>
      ) : null}
      {!p.collection && result.hiddenNoDrive ? <Caption>{plural(result.hiddenNoDrive, 'route')} hidden because drive time is unknown.</Caption> : null}
      <div style={{ marginTop: 12 }}>
        {result.results.length ? (
          <ResultsList
            results={result.results}
            home={filters.home}
            selectedKey={p.selectedKey}
            shown={p.shown}
            favorites={p.favorites}
            onShowMore={() => p.setShown((n) => n + PAGE_SIZE)}
            onOpen={p.openRoute}
            onHover={p.setHoverKey}
            onToggleFavorite={p.onToggleFavorite}
            focusRequest={p.cardFocus}
          />
        ) : (
          <div style={{ background: tokens.canvasSoft, borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <p style={{ margin: '0 0 12px', fontSize: 16 }}>
              {p.collection
                ? p.favOnly
                  ? 'None of your saved routes is in this list.'
                  : 'Every route in this list was removed by a data update.'
                : !p.favOnly
                  ? 'No routes match these filters.'
                  : liveFavorites
                    ? `The current filters hide your ${plural(liveFavorites, 'saved route')}.`
                    : stale.length
                      ? 'None of your saved routes is in the current catalogue.'
                      : 'No favorites saved yet. Tap the star on a route to save it.'}
            </p>
            {p.collection ? (
              <Button
                shape={SHAPE.pill}
                onClick={() => {
                  p.setFavOnly(false);
                  p.onCloseCollection();
                }}
              >
                Show all routes
              </Button>
            ) : p.favOnly && !liveFavorites ? (
              <Button shape={SHAPE.pill} onClick={() => p.setFavOnly(false)}>
                Show all routes
              </Button>
            ) : (
              <Button
                shape={SHAPE.pill}
                onClick={() => {
                  p.setFavOnly(false);
                  p.setFilters(resetFilters(filters));
                }}
              >
                Reset filters
              </Button>
            )}
          </div>
        )}
      </div>
      {p.showLegend ? (
        <div style={{ marginTop: 16 }}>
          <Legend />
        </div>
      ) : null}
      <footer style={{ marginTop: 24, fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
        <p style={{ margin: '0 0 8px' }}>{SAFETY_NOTE}</p>
        <p style={{ margin: 0 }}>
          Road data snapshot from {formatDate(cat.meta.routesGenerated)}. Route data © OpenStreetMap contributors (ODbL), Rijkswaterstaat
          WKD &amp; NDW, AHN/PDOK, CBS. Map tiles © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors.
        </p>
      </footer>
    </div>
  );
}

function AboutText({ cat }: { cat: Catalogue | null }) {
  return (
    <div style={{ fontSize: 16, lineHeight: '24px' }}>
      <p>
        FunRoads scores Dutch roads with a fixed rubric (corners, flow, quiet, speed fit, elevation, surface, scenery) using
        pinned OpenStreetMap, speed-limit, traffic and elevation snapshots. It is not live road, closure, weather or traffic data.
      </p>
      {cat ? (
        <ul>
          <li>{cat.counts.circuit} national circuits (40–120 km target)</li>
          <li>
            {cat.counts['linked-open'] + cat.counts['linked-loop']} linked rides: {cat.counts['linked-open']} end elsewhere,{' '}
            {cat.counts['linked-loop']} return to start
          </li>
          <li>{cat.counts.sprint.toLocaleString('en-GB')} reversible sprints</li>
          <li>
            Road data snapshot from {formatDate(cat.meta.routesGenerated)} (circuits, sprints) and{' '}
            {formatDate(cat.meta.linkedGenerated)} (linked rides). Catalogues can be rebuilt from the same snapshot, which can
            remove saved routes.
          </li>
        </ul>
      ) : null}
      <p>
        <strong>Nearby</strong> is a 100 km straight-line view around Zaandam or Haarlem. It is not driving distance or reach
        time, and it never limits which roads were mined. National circuits have no straight-line distance in the data, and
        their reach time is modeled from Zaandam only.
      </p>
      <p>
        <strong>Access</strong> was sampled for weekday and weekend departures at 08:00 and 20:00 in summer and autumn. These are
        examples: check current signs and restrictions. Route start and end points are road-network points, not checked
        parking, meeting or turning places. The quiet score is a static traffic model, not live or time-specific traffic.
      </p>
      <p>
        <strong>Not available yet:</strong> town or postcode search and place names for linked-ride clusters.
        Elevation charts appear only where cached AHN samples exist.
      </p>
      <p style={{ fontSize: 14 }}>
        Sources: © OpenStreetMap contributors (ODbL); Rijkswaterstaat WKD and NDW; AHN via PDOK; CBS; roadcurvature.com for
        calibration. Map tiles by OpenFreeMap using OpenMapTiles. Interface built with Base Web and the open Inter typeface.
      </p>
    </div>
  );
}
