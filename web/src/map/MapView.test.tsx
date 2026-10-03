import { expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import type { RouteView } from '../data/model';
import { chooserContent, fitPadding } from './MapView';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouteStats } from '../components/ui';

it('keeps chooser symbols decorative, labels intact and selection working', () => {
  const pick = vi.fn();
  const route = { key: 'sprint:test', name: 'Road <one>', kind: 'sprint', color: '#666', km: 1.1, driveMin: 1 } as RouteView;
  const chooser = chooserContent([route, { ...route, key: 'linked:test', name: 'Road two', kind: 'linked-loop' }], 0, pick, vi.fn());
  const buttons = within(chooser).getAllByRole('button');
  expect(buttons[0]).toHaveTextContent('Road <one>');
  expect(buttons[0]).toHaveTextContent('Sprint');
  expect(buttons[0]).toHaveTextContent('1.1 km');
  expect(buttons[0]).toHaveTextContent('~1 min');
  expect(buttons[0].querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(3);
  expect(buttons[0].querySelector('svg')?.querySelector('circle')).toBeNull();
  expect(buttons[1].querySelector('svg')?.querySelector('circle')).not.toBeNull();
  buttons[1].click();
  expect(pick).toHaveBeenCalledWith('linked:test');
});

it('does not substitute an area name for missing home distance', () => {
  const route = { km: 5, driveMin: 6, distanceKm: null, circuit: { areaName: 'Test area' } } as RouteView;
  const content = document.createElement('div');
  content.innerHTML = renderToStaticMarkup(<RouteStats route={route} home="Zaandam" />);
  expect(content).toHaveTextContent('Distance unknown');
  expect(within(content).queryByText('Test area')).not.toBeInTheDocument();
  content.innerHTML = renderToStaticMarkup(<RouteStats route={{ ...route, distanceKm: { Zaandam: 0, Haarlem: 20 } }} home="Zaandam" />);
  expect(content).toHaveTextContent('0 km direct');
});

it('fits around measured detail and preview bounds without discarding them on short screens', () => {
  const main = document.createElement('main');
  const container = document.createElement('div');
  const overlay = document.createElement('section');
  main.append(container, overlay);
  Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 375 } });
  container.getBoundingClientRect = () => ({ right: 800, bottom: 375 } as DOMRect);
  overlay.getBoundingClientRect = () => ({ left: 408, top: 140, width: 320, height: 223 } as DOMRect);
  overlay.dataset.mapOverlay = 'right';
  const base = { left: 24, right: 64, top: 72, bottom: 76 };
  expect(fitPadding(container, base)).toEqual({ ...base, right: 404 });
  overlay.dataset.mapOverlay = 'bottom';
  expect(fitPadding(container, base)).toEqual({ ...base, top: 24, bottom: 247 });
  expect(base.bottom).toBe(76);
});
