import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStyletron } from 'baseui';
import { Button, KIND as BKIND, SHAPE, SIZE } from 'baseui/button';
import { Spinner } from 'baseui/spinner';
import { Modal, ModalBody, ModalHeader, ModalFooter, ModalButton } from 'baseui/modal';
import { Popover, PLACEMENT } from 'baseui/popover';
import type { LonLat } from '../data/raw';
import { buildCatalogue, buildCollections, type Catalogue, type Collection, type RouteView } from '../data/model';
import { applyFilters, DEFAULT_FILTERS, exclusionReasons, resetFilters, type Filters } from '../data/filters';
import { loadFavoriteNames, loadFavorites, saveFavoriteNames, saveFavorites, toggleFavorite } from '../data/favorites';
import { buildSearchIndex } from '../data/search';
import { loadAll } from '../data/load';
import { belongsToCountry, countryFromLocation, type Country } from '../data/countries';
import { displayName, formatDate, plural } from '../data/format';
import { MapView, type FitRequest, type MapStatus, type Padding } from '../map/MapView';
import { pointAtFraction, unionBBox, MAX_CONTEXT_LINES } from '../map/geo';
import { useDebounced, useMediaQuery } from '../hooks';
import { MQ, tokens } from '../theme';
import { closeSurfaceLocation, openSurfaceLocation, readRouteLocation, writeRouteLocation } from '../navigation';
import { PwaStatus } from './PwaStatus';
import { Controls } from './Controls';
import { CountryPicker, DiscoveryControls, RouteTypeChoices } from './DiscoveryControls';
import { ResultsList, PAGE_SIZE } from './Results';
import { RouteDetail } from './RouteDetail';
import { Caption, Disclosure, KindGlyph, KindLabel, Notice, RouteStats, SAFETY_NOTE, SectionTitle, StatIcon, SourceNotice } from './ui';

interface LoadState {
  status: 'loading' | 'ready' | 'error';
  catalogue: Catalogue | null;
  problems: string[];
  progress: string;
  retryable: boolean;
}

const EMPTY_POOL: RouteView[] = [];

