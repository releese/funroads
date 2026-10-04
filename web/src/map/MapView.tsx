import { memo, useEffect, useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { GeoJSONSource, Map as MLMap, StyleSpecification } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import type { LonLat } from '../data/raw';
import { stopPin, type Kind, type RouteView } from '../data/model';
import { DASH, visibleLines, type BBox } from './geo';
import { useLatest } from '../hooks';
import { KindLabel, RouteStats, SourceNotice } from '../components/ui';
import { DEFAULT_COUNTRY, type Country } from '../data/countries';

maplibregl.setWorkerUrl(workerUrl);

export type MapStatus = 'loading' | 'ready' | 'basemap-failed' | 'tiles-partial' | 'unavailable';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitRequest {
  bbox: BBox;
  nonce: number;
}

interface Props {
  country?: Country;
  ranked: RouteView[];
  /** Every catalogue route, used to draw circuits a selected route runs along (they may be filtered out of `ranked`). */
  contextPool: RouteView[];
  selected: RouteView | null;
  hoverKey: string | null;
  fit: FitRequest | null;
  padding: Padding;
  reducedMotion: boolean;
  cursor: LonLat | null;
  onSelect: (key: string) => void;
  onBlank: () => void;
  onStatus: (s: MapStatus) => void;
  onAttribution: (element: HTMLElement) => void;
  onInteract: () => void;
}

// OpenFreeMap: free, keyless vector tiles built from OpenStreetMap.
export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/positron';
export function routeAttribution(country: Country = DEFAULT_COUNTRY): string {
  if (country.sourceLinks) return `Routes: ${renderToStaticMarkup(<SourceNotice country={country} />)}`;
  return `Routes: ${country.attribution.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace('OpenStreetMap contributors', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors')}`;
}

const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'blank', type: 'background', paint: { 'background-color': '#f3f3f3' } }],
};

const OUR_SOURCES = new Set(['fr-lines', 'fr-points', 'fr-selected', 'fr-hover', 'fr-context']);
const OFFSET: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 8, ['*', ['get', 'off'], 1.5], 13, ['*', ['get', 'off'], 5]];
const KINDS: Kind[] = ['circuit', 'linked-loop', 'linked-open', 'sprint'];

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const lineFeature = (r: RouteView): GeoJSON.Feature => ({
  type: 'Feature',
  // `off` = runs along a national circuit: drawn beside it like a second rail
  // instead of on top of it, so both stay visible.
  properties: { key: r.key, kind: r.kind, color: r.color, off: r.sharesWith.length ? 1 : 0 },
  geometry: { type: 'LineString', coordinates: r.line },
});

function marker(cls: string, text: string, at: LonLat, title?: string): maplibregl.Marker {
  const el = document.createElement('div');
  el.className = `fr-marker ${cls}`;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  if (title) el.title = title;
  return new maplibregl.Marker({ element: el }).setLngLat(at);
}

const CHOOSER_MAX = 6;

/** A click that hits several routes asks which one, instead of picking whichever rendered first. */
export function chooserContent(routes: RouteView[], more: number, onPick: (key: string) => void, onClose: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fr-chooser';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Routes at this spot');
  const title = document.createElement('p');
  title.className = 'fr-chooser__title';
  title.textContent = `${routes.length + more} routes here`;
  el.append(title);
  for (const r of routes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-chooser__item';
    const name = document.createElement('span');
    name.className = 'fr-chooser__name';
    name.textContent = r.name;
    const kind = document.createElement('span');
    kind.className = 'fr-chooser__kind';
    kind.innerHTML = renderToStaticMarkup(<KindLabel kind={r.kind} color={r.color} />);
    const stats = document.createElement('span');
    stats.className = 'fr-chooser__stats';
    stats.innerHTML = renderToStaticMarkup(<RouteStats route={r} />);
    b.append(kind, name, stats);
    b.addEventListener('click', () => onPick(r.key));
    el.append(b);
  }
  if (more) {
    const p = document.createElement('p');
    p.className = 'fr-chooser__more';
    p.textContent = `and ${more} more; zoom in to separate them.`;
    el.append(p);
  }
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  });
  return el;
}

export function fitPadding(container: HTMLElement, requested: Padding): Padding {
  const p = { ...requested };
  const bounds = container.getBoundingClientRect();
  container.closest('main')?.querySelectorAll<HTMLElement>('[data-map-overlay]').forEach((overlay) => {
    const rect = overlay.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (overlay.dataset.mapOverlay === 'right') p.right = Math.max(p.right, bounds.right - rect.left + 12);
    else if (overlay.dataset.mapOverlay === 'left') p.left = Math.max(p.left, rect.right - bounds.left + 12);
    else p.bottom = Math.max(p.bottom, bounds.bottom - rect.top + 12);
  });
  const { clientWidth: w, clientHeight: h } = container;
  const fitX = p.left + p.right < w - 80;
  const fitY = p.top + p.bottom < h - 80;
  return {
    left: fitX ? p.left : 24,
    right: fitX ? p.right : Math.max(24, Math.min(p.right, w - 104)),
    top: fitY ? p.top : 24,
    bottom: fitY ? p.bottom : Math.max(24, Math.min(p.bottom, h - 104)),
  };
}

