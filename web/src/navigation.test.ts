import { expect, it } from 'vitest';
import { readRouteLocation, writeRouteLocation } from './navigation';

it('uses a project-path-safe hash and avoids repeated detail history entries', () => {
  window.history.replaceState(null, '', '/funroads/?installed=1');
  writeRouteLocation('sprint:a', false);
  const before = history.length;
  writeRouteLocation('sprint:a', true, true);
  expect(history.length).toBe(before + 1);
  expect(location.pathname).toBe('/funroads/');
  expect(location.search).toBe('?installed=1');
  expect(readRouteLocation()).toEqual({ key: 'sprint:a', detail: true });
  writeRouteLocation('sprint:a', false);
  writeRouteLocation('sprint:b', true, true);
  expect(history.length).toBe(before + 1);
  writeRouteLocation(null, false);
  expect(readRouteLocation()).toEqual({ key: null, detail: false });
});
