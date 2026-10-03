export function readRouteLocation() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { key: params.get('route'), detail: params.get('detail') === '1' };
}

/** Hash navigation works offline and under the GitHub Pages project subpath. */
export function writeRouteLocation(key: string | null, detail: boolean, openDetail = false) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.slice(1));
  if (key) params.set('route', key);
  else params.delete('route');
  if (key && detail) params.set('detail', '1');
  else params.delete('detail');
  url.hash = params.toString();
  const state = { ...window.history.state };
  if (openDetail && !state.funroadsDetail) {
    window.history.pushState({ ...state, funroadsDetail: true }, '', url);
  } else {
    window.history.replaceState(state, '', url);
  }
}

export function openSurfaceLocation(surface: 'filters' | 'about') {
  window.history.pushState({ ...window.history.state, funroadsSurface: surface }, '', window.location.href);
}

export function closeSurfaceLocation() {
  if (window.history.state?.funroadsSurface) window.history.back();
}
