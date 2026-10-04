import type { RouteView } from './model';

/** A GPX track keeps the complete map geometry, without routing between sparse stops. */
export function gpxFile(route: Pick<RouteView, 'name' | 'line'>): File {
  const ns = 'http://www.topografix.com/GPX/1/1';
  const doc = document.implementation.createDocument(ns, 'gpx');
  doc.documentElement.setAttribute('version', '1.1');
  doc.documentElement.setAttribute('creator', 'FunRoads');
  const metadata = doc.documentElement.appendChild(doc.createElementNS(ns, 'metadata'));
  metadata.appendChild(doc.createElementNS(ns, 'name')).textContent = route.name;
  const track = doc.documentElement.appendChild(doc.createElementNS(ns, 'trk'));
  track.appendChild(doc.createElementNS(ns, 'name')).textContent = route.name;
  const segment = track.appendChild(doc.createElementNS(ns, 'trkseg'));
  for (const [lon, lat] of route.line) {
    const point = segment.appendChild(doc.createElementNS(ns, 'trkpt'));
    point.setAttribute('lat', String(lat));
    point.setAttribute('lon', String(lon));
  }
  const name = route.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'route';
  return new File(
    ['<?xml version="1.0" encoding="UTF-8"?>\n', new XMLSerializer().serializeToString(doc)],
    `funroads-${name}.gpx`, { type: 'application/gpx+xml' },
  );
}

export function canShareGpx(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

export async function exportGpx(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareGpx(file)) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return 'cancelled';
      // A denied or unavailable share target still leaves the standard file download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow the browser to consume the file before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return 'downloaded';
}