function MapViewImpl(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const cursorMarker = useRef<maplibregl.Marker | null>(null);
  const chooser = useRef<maplibregl.Popup | null>(null);
  const latest = useLatest(props);

  const closeChooser = () => {
    chooser.current?.remove();
    chooser.current = null;
  };

  const refreshLines = () => {
    const map = mapRef.current;
    const src = map?.getSource('fr-lines') as GeoJSONSource | undefined;
    if (!map || !src) return;
    const b = map.getBounds();
    const view: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const sel = latest.current.selected?.key;
    src.setData(fc(sel ? [] : visibleLines(latest.current.ranked, view).map(lineFeature)));
  };

  const refreshPoints = () => {
    const src = mapRef.current?.getSource('fr-points') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      fc(
        (latest.current.selected ? [] : latest.current.ranked).map((r) => ({
          type: 'Feature',
          properties: { key: r.key, kind: r.kind, color: r.color },
          geometry: { type: 'Point', coordinates: r.start },
        })),
      ),
    );
  };

  const refreshSelected = () => {
    const map = mapRef.current;
    const src = map?.getSource('fr-selected') as GeoJSONSource | undefined;
    if (!map || !src) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const r = latest.current.selected;
    src.setData(fc(r ? [lineFeature(r)] : []));
    const ctx = map.getSource('fr-context') as GeoJSONSource | undefined;
    if (ctx) {
      const pool = latest.current.contextPool;
      ctx.setData(
        fc(
          (r?.sharesWith ?? [])
            .map((o) => pool.find((x) => x.key === o.key))
            .filter((x): x is RouteView => !!x)
            .map(lineFeature),
        ),
      );
    }
    if (!r) return;
    const dash = DASH[r.kind];
    map.setPaintProperty('fr-selected-line', 'line-dasharray', dash ?? [1, 0]);
    const closes = r.kind === 'circuit' || r.kind === 'linked-loop';
    const add = (m: maplibregl.Marker) => markers.current.push(m.addTo(map));
    for (const c of r.profile.corners) add(marker('fr-marker--corner', c.dir, [c.lon, c.lat], `Corner ${c.dir}, radius ${c.r} m`));
    for (const s of r.profile.stops) add(marker('fr-marker--stop', stopPin(s.type), [s.lon, s.lat], s.note));
    if (!closes) add(marker('fr-marker--end', 'End', r.end));
    add(marker('', closes ? 'Start · finish' : 'Start', r.start));
  };

  const refreshHover = () => {
    const src = mapRef.current?.getSource('fr-hover') as GeoJSONSource | undefined;
    if (!src) return;
    const { hoverKey, ranked, selected } = latest.current;
    const r = hoverKey && hoverKey !== selected?.key ? ranked.find((x) => x.key === hoverKey) : undefined;
    src.setData(fc(r ? [lineFeature(r)] : []));
  };

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: BASEMAP_URL,
        bounds: (props.country ?? DEFAULT_COUNTRY).bounds,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        clickTolerance: 8,
      });
    } catch {
      latest.current.onStatus('unavailable');
      return;
    }
    mapRef.current = map;
    const updatePinDensity = () => { el.dataset.detailPins = map.getZoom() >= 12 ? 'true' : 'false'; };
    updatePinDensity();
    map.on('zoomend', updatePinDensity);
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: routeAttribution(props.country) }), 'bottom-left');
    const attribution = el.querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib')!;
    // Reuse MapLibre's live attribution element in the shared information popover.
    attribution.hidden = true;
    latest.current.onAttribution(attribution.querySelector<HTMLElement>('.maplibregl-ctrl-attrib-inner')!);
    map.on('dragstart', () => latest.current.onInteract());

    let usingFallback = false;
    let styleReady = false;
    const fallback = () => {
      if (usingFallback) return;
      usingFallback = true;
      map.setStyle(BLANK_STYLE);
      latest.current.onStatus('basemap-failed');
    };
    const styleTimer = window.setTimeout(() => {
      if (!styleReady) fallback();
    }, 10000);

    map.on('error', (e) => {
      const sourceId = 'sourceId' in e && typeof e.sourceId === 'string' ? e.sourceId : null;
      if (!styleReady) fallback();
      else if (sourceId && !OUR_SOURCES.has(sourceId) && !usingFallback) latest.current.onStatus('tiles-partial');
    });

    map.on('style.load', () => {
      styleReady = true;
      window.clearTimeout(styleTimer);
      const empty = fc([]);
      for (const id of OUR_SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: empty });
      for (const kind of KINDS) {
        const dash = DASH[kind];
        map.addLayer({
          id: `fr-lines-${kind}`,
          type: 'line',
          source: 'fr-lines',
          filter: ['==', ['get', 'kind'], kind],
          layout: { 'line-cap': dash ? 'round' : 'butt', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 12, 3],
            'line-opacity': kind === 'circuit' ? 0.8 : 0.85,
            ...(kind === 'circuit' ? {} : { 'line-offset': OFFSET }),
            ...(dash ? { 'line-dasharray': dash } : {}),
          },
        });
      }
      map.addLayer({
        id: 'fr-points',
        type: 'circle',
        source: 'fr-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.5, 9, 2.5, 12, 5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.5],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 10, 0.9],
        },
      });
      // Circuits the selected route runs along, drawn faintly underneath it.
      map.addLayer({
        id: 'fr-context-line',
        type: 'line',
        source: 'fr-context',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#8a8a8a',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 7],
          'line-opacity': 0.45,
        },
      });
      map.addLayer({
        id: 'fr-hover-line',
        type: 'line',
        source: 'fr-hover',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 4 },
      });
      map.addLayer({
        id: 'fr-selected-casing',
        type: 'line',
        source: 'fr-selected',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff', 'line-width': 10 },
      });
      map.addLayer({
        id: 'fr-selected-line',
        type: 'line',
        source: 'fr-selected',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-width': 5 },
      });
      refreshPoints();
      refreshLines();
      refreshSelected();
      refreshHover();
      if (!usingFallback) latest.current.onStatus('ready');
    });

    const clickable = [...KINDS.map((k) => `fr-lines-${k}`), 'fr-points', 'fr-selected-line'];
    map.on('click', (e) => {
      if (!map.getLayer('fr-points')) return;
      latest.current.onInteract();
      // A click dismisses one layer. MapLibre suppresses clicks after a drag.
      if (chooser.current?.isOpen()) {
        closeChooser();
        return;
      }
      const pad = window.matchMedia('(pointer: coarse), (max-width: 767.98px)').matches ? 22 : 10;
      const hits = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: clickable },
      );
      closeChooser();
      const keys = [...new Set(hits.map((h) => h.properties?.key).filter((k): k is string => typeof k === 'string'))];
      if (!keys.length) latest.current.onBlank();
      if (keys.length === 1 && keys[0] === latest.current.selected?.key) return;
      if (keys.length === 1) latest.current.onSelect(keys[0]);
      if (keys.length < 2) return;
      const routes = keys
        .map((k) => latest.current.ranked.find((r) => r.key === k))
        .filter((r): r is RouteView => !!r);
      const shownRoutes = routes.slice(0, CHOOSER_MAX);
      const pick = (key: string) => {
        closeChooser();
        latest.current.onSelect(key);
      };
      const close = () => {
        closeChooser();
        map.getCanvas().focus();
      };
      chooser.current = new maplibregl.Popup({ className: 'fr-route-popup', closeButton: true, closeOnClick: false, maxWidth: 'none', focusAfterOpen: true })
        .setLngLat(e.lngLat)
        .setDOMContent(chooserContent(shownRoutes, routes.length - shownRoutes.length, pick, close))
        .addTo(map);
      chooser.current.on('close', () => { chooser.current = null; });
    });
    map.on('mousemove', (e) => {
      if (!map.getLayer('fr-points')) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: clickable });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
    });
    map.on('moveend', refreshLines);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return () => {
      window.clearTimeout(styleTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Recreate only for a different country; other props use imperative updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.country?.id]);
  useEffect(() => {
    refreshPoints();
    refreshLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ranked]);

  useEffect(() => {
    closeChooser();
    refreshSelected();
    refreshPoints();
    refreshLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected]);

  useEffect(refreshHover, [props.hoverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit only on an explicit request (selection or search choice), never on filter changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.fit) return;
    const [w, s, e, n] = props.fit.bbox;
    // Browse/detail overlays may have changed in the same render.
    map.resize();
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: fitPadding(map.getContainer(), latest.current.padding), duration: latest.current.reducedMotion ? 0 : 700, maxZoom: 14 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fit?.nonce]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.cursor) {
      cursorMarker.current?.remove();
      cursorMarker.current = null;
      return;
    }
    if (!cursorMarker.current) cursorMarker.current = marker('fr-marker--cursor', '', props.cursor).addTo(map);
    else cursorMarker.current.setLngLat(props.cursor);
  }, [props.cursor]);

  return (
    <div
      ref={container}
      role="region"
      aria-label="Route map. Every route shown here is also in the results list."
      style={{ position: 'absolute', inset: 0 }}
    />
  );
}

export const MapView = memo(MapViewImpl);