export function App({ dataBase, country = countryFromLocation() }: { dataBase: string; country?: Country }) {
  const [css] = useStyletron();
  const isMobile = useMediaQuery(MQ.mobile);
  const reducedMotion = useMediaQuery(MQ.reducedMotion);
  const narrowWorkspace = useMediaQuery(MQ.narrowWorkspace);
  const shortViewport = useMediaQuery(MQ.shortViewport);

  const [load, setLoad] = useState<LoadState>({ status: 'loading', catalogue: null, problems: [], progress: '', retryable: false });
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, home: country.homes[0] }));
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    const key = readRouteLocation().key;
    return key && belongsToCountry(key, country) ? key : null;
  });
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(() => readRouteLocation().detail);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [mapAttribution, setMapAttribution] = useState<HTMLElement | null>(null);
  const [cursorKm, setCursorKm] = useState<number | null>(null);
  const [favs, setFavs] = useState<Set<string>>(() => loadFavorites());
  const [favOnly, setFavOnly] = useState(false);
  const [favNames, setFavNames] = useState<Record<string, string>>(() => loadFavoriteNames());
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [saveFeedback, setSaveFeedback] = useState('');

  const onToggleFavorite = useCallback((key: string) => {
    const next = toggleFavorite(favs, key);
    const persisted = saveFavorites(next);
    setFavs(next);
    setSaveFeedback(persisted ? next.has(key) ? 'Route saved.' : 'Route removed from saved.'
      : 'Browser storage is unavailable. Saved changes last only for this session.');
  }, [favs]);

  const opener = useRef<HTMLElement | null>(null);
  const sheetHandle = useRef<HTMLButtonElement>(null);
  const sheetBody = useRef<HTMLDivElement>(null);
  const browseScroll = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const shellMain = useRef<HTMLDivElement>(null);
  const nonce = useRef(0);
  const dismissOnly = useRef(false);
  const returningKey = useRef<string | null>(null);

  useEffect(() => {
    if (!saveFeedback) return;
    const timer = setTimeout(() => setSaveFeedback(''), 3000);
    return () => clearTimeout(timer);
  }, [saveFeedback]);

  useEffect(() => {
    const restore = () => {
      if (returningKey.current) {
        writeRouteLocation(returningKey.current, false);
        returningKey.current = null;
      }
      const route = readRouteLocation();
      const returningFromDetail = !!document.getElementById('detail-heading') && !route.detail;
      setSelectedKey(route.key);
      setDetailOpen(route.detail);
      setLegendOpen(false);
      setFiltersOpen(window.history.state?.funroadsSurface === 'filters');
      setCursorKm(null);
      if (returningFromDetail) requestAnimationFrame(() => {
        restoreDetailFocus(opener.current, route.key);
      });
    };
    window.addEventListener('popstate', restore);
    window.addEventListener('hashchange', restore);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hashchange', restore);
    };
  }, []);

  useEffect(() => {
    setLegendOpen(false);
  }, [isMobile, narrowWorkspace]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading', catalogue: null, problems: [], progress: '', retryable: false });
    loadAll(dataBase, (loaded, total) => {
      if (controller.signal.aborted) return;
      const mb = (n: number) => (n / 1e6).toFixed(1);
      setLoad((s) => ({ ...s, progress: total ? `${mb(loaded)} of ${mb(total)} MB` : `${mb(loaded)} MB` }));
    }, country, controller.signal).then(({ routes, linked }) => {
      if (controller.signal.aborted) return;
      const problems: string[] = [];
      if (routes.error) problems.push(`Circuits and sprints could not be loaded (${routes.error}).`);
      if (linked.error) problems.push(`Linked rides could not be loaded (${linked.error}).`);
      const dropped = [...(routes.value?.dropped ?? []), ...(linked.value?.dropped ?? [])];
      if (dropped.length) problems.push(`${plural(dropped.length, 'record')} skipped because required fields were missing or malformed.`);
      if (!routes.value && !linked.value) {
        setLoad({ status: 'error', catalogue: null, problems, progress: '', retryable: true });
        return;
      }
      const catalogue = buildCatalogue(routes.value?.doc ?? null, linked.value?.doc ?? null, country);
      setLoad({ status: 'ready', catalogue, problems, progress: '', retryable: !!(routes.error || linked.error) });
    });
    return () => {
      controller.abort();
    };
  }, [dataBase, reloadToken, country.id]);

  useEffect(() => {
    setFilters({ ...DEFAULT_FILTERS, home: country.homes[0] });
    setCollectionId(null);
    setHoverKey(null);
    setCursorKm(null);
    setFit(null);
    const key = readRouteLocation().key;
    const validKey = key && belongsToCountry(key, country) ? key : null;
    setSelectedKey(validKey);
    setDetailOpen(!!validKey && readRouteLocation().detail);
  }, [country.id]);

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
    const next = new Set([...favs].filter((k) => !belongsToCountry(k, country) || cat.byKey.has(k)));
    setFavs(next);
    const persisted = saveFavorites(next);
    setSaveFeedback(persisted ? 'Unavailable routes removed from saved.'
      : 'Browser storage is unavailable. Saved changes last only for this session.');
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
  const excludedReasons = selected
    ? collection
      ? collection.keys.includes(selected.key) ? [] : ['It is not in this curated list']
      : exclusionReasons(selected, filters)
    : [];
  if (selected && favOnly && !favs.has(selected.key)) excludedReasons.push('It is not saved, so Favorites only hides it');
  const announced = useDebounced(load.status === 'ready' ? `${plural(result.results.length, 'route')} match` : '', 700);

  useEffect(() => setShown(PAGE_SIZE), [filters, favOnly, collectionId]);

  const detailVisible = !!selected && detailOpen;
  const padding: Padding = { top: 72, right: 64, bottom: selected && !detailVisible ? isMobile ? 224 : 168 : 76, left: 24 };

  const requestFit = (bbox: FitRequest['bbox'] | null) => {
    if (bbox) setFit({ bbox, nonce: ++nonce.current });
  };

  useEffect(() => {
    if (cat && selectedKey) requestFit(cat.byKey.get(selectedKey)?.bbox ?? null);
    // Fit a deep-linked route when its catalogue first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat]);

  const openRoute = useCallback(
    (r: RouteView, from: HTMLElement | null) => {
      opener.current = from;
      setSelectedKey(r.key);
      if (!readRouteLocation().detail) writeRouteLocation(r.key, false);
      writeRouteLocation(r.key, true, true);
      requestFit(r.bbox);
      setDetailOpen(true);
      if (isMobile) setSheetOpen(false);
      setLegendOpen(false);
      requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
    },
    [isMobile],
  );

  const onMapSelect = useCallback(
    (key: string) => {
      opener.current = null;
      setSelectedKey(key);
      writeRouteLocation(key, false);
      setDetailOpen(false);
      const r = cat?.byKey.get(key);
      if (r) requestFit(r.bbox);
      const i = result.results.findIndex((x) => x.key === key);
      if (i >= 0) setShown((s) => Math.max(s, i + 1));
      if (isMobile) setSheetOpen(false);
      setHoverKey(null);
    },
    [cat, result.results, isMobile],
  );
  const browseRoute = (route: RouteView, from: HTMLElement) => {
    if (mapStatus === 'unavailable') {
      openRoute(route, from);
      return;
    }
    opener.current = from;
    setSelectedKey(route.key);
    writeRouteLocation(route.key, false);
    setDetailOpen(false);
    setLegendOpen(false);
    setHoverKey(null);
    setCursorKm(null);
    if (isMobile) setSheetOpen(false);
    requestFit(route.bbox);
    if (isMobile) requestAnimationFrame(() => sheetHandle.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (sheetOpen && sheetBody.current) sheetBody.current.scrollTop = browseScroll.current;
  }, [sheetOpen]);

  const clearSelection = () => {
    setSelectedKey(null);
    writeRouteLocation(null, false);
    setDetailOpen(false);
    setCursorKm(null);
    setHoverKey(null);
  };

  const closeDetail = useCallback(() => {
    if (window.history.state?.funroadsDetail && readRouteLocation().detail) {
      returningKey.current = selectedKey;
      window.history.back();
      return;
    }
    setDetailOpen(false);
    writeRouteLocation(selectedKey, false);
    setCursorKm(null);
    const el = opener.current;
    requestAnimationFrame(() => {
      restoreDetailFocus(el, selectedKey);
    });
  }, [selectedKey]);

  const onSearchChosen = (next: Filters) => {
    setFilters(next);
    if (cat) {
      const matches = applyFilters(cat.routes, next).results.slice(0, 200);
      requestFit(unionBBox(matches.map((r) => r.bbox)));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || filtersOpen || legendOpen || (isMobile && detailVisible)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="listbox"], [role="combobox"]')) return;
      if (document.querySelector('[role="listbox"]') || t?.closest('.maplibregl-popup')) return;
      if (document.querySelector('[data-baseweb="popover"]')) return;
      if (detailVisible) closeDetail();
      else if (sheetOpen) {
        setSheetOpen(false);
        requestAnimationFrame(() => sheetHandle.current?.focus({ preventScroll: true }));
      }
      else if (selected) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailVisible, closeDetail, filtersOpen, legendOpen, isMobile, selected, sheetOpen]);

  // The inset mobile detail is modal: visible map edges remain background context.
  useEffect(() => {
    const el = shellMain.current;
    if (!el) return;
    if ((isMobile && detailVisible) || filtersOpen) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [isMobile, detailVisible, filtersOpen]);

  useEffect(() => {
    if (mapStatus === 'unavailable') setSheetOpen(true);
  }, [mapStatus]);

  const cursor: LonLat | null = useMemo(
    () => (selected && cursorKm != null && selected.km > 0 ? pointAtFraction(selected.line, cursorKm / selected.km) : null),
    [selected, cursorKm],
  );

  const rail = (
    <RailContent
      country={country}
      load={load}
      filters={filters}
      setFilters={setFilters}
      onSearchChosen={onSearchChosen}
      index={index}
      result={result}
      selectedKey={selectedKey}
      shown={shown}
      setShown={setShown}
      openRoute={browseRoute}
      setHoverKey={setHoverKey}
      showSearch
      onOpenFilters={() => { setLegendOpen(false); openSurfaceLocation('filters'); setFiltersOpen(true); }}
      onRetry={() => setReloadToken((n) => n + 1)}
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
        setSheetOpen(true);
      }}
      onCloseCollection={() => setCollectionId(null)}
    />
  );

  const detail = selected ? (
    <RouteDetail
      key={selected.key}
      ref={detailHeading}
      route={selected}
      country={country}
      home={filters.home}
      allRoutes={cat?.routes ?? EMPTY_POOL}
      generated={selected.catalog === 'linked' ? cat?.meta.linkedGenerated : cat?.meta.routesGenerated}
      excludedReasons={excludedReasons}
      favorite={favs.has(selected.key)}
      onClose={closeDetail}
      onOpen={openRoute}
      onToggleFavorite={onToggleFavorite}
      onCursorKm={setCursorKm}
    />
  ) : null;

  return (
    <div className={css({ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
      <div ref={shellMain} className={css({ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, isolation: 'isolate' })}>
        <header
          className={css({
            minHeight: '28px',
            pointerEvents: 'none',
            position: 'absolute',
            top: 'calc(8px + env(safe-area-inset-top))',
            left: '12px',
            right: '72px',
            zIndex: 4,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '0',
            backgroundColor: 'transparent',
          })}
        >
          <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, fontSize: isMobile ? '16px' : '20px', lineHeight: '24px', fontWeight: 700 })}>
            <h1 className={css({ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 'inherit', margin: 0, whiteSpace: 'nowrap' })}>FunRoads</h1>
            <CountryPicker country={country} />
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
          <div onPointerDownCapture={() => { dismissOnly.current = legendOpen || !!document.querySelector('[role="listbox"], [data-baseweb="popover"]'); }}
            className={css({ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative', backgroundColor: tokens.canvasSofter })}>
            <MapView
              country={country}
              ranked={result.results}
              contextPool={cat?.routes ?? EMPTY_POOL}
              selected={selected}
              hoverKey={hoverKey}
              fit={fit}
              padding={padding}
              reducedMotion={reducedMotion}
              cursor={cursor}
              onSelect={onMapSelect}
              onBlank={() => {
                if (legendOpen || dismissOnly.current) {
                  dismissOnly.current = false;
                  setLegendOpen(false);
                }
                else clearSelection();
              }}
              onStatus={setMapStatus}
              onAttribution={setMapAttribution}
              onInteract={() => { setLegendOpen(false); if (isMobile) setSheetOpen(false); }}
            />
            <MapStatusBanner status={mapStatus} country={country} />
            <div className={css({ position: 'absolute', top: 'calc(8px + env(safe-area-inset-top))', right: '10px', zIndex: 3 })}>
              <Popover isOpen={legendOpen} onClickOutside={() => setLegendOpen(false)}
                onClick={() => { if (isMobile) setSheetOpen(false); setLegendOpen((open) => !open); }}
                onEsc={() => setLegendOpen(false)} placement={PLACEMENT.bottomRight} returnFocus
                content={
                  <div className="fr-map-info-panel">
                    <Legend />
                    <div className="fr-map-info-sources" ref={(element) => {
                      if (element && mapAttribution) element.appendChild(mapAttribution);
                    }} />
                    <Disclosure title="App and data">
                      <PwaStatus country={country} engaged={!!selected || favs.size > 0} />
                      <AboutText cat={cat} country={country} />
                    </Disclosure>
                  </div>
                }>
                <Button kind={BKIND.tertiary} shape={SHAPE.circle} size={SIZE.compact}
                  aria-label="Map information" aria-expanded={legendOpen}
                  overrides={{ BaseButton: { props: { className: 'fr-map-info-button' }, style: {
                    minHeight: '44px', minWidth: '44px', backgroundColor: 'transparent', boxShadow: 'none',
                    ':hover': { backgroundColor: 'transparent' }, ':active': { backgroundColor: 'transparent' },
                  } } }}><span aria-hidden="true">i</span></Button>
              </Popover>
            </div>
            {!isMobile && selected && !detailVisible ? (
              <section aria-label="Selected route" data-map-overlay="bottom" className={`fr-route-preview ${css({ backgroundColor: tokens.canvas, borderRadius: tokens.radiusCard, padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.16)' })}`}>
                <KindLabel kind={selected.kind} color={selected.color} />
                <strong style={{ display: 'block', margin: '6px 0', fontSize: 18 }}>{selected.name}</strong>
                <RouteStats route={selected} home={filters.home} showScore />
                {excludedReasons.length ? <Caption>Selected route no longer matches these results.</Caption> : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button shape={SHAPE.default} size={SIZE.compact} onClick={(e) => openRoute(selected, e.currentTarget)} overrides={{ BaseButton: { style: { minHeight: '44px' } } }}>Details</Button>
                </div>
              </section>
            ) : null}
            {!isMobile && detailVisible ? (
              <section aria-label="Route details" key={selectedKey} className="fr-detail-panel" data-map-overlay="right">
                {detail}
              </section>
            ) : null}
          </div>
            <section
              aria-label="Routes"
              hidden={!isMobile && narrowWorkspace && detailVisible}
              data-map-overlay={!isMobile && sheetOpen ? 'left' : 'bottom'}
              className={`fr-browse-panel ${css({
                flex: 'none',
                position: 'absolute',
                bottom: 'calc(12px + env(safe-area-inset-bottom))',
                left: '12px',
                right: isMobile ? '12px' : 'auto',
                width: isMobile ? 'auto' : sheetOpen || mapStatus === 'unavailable'
                  ? selected && narrowWorkspace && mapStatus !== 'unavailable' ? 'min(26.25em, calc(100% - 404px))' : '26.25em'
                  : '15em',
                maxWidth: 'calc(100% - 24px)',
                maxHeight: 'calc(100% - 4.75em)',
                height: mapStatus === 'unavailable' || (sheetOpen && shortViewport) ? '100%'
                  : sheetOpen ? isMobile ? 'min(62%, 35em)' : '52em' : 'auto',
                fontSize: '1rem',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: tokens.canvas,
                borderTopLeftRadius: tokens.radiusCard,
                borderTopRightRadius: tokens.radiusCard,
                borderBottomLeftRadius: tokens.radiusCard,
                borderBottomRightRadius: tokens.radiusCard,
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                overflow: 'hidden',
                zIndex: 2,
              })}`}
            >
              <div className={css({ display: 'flex', flexDirection: 'column', flex: 'none' })}>
                {mapStatus !== 'unavailable' ? (
                  <button
                    ref={sheetHandle}
                    type="button"
                    className="fr-sheet-handle"
                    aria-expanded={sheetOpen}
                    aria-controls="sheet-body"
                    onClick={() => setSheetOpen((open) => !open)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d={sheetOpen ? 'M6 9l6 6 6-6' : 'M9 6h11M9 12h11M9 18h11'} />
                      {!sheetOpen ? <path d="M4 6h1M4 12h1M4 18h1" strokeWidth="3" strokeLinecap="round" /> : null}
                    </svg>
                    <span>{sheetOpen ? 'Close results' : selected ? 'Back to results' : 'Browse routes'}</span>
                  </button>
                ) : null}
                {isMobile && selected && !sheetOpen ? (
                  <div style={{ display: 'grid', gap: 12, padding: '8px 16px 16px' }}>
                    <div style={{ minWidth: 0 }}>
                      <KindLabel kind={selected.kind} color={selected.color} />
                      <strong style={{ display: 'block', fontSize: 16, lineHeight: '24px', overflowWrap: 'anywhere' }}>{selected.name}</strong>
                      <RouteStats route={selected} home={filters.home} showScore />
                      {excludedReasons.length ? <Caption>No longer matches these results.</Caption> : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size={SIZE.compact} shape={SHAPE.default} onClick={(e) => openRoute(selected, e.currentTarget)} overrides={{ BaseButton: { style: { minHeight: '44px', flex: 1 } } }}>Details</Button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div id="sheet-body" ref={sheetBody} hidden={!sheetOpen && mapStatus !== 'unavailable'}
                onScroll={(event) => { if (sheetOpen) browseScroll.current = event.currentTarget.scrollTop; }}
                className={css({ flex: 1, minHeight: 0, overflowY: 'auto', padding: `0 ${tokens.space.lg} ${tokens.space.lg}` })}>
                {rail}
              </div>
            </section>
        </main>
      </div>

      <Modal isOpen={isMobile && detailVisible} onClose={closeDetail} animate={false}
        overrides={{ Close: { style: { display: 'none' } },
          Dialog: { props: { 'aria-labelledby': 'detail-heading' }, style: {
            margin: 'calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom))',
            width: 'calc(100% - 24px)', maxWidth: '560px',
            height: 'calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
            overflow: 'hidden', borderRadius: tokens.radiusCard, padding: '0', transform: 'none', opacity: 1,
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          } },
          Root: { style: { overflow: 'hidden' } },
          DialogContainer: { style: { padding: '0', backgroundColor: 'rgba(0,0,0,0.16)', opacity: 1 } },
        }}>
        {isMobile && detailVisible ? detail : null}
      </Modal>

      <div className="fr-visually-hidden" aria-live="polite" aria-atomic="true">
        {announced}
      </div>
      {saveFeedback ? <div role="status" className="fr-save-feedback">{saveFeedback}</div> : null}

      <Modal isOpen={filtersOpen} onClose={() => { setFiltersOpen(false); closeSurfaceLocation(); }} name="Route filters" animate={!reducedMotion}
        overrides={{ Dialog: { props: { 'aria-labelledby': 'filters-heading' }, style: { maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', margin: '16px' } } }}>
        <ModalHeader id="filters-heading" $style={{ margin: '20px 20px 0', flex: 'none' }}>Route filters</ModalHeader>
        <ModalBody className="fr-scroll" $style={{ margin: '8px 20px 0', overflowY: 'auto', minHeight: 0 }}>
          {collectionId ? <Caption>Favorites applies to this list. Other filters apply when you return to all routes.</Caption> : null}
          {cat ? <Controls country={country} filters={filters} onChange={setFilters} onSearchChosen={onSearchChosen} index={index}
            windows={cat.windows} typeCounts={result.typeCounts} hasLinked={cat.counts['linked-open'] + cat.counts['linked-loop'] > 0} areaCount={cat.areas.length}
            favoritesOnly={favOnly} onFavoritesOnly={setFavOnly} favoriteCount={[...favs].filter((key) => cat.byKey.has(key)).length} /> : null}
        </ModalBody>
        <ModalFooter $style={{ padding: '12px 20px 16px', flex: 'none' }}>
          <ModalButton kind={BKIND.secondary} shape={SHAPE.default} onClick={() => { setFilters(resetFilters(filters)); setFavOnly(false); }}>Reset filters</ModalButton>
          <ModalButton shape={SHAPE.default} onClick={() => { setFiltersOpen(false); closeSurfaceLocation(); }}>Done</ModalButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function restoreDetailFocus(opener: HTMLElement | null, key: string | null) {
  const card = key ? document.querySelector<HTMLElement>(`[data-route-key="${CSS.escape(key)}"]`) : null;
  const target = [opener, card, document.querySelector<HTMLElement>('.fr-sheet-handle')]
    .find((element) => element?.isConnected && !element.closest('[hidden], [inert]'));
  target?.focus({ preventScroll: true });
}

function MapStatusBanner({ status, country }: { status: MapStatus; country: Country }) {
  const [css] = useStyletron();
  if (status === 'ready' || status === 'loading') return null;
  const text =
    status === 'unavailable'
      ? `The map could not start on this device. Every route is in the list; route data ${country.attribution}.`
      : status === 'basemap-failed'
        ? 'Basemap tiles could not load, so routes are drawn on a plain background. The list still has every route.'
        : 'Some map tiles failed to load. The list still has every route.';
  return (
    <div role="status" className={css({ position: 'absolute', top: '44px', left: '12px', right: '72px', maxWidth: '420px', zIndex: 1 })}>
      <Notice tone={status === 'unavailable' ? 'warning' : 'info'}>{text}</Notice>
    </div>
  );
}

function Legend() {
  return (
    <div
      style={{ fontSize: 12, lineHeight: '20px' }}
      aria-label="Map legend"
      role="group"
    >
      <strong style={{ display: 'block', marginBottom: 8 }}>Map legend</strong>
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
  country: Country;
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
  showSearch: boolean;
  onOpenFilters: () => void;
  onRetry: () => void;
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
          <strong>Route data for {p.country.name} could not be loaded.</strong> {load.problems.join(' ')}
        </Notice>
        <Button shape={SHAPE.default} onClick={p.onRetry} overrides={{ BaseButton: { style: { minHeight: '44px', marginTop: '12px' } } }}>Retry route data</Button>
      </div>
    );
  }
  const hasLinked = cat.counts['linked-open'] + cat.counts['linked-loop'] > 0;
  const liveFavorites = [...p.favorites].filter((k) => cat.byKey.has(k)).length;
  const stale = [...p.favorites].filter((k) => belongsToCountry(k, cat.country) && !cat.byKey.has(k));
  const staleNames = stale.map((k) => p.favoriteNames[k]).filter(Boolean).map(displayName);
  return (
    <div>
      {load.problems.length ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="warning">{load.problems.join(' ')}</Notice>
          {load.retryable ? (
            <Button shape={SHAPE.default} onClick={p.onRetry}
              overrides={{ BaseButton: { style: { minHeight: '44px', marginTop: '12px' } } }}>
              Retry route data
            </Button>
          ) : null}
        </div>
      ) : null}
      {p.collection ? (
        <div style={{ marginTop: 12 }}>
          <Button
            kind={BKIND.secondary}
            shape={SHAPE.default}
            size={SIZE.compact}
            onClick={p.onCloseCollection}
            overrides={{ BaseButton: { style: { minHeight: '44px' } } }}
          >
            <span aria-hidden="true">←&nbsp;</span>All routes
          </Button>
          <Button kind={BKIND.secondary} shape={SHAPE.default} size={SIZE.compact} onClick={p.onOpenFilters}
            overrides={{ BaseButton: { style: { minHeight: '44px', marginLeft: '8px' } } }}>Filters</Button>
          <SectionTitle $style={{ marginTop: '12px' }}>{p.collection.title}</SectionTitle>
          <Caption>{p.collection.description} Curated ranking; only Favorites applies. All routes restores your other filters.</Caption>
          {p.favOnly ? <Button kind={BKIND.secondary} shape={SHAPE.default} size={SIZE.compact} aria-label="Remove filter: Favorites only"
            onClick={() => p.setFavOnly(false)} overrides={{ BaseButton: { style: { minHeight: '44px', marginTop: '8px' } } }}>
            <StatIcon name="favorite" />Favorites only ×
          </Button> : null}
        </div>
      ) : (
        <>
          <DiscoveryControls
            country={cat.country}
            filters={filters}
            onChange={p.setFilters}
            onSearchChosen={p.onSearchChosen}
            index={p.index}
            windows={cat.windows}
            typeCounts={result.typeCounts}
            hasLinked={hasLinked}
            areaCount={cat.areas.length}
            onOpenFilters={p.onOpenFilters}
            favoritesOnly={p.favOnly}
            onFavoritesOnly={p.setFavOnly}
            showSearch={p.showSearch}
          />
        </>
      )}
      <div style={{ marginTop: stale.length ? 16 : 0 }}>
        {stale.length ? (
          <div style={{ marginTop: 8 }}>
            <Notice tone="info">
              {plural(stale.length, 'saved route')} {stale.length === 1 ? 'is' : 'are'} no longer in the catalogue after a data
              update{staleNames.length ? `: ${staleNames.join(', ')}` : ''}. Search for the road to find a similar route.
              <div style={{ marginTop: 8 }}>
                <Button
                  kind={BKIND.secondary}
                  shape={SHAPE.default}
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
      <SectionTitle $style={{ fontSize: '20px', lineHeight: '28px', marginTop: '20px' }}>
        {p.collection ? `${p.collection.title} · ${plural(result.results.length, 'route')}` : plural(result.results.length, 'route')}
      </SectionTitle>
      {!p.collection ? <RouteTypeChoices filters={filters} onChange={p.setFilters} hasLinked={hasLinked} /> : null}
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
                shape={SHAPE.default}
                onClick={() => {
                  p.setFavOnly(false);
                  p.onCloseCollection();
                }}
              >
                Show all routes
              </Button>
            ) : p.favOnly && !liveFavorites ? (
              <Button shape={SHAPE.default} onClick={() => p.setFavOnly(false)}>
                Show all routes
              </Button>
            ) : (
              <Button
                shape={SHAPE.default}
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
      {!p.collection && p.collections.length ? (
        <Disclosure title="Curated lists">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {p.collections.map((c) => <li key={c.id}>
              <Button kind={BKIND.secondary} shape={SHAPE.default} onClick={() => p.onOpenCollection(c.id)}
                overrides={{ BaseButton: { style: { minHeight: '48px', width: '100%', textAlign: 'left', justifyContent: 'space-between' } } }}>
                <span>{c.title}<span style={{ display: 'block', fontSize: 12 }}>{plural(c.keys.length, 'route')}</span></span>
                <span aria-hidden="true">›</span>
              </Button>
            </li>)}
          </ul>
        </Disclosure>
      ) : null}
      <footer style={{ marginTop: 24, fontSize: 12, lineHeight: '20px', color: tokens.hairlineMid }}>
        {cat.country.coverage ? <p>{cat.country.coverage}</p> : null}
        <p style={{ margin: '0 0 8px' }}>{SAFETY_NOTE}</p>
        <p style={{ margin: 0 }}>
          Road data snapshot from {formatDate(cat.meta.routesGenerated, cat.country.timezone)}. Route data <SourceNotice country={cat.country} />.
          {' '}Map tiles © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors.
        </p>
      </footer>
    </div>
  );
}

function AboutText({ cat, country }: { cat: Catalogue | null; country: Country }) {
  const hasCircuitDistances = cat?.routes.some((r) => r.catalog === 'circuit'
    && country.homes.some((home) => r.distanceKm?.[home] != null));
  return (
    <div style={{ fontSize: 16, lineHeight: '24px' }}>
      <p>
        FunRoads scores roads in {country.name} with a fixed rubric (corners, flow, quiet, speed fit, elevation, surface, scenery) using{' '}
        {country.sourceSummary}. It is not live road, closure, weather or traffic data.
      </p>
      {country.coverage ? <p><strong>{country.coverage}</strong></p> : null}
      {cat ? (
        <ul>
          <li>{cat.counts.circuit} {country.coverage ? 'pilot' : 'national'} circuits (40–120 km target)</li>
          <li>
            {cat.counts['linked-open'] + cat.counts['linked-loop']} linked rides: {cat.counts['linked-open']} end elsewhere,{' '}
            {cat.counts['linked-loop']} return to start
          </li>
          <li>{cat.counts.sprint.toLocaleString('en-GB')} reversible sprints</li>
          <li>
            Road data snapshot from {formatDate(cat.meta.routesGenerated, country.timezone)} (circuits, sprints) and{' '}
            {formatDate(cat.meta.linkedGenerated, country.timezone)} (linked rides). Catalogues can be rebuilt from the same snapshot, which can
            remove saved routes.
          </li>
        </ul>
      ) : null}
      <p>
        <strong>Nearby</strong> uses your chosen straight-line radius around {country.homes.join(' or ')}. It is not driving distance or reach
        time, and it never limits which roads were mined.
        {cat && cat.counts.circuit > 0 && !hasCircuitDistances ? ' Circuits have no straight-line distance in this catalogue.' : ''}
        {country.reachOrigin ? ` Circuit reach time is modeled from ${country.reachOrigin} only.` : ''}
        {!country.reachOrigin ? ' Home-to-start driving times are not modeled.' : ''}
      </p>
      <p>
        <strong>Access</strong> is based on sampled departures in {country.timezone}, not live permission.
        Check current signs and restrictions. Route start and end points are road-network points, not checked
        parking, meeting or turning places. {country.quietDescription}
      </p>
      <p>
        <strong>Not available yet:</strong> town or postcode search and place names for linked-ride clusters.
        Elevation charts appear only where the catalogue contains elevation samples.
      </p>
      <p style={{ fontSize: 14 }}>
        Sources: <SourceNotice country={country} />. Map tiles by OpenFreeMap using OpenMapTiles.
        Interface built with Base Web and the open Inter typeface.
      </p>
    </div>
  );
}
