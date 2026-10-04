import { expect, it } from 'vitest';
import { readRouteLocation, writeRouteLocation } from './navigation';

it('uses a project-path-safe hash and avoids repeated detail history entries', () => {
  window.history.replaceState(null, '', '/funroads/?installed=1');
  writeRouteLocation('sprint:a', false);
  const before = history.length;
  writeRouteLocation('sprint:a', true, true);
  expect(history.length).toBe(before + 1);
  expect(location.pathname).toBe('/funroads/');
  expect(location.search).toBe('?installed=1&country=nl');
  expect(readRouteLocation()).toEqual({ key: 'sprint:a', detail: true });
  writeRouteLocation('sprint:a', false);
  writeRouteLocation('sprint:b', true, true);
  expect(history.length).toBe(before + 1);
  writeRouteLocation(null, false);
  expect(readRouteLocation()).toEqual({ key: null, detail: false });
});

it.each([['sprint:a', 'nl'], ['ee:linked:b', 'ee']])('makes new shared route links explicit about their country (%s)', (key, country) => {
  history.replaceState(null, '', '/funroads/?qa=share');
  writeRouteLocation(key, false);
  expect(location.pathname).toBe('/funroads/');
  expect(new URLSearchParams(location.search).get('qa')).toBe('share');
  expect(new URLSearchParams(location.search).get('country')).toBe(country);
  expect(readRouteLocation().key).toBe(key);
});
