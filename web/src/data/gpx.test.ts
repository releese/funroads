import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareGpx, exportGpx, gpxFile } from './gpx';

function text(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GPX tracks', () => {
  it.each<{ line: [number, number][] }>([
    { line: [[24.123456789, 59.123456789], [24.234567891, 59.234567891]] },
    { line: [[4.8, 52.4], [4.81, 52.41], [4.8, 52.4]] },
  ])('preserves every point, coordinate precision and existing loop closure', async ({ line }) => {
    const file = gpxFile({ name: 'Pärnu & <Road> "route"', line });
    const xml = new DOMParser().parseFromString(await text(file), 'application/xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.documentElement.namespaceURI).toBe('http://www.topografix.com/GPX/1/1');
    expect(xml.documentElement.getAttribute('version')).toBe('1.1');
    expect([...xml.documentElement.children].map((child) => child.localName)).toEqual(['metadata', 'trk']);
    expect(xml.querySelector('metadata > name')?.textContent).toBe('Pärnu & <Road> "route"');
    expect(xml.querySelector('trk > name')?.textContent).toBe('Pärnu & <Road> "route"');
    expect([...xml.querySelectorAll('trkpt')].map((point) => [
      Number(point.getAttribute('lon')), Number(point.getAttribute('lat')),
    ])).toEqual(line);
    expect(xml.querySelectorAll('trkseg')).toHaveLength(1);
    expect(xml.querySelectorAll('rte, wpt')).toHaveLength(0);
    expect(file.type).toBe('application/gpx+xml');
    expect(file.name).toBe('funroads-Pärnu & _Road_ _route_.gpx');
  });

  it('exports long routes without the Maps waypoint limit or mutating their geometry', async () => {
    const line: [number, number][] = Array.from({ length: 2000 }, (_, i) => [4 + i / 10000, 52 + i / 10000]);
    const original = structuredClone(line);
    const xml = new DOMParser().parseFromString(await text(gpxFile({ name: 'Route', line })), 'application/xml');
    expect(xml.querySelectorAll('trkpt')).toHaveLength(2000);
    expect(line).toEqual(original);
  });

  it('uses bounded, portable filenames, including blank and reserved names', () => {
    expect(gpxFile({ name: ' /\\:*?"<>|\n ', line: [] }).name).not.toMatch(/[<>:"/\\|?*\n]/);
    expect(gpxFile({ name: '  ', line: [] }).name).toBe('funroads-route.gpx');
    expect(gpxFile({ name: 'CON', line: [] }).name).toBe('funroads-CON.gpx');
    expect(gpxFile({ name: 'a'.repeat(500), line: [] }).name.length).toBeLessThan(140);
  });
});

describe('GPX handoff', () => {
  const file = gpxFile({ name: 'Route', line: [[4.8, 52.4], [4.9, 52.5]] });
  function setup(supported = true) {
    vi.useFakeTimers();
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn(() => supported);
    vi.stubGlobal('navigator', { share, canShare });
    const createObjectURL = vi.fn(() => 'blob:gpx');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(file.name);
      expect(this.href).toBe('blob:gpx');
      expect(this.isConnected).toBe(true);
    });
    return { share, canShare, createObjectURL, revokeObjectURL, click };
  }

  it('shares the file natively, never a URL or sampled waypoints', async () => {
    const mocks = setup();
    expect(canShareGpx(file)).toBe(true);
    expect(await exportGpx(file)).toBe('shared');
    expect(mocks.canShare).toHaveBeenCalledWith({ files: [file] });
    expect(mocks.share).toHaveBeenCalledWith({ files: [file] });
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
  });

  it('does nothing when native sharing is cancelled', async () => {
    const mocks = setup();
    mocks.share.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    expect(await exportGpx(file)).toBe('cancelled');
    expect(mocks.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.click).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'unavailable', 'denied', 'capability-error'])('downloads when sharing is %s', async (reason) => {
    const mocks = setup(reason !== 'unsupported');
    if (reason === 'unavailable') vi.stubGlobal('navigator', {});
    if (reason === 'denied') mocks.share.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    if (reason === 'capability-error') mocks.canShare.mockImplementation(() => { throw new Error('Blocked'); });
    expect(await exportGpx(file)).toBe('downloaded');
    expect(mocks.click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:gpx');
  });

  it('cleans up the download URL and link even if the browser refuses the click', async () => {
    const mocks = setup(false);
    mocks.click.mockImplementation(() => { throw new Error('Download blocked'); });
    await expect(exportGpx(file)).rejects.toThrow('Download blocked');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:gpx');
  });
});
