import { expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import type { RouteView } from '../data/model';
import { chooserContent, fitPadding } from './MapView';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouteStats } from '../components/ui';

it('keeps chooser symbols decorative, labels intact and selection working', () => {
  const pick = vi.fn();
  const route = { key: 'sprint:test', name: 'Road <one>', kind: 'sprint', color: '#666', km: 1.1, driveMin: 1, funScore: 60, funScoreBasis: 'road-average' } as RouteView;
  const chooser = chooserContent([route, { ...route, key: 'linked:test', name: 'Road two', kind: 'linked-loop', funScoreBasis: 'route-total' }], 0, pick, vi.fn());
  const buttons = within(chooser).getAllByRole('button');
  for (const button of buttons) {
    expect(Array.from(button.children).map((e) => e.className))
      .toEqual(['fr-chooser__kind', 'fr-chooser__name', 'fr-chooser__stats']);
    expect(button.querySelector('.fr-chooser__kind .fr-route-stat')).toBeNull();
    expect(button.querySelector('.fr-chooser__stats .fr-route-stat')).not.toBeNull();
  }
  expect(buttons[0]).toHaveTextContent('Road <one>');
  expect(buttons[0]).toHaveTextContent('Sprint');
  expect(buttons[0]).toHaveTextContent('1.1 km');
  expect(buttons[0]).toHaveTextContent('~1 min');
  expect(buttons[0].querySelector('.fr-route-stat')).toHaveAttribute('aria-label', 'Road fun average 60 out of 100');
  expect(buttons[0].querySelector('.fr-route-stat')).toHaveTextContent('60/100');
  expect(buttons[1].querySelector('.fr-route-stat')).toHaveAttribute('aria-label', 'Fun score 60 out of 100');
  expect(buttons[0].querySelectorAll('.fr-route-stat')[1]).toHaveAttribute('aria-label', 'Length 1.1 km');
  expect(buttons[0].querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  expect(buttons[0].querySelector('svg')?.querySelector('circle')).toBeNull();
  expect(buttons[1].querySelector('svg')?.querySelector('circle')).not.toBeNull();
  buttons[1].click();
  expect(pick).toHaveBeenCalledWith('linked:test');
});

it('does not substitute an area name for missing home distance', () => {
  const route = { km: 5, driveMin: 6, distanceKm: null, circuit: { areaName: 'Test area' }, funScore: 60, funScoreBasis: 'road-average' } as RouteView;
  const content = document.createElement('div');
  content.innerHTML = renderToStaticMarkup(<RouteStats route={route} home="Zaandam" />);
  expect(content).toHaveTextContent('Distance unknown');
  expect(within(content).queryByText('Test area')).not.toBeInTheDocument();
  content.innerHTML = renderToStaticMarkup(<RouteStats route={{ ...route, distanceKm: { Zaandam: 0, Haarlem: 20 } }} home="Zaandam" />);
  expect(content).toHaveTextContent('0 km');
  expect(content).not.toHaveTextContent('direct');
  expect(within(content).getByLabelText('0 km straight-line from Zaandam')).toHaveAttribute('title', 'Straight-line from Zaandam, not driving distance');
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
  const handle = document.createElement('section');
  handle.dataset.mapOverlay = 'bottom';
  handle.getBoundingClientRect = () => ({ top: 319, width: 240, height: 44 } as DOMRect);
  main.append(handle);
  expect(fitPadding(container, base)).toEqual({ ...base, top: 24, bottom: 247 });
  expect(base.bottom).toBe(76);
});

it('reserves desktop Browse on the left rather than pushing routes above its full height', () => {
  const main = document.createElement('main');
  const container = document.createElement('div');
  const browse = document.createElement('section');
  const preview = document.createElement('section');
  main.append(container, browse, preview);
  Object.defineProperties(container, { clientWidth: { value: 1920 }, clientHeight: { value: 1080 } });
  container.getBoundingClientRect = () => ({ left: 0, right: 1920, bottom: 1080 } as DOMRect);
  browse.dataset.mapOverlay = 'left';
  browse.getBoundingClientRect = () => ({ left: 12, right: 432, top: 236, width: 420, height: 832 } as DOMRect);
  preview.dataset.mapOverlay = 'bottom';
  preview.getBoundingClientRect = () => ({ left: 1428, top: 880, width: 420, height: 155 } as DOMRect);
  expect(fitPadding(container, { left: 24, right: 64, top: 72, bottom: 168 })).toEqual({
    left: 444, right: 64, top: 72, bottom: 212,
  });
});
