import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseProvider } from 'baseui';
import { Provider } from 'styletron-react';
import { Client } from 'styletron-engine-monolithic';
import { theme } from '../theme';
import { validateRoutesDoc } from '../data/validate';
import { getCountry } from '../data/countries';
import { buildCatalogue, KIND_SHAPE, routeForRoad, type Kind } from '../data/model';
import { App } from './App';
import { ResultCard } from './Results';

vi.mock('../data/load', () => ({ loadAll: vi.fn() }));
vi.mock('../map/MapView', () => ({
  MapView: ({ selected, onBlank, onSelect, onInteract, onStatus }: { selected: { key: string } | null; onBlank: () => void; onSelect: (key: string) => void; onInteract: () => void; onStatus: (status: 'unavailable') => void }) => (
    <div aria-label="Test map">
      <button onClick={() => { onInteract(); onBlank(); }}>Blank map</button>
      <button onClick={() => { onInteract(); onSelect('sprint:test'); }}>Pick route on map</button>
      <button onClick={onInteract}>Overlapping routes on map</button>
      <button onClick={() => onStatus('unavailable')}>Simulate map failure</button>
      <span data-testid="map-selection">{selected?.key ?? 'none'}</span>
    </div>
  ),
}));
vi.mock('./ProfileChart', async (importOriginal) => ({
  ...await importOriginal<typeof import('./ProfileChart')>(),
  ProfileChart: () => <div>Test chart</div>,
}));

const routes = validateRoutesDoc({
  routes: [], areas: [], sprints: [{
    id: 'test', name: 'Test Road Sprint', km: 5, fun: 0.6, fun_km: 3,
    line: [[4.8, 52.4], [4.81, 52.41]], roads: [{ name: 'Test Road', km: 5, fun: 0.6 }],
    score: { corners: 0.5, flow: 0.5, quiet: 0.5, speed: 0.5, elevation: 0.5, surface: 0.5, scenery: 0.5 },
    windows: ['2026-09-28 08:00'], start: { lat: 52.4, lon: 4.8 }, end: { lat: 52.41, lon: 4.81 },
    distance_km: { Zaandam: 10, Haarlem: 20 }, drive_min: 6,
    seg: [{ i0: 0, i1: 1, fun: 0.6, lim: 60, v: 45 }],
  }],
});

beforeEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, '', '/?country=nl');
  viewport(true);
  const { loadAll } = await import('../data/load');
  vi.mocked(loadAll).mockClear();
  vi.mocked(loadAll).mockResolvedValue({ routes: { value: routes, error: null }, linked: { value: null, error: 'No linked data' } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function viewport(mobile: boolean, narrow = false) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('max-width: 767') ? mobile : query.includes('max-width: 1319') && narrow,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as MediaQueryList));
}

function mount() {
  return render(<Provider value={new Client()}><BaseProvider theme={theme}><App dataBase="/" /></BaseProvider></Provider>);
}

describe('responsive interactions', () => {
  it.each([true, false])('offers one whole-route Maps link without losing detail or browse context (mobile=%s)', async (mobile) => {
    viewport(mobile);
    const { loadAll } = await import('../data/load');
    const longRoutes = validateRoutesDoc({
      ...routes.doc,
      sprints: [{ ...routes.doc.sprints[0], name: 'A long route name → With several places → And a final place Sprint',
        traits: ['flowing', 'quiet', 'smooth'],
        line: [[4.8, 52.4], [5.8, 52.4]], end: { lon: 5.8, lat: 52.4 } }],
    });
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: longRoutes, error: null }, linked: { value: null, error: null } });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const sheet = document.getElementById('sheet-body')!;
    sheet.scrollTop = 140;
    fireEvent.scroll(sheet);
    const card = await screen.findByRole('button', { name: /^Sprint.*A long route name/ });
    expect(card.querySelectorAll('[aria-label="Road fun average 60 out of 100"]')).toHaveLength(1);
    expect(card.querySelector('.fr-route-stat')).toHaveAttribute('aria-label', 'Road fun average 60 out of 100');
    expect(card).not.toHaveTextContent('Legal turnaround required');
    expect(card).toHaveTextContent('flowing, quiet, smooth');
    await user.click(card);
    const preview = mobile
      ? screen.getByRole('button', { name: 'Details' }).parentElement!.parentElement!
      : screen.getByRole('region', { name: 'Selected route' });
    const stats = preview.querySelectorAll('.fr-route-stat');
    expect(stats).toHaveLength(4);
    expect(stats[0]).toHaveAttribute('aria-label', 'Road fun average 60 out of 100');
    expect(stats[0]).toHaveTextContent('60/100');
    expect(stats[0].querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(stats[1]).toHaveAttribute('aria-label', 'Length 5.0 km');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    const body = document.querySelector<HTMLElement>('.fr-detail-content')!;
    body.scrollTop = 220;
    const navigate = screen.getByRole('link', { name: 'Open in Google Maps' });
    expect(navigate.closest('footer')).toHaveClass('fr-detail-navigation');
    const routeLocation = location.href;
    expect(screen.getByText(/Google may treat requested points as stops/)).toBeVisible();
    expect(screen.getByText(/point limits mean some route detail may not carry over/)).toBeVisible();
    expect(navigate).toHaveAttribute('target', '_blank');
    expect(navigate).toHaveAccessibleDescription(/do not guarantee exact route fidelity/);
    const url = new URL(navigate.getAttribute('href')!);
    expect(url.searchParams.get('waypoints')?.split('|').length ?? 0).toBeLessThanOrEqual(mobile ? 3 : 9);
    expect(url.searchParams.get('origin')).toBe('52.4,4.8');
    expect(url.searchParams.get('destination')).toBe('52.4,5.8');
    expect(location.href).toBe(routeLocation);
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    navigate.focus();
    expect(navigate).toHaveFocus();
    expect(body.scrollTop).toBe(220);
    expect(screen.queryByRole('heading', { name: 'Google Maps parts' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close details' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Google Maps parts' })).not.toBeInTheDocument());
    if (mobile) await user.click(await screen.findByRole('button', { name: 'Back to results' }));
    expect(sheet.scrollTop).toBe(140);
  });

  it.each([true, false])('keeps shared Browse controls hidden until opened (mobile=%s)', async (mobile) => {
    viewport(mobile);
    const user = userEvent.setup();
    mount();
    await screen.findAllByText('1 route');
    expect(screen.getByRole('button', { name: 'Browse routes' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Hide list|Show list/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Legal, enjoyable Dutch roads/)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Zaandam' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    expect(screen.getByRole('combobox', { name: 'Search a road or circuit area' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Filters (0)' }));
    expect(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Limit distance' }).closest('label')).toBeVisible();
    expect(within(screen.getByRole('dialog')).queryByRole('radiogroup', { name: 'Home place' })).not.toBeInTheDocument();
  });

  it('keeps selection when returning from details, then clears it on blank map', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick route on map' })).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Pick route on map' }));
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(within(screen.getByRole('dialog')).queryByRole('meter')).not.toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Straight-line from Zaandam').closest('div')).toHaveTextContent('10 km');
    expect(dialog.queryByText('Posted limits')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: /Roads and route composition/ }));
    expect(dialog.getByText('60 km/h').closest('li')).toHaveTextContent('100% of route');
    expect(dialog.queryByText(/legal maximums/)).not.toBeInTheDocument();
    expect(dialog.getByText('Road fun (average)').closest('div')?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(dialog.queryByRole('button', { name: /Navigation options and caveats/ })).not.toBeInTheDocument();
    expect(dialog.getAllByRole('button', { name: /Roads and route composition|Before you drive|Score breakdown|Route facts|Data sources and limitations/ }).map((button) => button.textContent)).toEqual([
      'Roads and route compositionDown Small', 'Score breakdown (0–100)Down Small', 'Route factsDown Small', 'Data sources and limitationsDown Small', 'Before you driveDown Small',
    ]);
    expect(screen.getByRole('button', { name: 'Blank map' }).closest('[inert]')).not.toBeNull();
    expect(within(screen.getByRole('dialog')).queryByText(/Access is based on sampled data/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Before you drive/ }));
    expect(within(screen.getByRole('dialog')).getByText(/Access is based on sampled data/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sample departures/ })).not.toBeInTheDocument();
    const navigate = dialog.getByRole('link', { name: 'Open in Google Maps' });
    expect(navigate.closest('footer')).toHaveClass('fr-detail-navigation');
    expect(dialog.getByRole('button', { name: 'Add to favorites' }).closest('header')).toHaveClass('fr-detail-actions');
    const favorite = dialog.getByRole('button', { name: 'Add to favorites' });
    expect(favorite).not.toHaveClass('fr-favorite-button');
    expect(favorite.querySelector('span > svg')).toHaveAttribute('width', '20');
    await user.click(favorite);
    expect(dialog.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
    const close = dialog.getByRole('button', { name: 'Close details' });
    expect(favorite).toHaveClass('fr-icon-button');
    expect(close).toHaveClass('fr-icon-button');
    expect(close.querySelector('span > svg')).toHaveAttribute('width', '20');
    expect(close.querySelector('svg')).toHaveAttribute('stroke-width', '2');
    expect(dialog.queryByRole('button', { name: 'Back to map' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    await user.click(screen.getByRole('button', { name: 'Blank map' }));
    expect(screen.getByTestId('map-selection')).toHaveTextContent('none');
  });

  it('a blank map click dismisses the legend without also clearing selection', async () => {
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick route on map' })).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Pick route on map' }));
    await user.click(screen.getByRole('button', { name: 'Map information' }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Map legend' })).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Blank map' }));
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Map legend' })).not.toBeInTheDocument());
  });

  it.each([true, false])('previews a result and resumes the same browse position (mobile=%s)', async (mobile) => {
    viewport(mobile);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const card = screen.getByRole('button', { name: /^Sprint.*Test Road Sprint/ });
    const sheet = document.getElementById('sheet-body')!;
    sheet.scrollTop = 140;
    fireEvent.scroll(sheet);
    await user.click(card);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument();
    if (mobile) expect(sheet).not.toBeVisible();
    else expect(sheet).toBeVisible();
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    expect(location.hash).not.toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(mobile ? await screen.findByRole('dialog') : await screen.findByRole('region', { name: 'Route details' })).toBeVisible();
    expect(location.hash).toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument();
    });
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(location.hash).not.toContain('detail=1');
    if (mobile) await user.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(screen.getByRole('button', { name: 'Close results' })).toHaveAttribute('aria-expanded', 'true');
    expect(sheet.scrollTop).toBe(140);
  });

  it('keeps live filter changes when dismissing filters with Escape', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(screen.getByRole('button', { name: 'Change home: Zaandam' }));
    await user.click(screen.getByRole('radio', { name: 'Haarlem' }));
    await user.click(screen.getByRole('button', { name: 'Filters (0)' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: 'Limit distance' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Change home: Haarlem' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Sprint.*Test Road Sprint/ }));
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(within(await screen.findByRole('dialog')).getByText('Straight-line from Haarlem').closest('div')).toHaveTextContent('20 km');
  });

  it.each([true, false])('keeps ranking selections open and restores focus on dismissal (mobile=%s)', async (mobile) => {
    viewport(mobile);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(screen.getByRole('button', { name: 'Rank routes: Balanced' }));
    await user.click(screen.getByRole('radio', { name: 'Scenic' }));
    expect(screen.getByRole('group', { name: 'Route ranking' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Scenic' })).toHaveAttribute('aria-checked', 'true');
    const ranking = screen.getByRole('button', { name: 'Rank routes: Scenic' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(ranking).toHaveFocus());
    expect(screen.getByTestId('map-selection')).toHaveTextContent('none');
    await user.click(ranking);
    await user.click(screen.getByRole('button', { name: 'Close route ranking' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Route ranking' })).not.toBeInTheDocument());
    expect(ranking).toHaveAccessibleName('Rank routes: Scenic');
    await user.click(ranking);
    await user.click(screen.getByRole('button', { name: 'Nearest' }));
    expect(screen.getByRole('group', { name: 'Route ranking' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Nearest' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rank routes: Nearest (straight-line)' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Route ranking' })).not.toBeInTheDocument());
  });

  it('switches compact filter views without losing live settings', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(screen.getByRole('button', { name: 'Filters (0)' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('radio', { name: 'Up to 30 minutes' }));
    await user.click(dialog.getByRole('tab', { name: 'More' }));
    expect(dialog.getByRole('slider', { name: 'Minimum scenery score' })).toBeVisible();
    expect(dialog.queryByRole('combobox', { name: 'Sampled departure' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('radio', { name: 'Up to 30 minutes' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('tab', { name: 'Route' }));
    expect(dialog.getByRole('radio', { name: 'Up to 30 minutes' })).toHaveAttribute('aria-checked', 'true');
    await user.click(dialog.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeVisible();
  });

  it('combines route types and keeps favorites filtering inside Filters', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    expect(screen.queryByRole('checkbox', { name: /Favorites only/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Circuits' }));
    expect(screen.getByRole('button', { name: 'Circuits' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Sprints' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Sprints' }));
    expect(screen.getByText('No routes match these filters.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Sprints' }));
    await user.click(screen.getByRole('button', { name: 'Save Test Road Sprint to favorites' }));
    await user.click(screen.getByRole('button', { name: 'Filters (1)' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('checkbox', { name: 'Favorites only (1 saved)' }));
    await user.click(dialog.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Remove filter: Favorites only' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Sprint.*Test Road Sprint/ })).toBeVisible();
  });

  it('opens search with results in one step and collapses for an overlap chooser', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.queryByRole('combobox', { name: 'Search a road or circuit area' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    expect(await screen.findByRole('combobox', { name: 'Search a road or circuit area' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Expand results' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close results' }));
    expect(screen.getByRole('button', { name: 'Browse routes' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(screen.getByRole('button', { name: 'Overlapping routes on map' }));
    expect(screen.getByRole('button', { name: 'Browse routes' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Search a road or circuit area' })).not.toBeInTheDocument();
  });

  it.each(['Rank routes: Balanced', 'Change home: Zaandam'])('dismisses %s on blank map without clearing selection', async (name) => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Pick route on map' }));
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    await user.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(document.querySelector('[data-baseweb="popover"]')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Blank map' }));
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    await waitFor(() => expect(document.querySelector('[data-baseweb="popover"]')).toBeNull());
  });

  it('keeps successive desktop result selections in preview until Details is requested', async () => {
    viewport(false, true);
    const { loadAll } = await import('../data/load');
    const twoRoutes = validateRoutesDoc({
      ...routes.doc,
      sprints: [...routes.doc.sprints, { ...routes.doc.sprints[0], id: 'other', name: 'Another Road Sprint' }],
    });
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: twoRoutes, error: null }, linked: { value: null, error: 'No linked data' } });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const card = await screen.findByRole('button', { name: /^Sprint.*Test Road Sprint/ });
    await user.click(card);
    expect(within(screen.getByRole('region', { name: 'Selected route' })).getByText('Test Road Sprint')).toBeVisible();
    expect(location.hash).not.toContain('detail=1');
    await user.click(screen.getByRole('button', { name: /^Sprint.*Another Road Sprint/ }));
    expect(within(screen.getByRole('region', { name: 'Selected route' })).getByText('Another Road Sprint')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument();
    expect(location.hash).not.toContain('detail=1');
    expect(screen.queryByRole('button', { name: 'Fit route' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overlapping routes on map' }));
    expect(screen.getByRole('button', { name: 'Close results' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('combobox', { name: 'Search a road or circuit area' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('region', { name: 'Route details' })).toHaveClass('fr-detail-panel');
    expect(screen.queryByRole('button', { name: 'Back to results' })).not.toBeInTheDocument();
    expect(location.hash).toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument());
    expect(location.hash).not.toContain('detail=1');
    expect(screen.getByRole('button', { name: 'Close results' })).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to results' })).toHaveFocus());
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:other');
  });

  it('restores visible focus after closing a directly linked mobile detail', async () => {
    window.history.replaceState(null, '', '/#route=sprint%3Atest&detail=1');
    const user = userEvent.setup();
    mount();
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to results' })).toHaveFocus());
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
  });

  it('dismisses save feedback after three seconds without clearing the saved route', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const favorite = await screen.findByRole('button', { name: 'Save Test Road Sprint to favorites' });
    vi.useFakeTimers();
    try {
      fireEvent.click(favorite);
      expect(screen.getByRole('status')).toHaveTextContent('Route saved.');
      act(() => vi.advanceTimersByTime(2999));
      expect(screen.getByRole('status')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove Test Road Sprint from favorites' })).toHaveAttribute('aria-pressed', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports failed persistence when removing stale favorites', async () => {
    localStorage.setItem('funroads:favorites:v1', JSON.stringify(['sprint:missing']));
    const save = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    try {
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole('button', { name: 'Browse routes' }));
      await user.click(await screen.findByRole('button', { name: 'Remove from saved' }));
      expect(screen.getByRole('status')).toHaveTextContent('Saved changes last only for this session');
    } finally {
      save.mockRestore();
    }
  });
});

describe('country catalogue integration', () => {
  it.each(['nl', 'ee'] as const)('keeps all Browse families free of redundant shape copy (%s)', (id) => {
    const country = getCountry(id);
    const base = buildCatalogue(routes.doc, null, country).routes[0];
    const kinds: Kind[] = ['circuit', 'linked-loop', 'linked-open', 'sprint'];
    const cards = kinds.map((kind) => ({ ...base, key: `${id}:${kind}`, kind, traits: ['flowing', 'quiet'] }));
    render(<Provider value={new Client()}><BaseProvider theme={theme}>
      {cards.map((route) => <ResultCard key={route.key} route={route} home={country.homes[0]}
        selected={false} favorite={false} onOpen={vi.fn()} onHover={vi.fn()} onToggleFavorite={vi.fn()} />)}
    </BaseProvider></Provider>);
    for (const route of cards) {
      const card = document.querySelector(`[data-route-key="${route.key}"]`)!;
      expect(card).not.toHaveTextContent(/Ends elsewhere|Returns to start|Joins high-fun|Legal turnaround required/);
      expect(card).toHaveTextContent('flowing, quiet');
      expect(card.querySelector(`[title="${KIND_SHAPE[route.kind]}"]`)).toBeNull();
    }
  });

  it.each([
    ['nl', true], ['nl', false], ['ee', true], ['ee', false],
  ] as const)('previews nearby road sprints with shared cards and symbols (%s, mobile=%s)', async (id, mobile) => {
    viewport(mobile);
    const country = getCountry(id);
    const prefix = id === 'ee' ? 'ee:' : '';
    window.history.replaceState(null, '', `/?country=${id}#route=${encodeURIComponent(`${prefix}circuit:loop`)}&detail=1`);
    const sprint = routes.doc.sprints[0];
    const countryRoutes = validateRoutesDoc({
      ...routes.doc, meta: { country: id, schema_version: 1 },
      routes: [{ ...sprint, id: 'loop', name: 'Loop', area_id: 'test', area_name: 'Test area',
        line: [...sprint.line, sprint.line[0]], score: { ...sprint.score, total: 60 }, flags: [],
        roads: [...sprint.roads.map((road) => ({ ...road, fun: 60 })), { name: 'Unmapped road', km: 1, fun: 40 }] }],
      sprints: [sprint, { ...sprint, id: 'far', name: 'Same road elsewhere Sprint',
        line: [[20, 60], [20.01, 60.01]], start: { lon: 20, lat: 60 }, end: { lon: 20.01, lat: 60.01 } }],
    }, country);
    expect(countryRoutes.dropped).toEqual([]);
    const cat = buildCatalogue(countryRoutes.doc, null, country);
    const parent = cat.byKey.get(`${prefix}circuit:loop`)!;
    expect(routeForRoad(parent, 'Test Road', cat.routes)?.key).toBe(`${prefix}sprint:test`);
    expect(routeForRoad(parent, 'Unmapped road', cat.routes)).toBeNull();
    const linkedParent = { ...parent, key: `${prefix}linked:loop`, kind: 'linked-loop' as const, catalog: 'linked' as const };
    expect(routeForRoad(linkedParent, 'Test Road', cat.routes)?.key).toBe(`${prefix}sprint:test`);
    expect(routeForRoad(linkedParent, 'Unmapped road', cat.routes)).toBeNull();
    const { loadAll } = await import('../data/load');
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: countryRoutes, error: null }, linked: { value: null, error: null } });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /Roads and route composition/ }));
    const roadsList = within(screen.getByRole('list', { name: 'Roads in this route' }));
    const card = roadsList.getByRole('button', { name: /^Test Road/ });
    expect(card).toHaveClass('fr-similar-route');
    expect(Array.from(card.querySelectorAll('.fr-route-stat')).map((e) => e.getAttribute('aria-label')))
      .toEqual(['Road fun average 60 out of 100', 'Length on this route 5.0 km']);
    const unavailable = roadsList.getByRole('button', { name: /Unmapped road/ });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveStyle({ color: '#5e5e5e', backgroundColor: '#f3f3f3' });
    expect(roadsList.getByText('Unmapped road')).toBeVisible();
    await user.click(unavailable);
    expect(screen.getByTestId('map-selection')).toHaveTextContent(`${prefix}circuit:loop`);
    await user.click(card);
    await waitFor(() => expect(screen.getByTestId('map-selection')).toHaveTextContent(`${prefix}sprint:test`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument();
    expect(location.hash).not.toContain('detail=1');
    expect(screen.getByRole('button', { name: 'Details' })).toBeVisible();
  });

  it.each([
    ['nl', true], ['nl', false], ['ee', true], ['ee', false],
  ] as const)('supports the same search, home, save and empty-state journey (%s, mobile=%s)', async (id, mobile) => {
    viewport(mobile);
    window.history.replaceState(null, '', `/?country=${id}`);
    const country = getCountry(id);
    const road = id === 'ee' ? 'Rõngu tee' : 'Duinlustweg';
    const line = id === 'ee' ? [[26.4, 58.4], [26.41, 58.41]] : routes.doc.sprints[0].line;
    const key = `${id === 'ee' ? 'ee:' : ''}sprint:test`;
    const otherSaved = id === 'ee' ? 'sprint:other' : 'ee:sprint:other';
    const sourceNotes = id === 'ee' ? [
      'Estonia national network; quiet is a static OSM proxy, not traffic counts',
      'Elevation models 25 m EH2000 ground terrain, not surveyed road or bridge decks',
      'OSM road evidence supplemented by geometry-matched Teeregister surface and base speed records; check current signs',
    ] : [];
    localStorage.setItem('funroads:favorites:v1', JSON.stringify([otherSaved]));
    const countryRoutes = validateRoutesDoc({
      meta: { country: id, schema_version: 1 }, routes: [],
      sprints: [{ ...routes.doc.sprints[0], name: `${road} Sprint`, line,
        why: ['Modelled as usually quiet (static estimate, not live traffic)', ...sourceNotes],
        start: { lon: line[0][0], lat: line[0][1] }, end: { lon: line[1][0], lat: line[1][1] },
        roads: [{ ...routes.doc.sprints[0].roads[0], name: road }],
        distance_km: { [country.homes[0]]: 10, [country.homes[1]]: 20 } }],
    }, country);
    expect(countryRoutes.dropped).toEqual([]);
    const { loadAll } = await import('../data/load');
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: countryRoutes, error: null }, linked: { value: null, error: null } });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const search = await screen.findByRole('combobox', { name: 'Search a road or circuit area' });
    await user.click(search);
    await user.type(search, id === 'ee' ? 'rongu' : 'duinlust');
    await user.click(await screen.findByRole('option', { name: new RegExp(road) }));
    expect(screen.getByRole('heading', { name: '1 route' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: `Change home: ${country.homes[0]}` }));
    await user.click(screen.getByRole('radio', { name: country.homes[1] }));
    await user.click(screen.getByRole('button', { name: `Save ${road} Sprint to favorites` }));
    expect(new Set(JSON.parse(localStorage.getItem('funroads:favorites:v1')!))).toEqual(new Set([otherSaved, key]));
    await user.click(screen.getByRole('button', { name: 'Sprints' }));
    expect(screen.getByText('No routes match these filters.')).toBeVisible();
    await user.click(within(screen.getByRole('group', { name: 'Active filters' })).getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('button', { name: `Change home: ${country.homes[1]}` })).toBeVisible();
    await user.click(screen.getByRole('button', { name: new RegExp(`^Sprint.*${road}`) }));
    const preview = mobile
      ? screen.getByRole('button', { name: 'Details' }).parentElement!.parentElement!
      : screen.getByRole('region', { name: 'Selected route' });
    expect(preview.querySelector('.fr-route-stat')).toHaveAttribute('aria-label', 'Road fun average 60 out of 100');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByText(`Straight-line from ${country.homes[1]}`)).toBeVisible();
    expect(screen.getByText(`Straight-line from ${country.homes[1]}`).closest('div')).toHaveTextContent('20 km');
    expect(Array.from(document.querySelectorAll('.fr-detail-content > dl:first-of-type dt')).map((e) => e.textContent))
      .toEqual(['Road fun (average)', 'Length', 'Estimated drive time', `Straight-line from ${country.homes[1]}`]);
    expect(new URL(screen.getByRole('link', { name: 'Open in Google Maps' }).getAttribute('href')!).searchParams.get('destination')).toBe(`${line[1][1]},${line[1][0]}`);
    await user.click(screen.getByRole('button', { name: /Why this route/ }));
    const character = document.querySelector<HTMLElement>('.fr-detail ul')!;
    expect(within(character).getByText('Modelled as usually quiet (static estimate, not live traffic)')).toBeVisible();
    for (const note of sourceNotes) expect(within(character).queryByText(note)).not.toBeInTheDocument();
    expect(character.textContent).not.toMatch(/Teeregister|EH2000|traffic counts/);
    await user.click(screen.getByRole('button', { name: /^Route facts/ }));
    for (const note of sourceNotes) expect(screen.queryByText(note)).not.toBeInTheDocument();
    const sourcesButton = screen.getByRole('button', { name: /^Data sources and limitations/ });
    expect(sourcesButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(sourcesButton);
    for (const note of sourceNotes) expect(screen.getByText(note)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(new URLSearchParams(location.hash.slice(1)).get('route')).toBe(key);
  }, 10000);

  it.each(['nl', 'ee'] as const)('recovers from failed and partial country loading without losing saves (%s)', async (id) => {
    window.history.replaceState(null, '', `/?country=${id}`);
    const country = getCountry(id);
    const saved = ['sprint:test', 'ee:sprint:test'];
    localStorage.setItem('funroads:favorites:v1', JSON.stringify(saved));
    const countryRoutes = validateRoutesDoc({ ...routes.doc, meta: { country: id, schema_version: 1 } }, country);
    const { loadAll } = await import('../data/load');
    vi.mocked(loadAll).mockResolvedValueOnce({
      routes: { value: null, error: 'HTTP 503' }, linked: { value: null, error: 'HTTP 503' },
    }).mockResolvedValueOnce({
      routes: { value: countryRoutes, error: null }, linked: { value: null, error: 'HTTP 503' },
    }).mockResolvedValue({
      routes: { value: countryRoutes, error: null }, linked: { value: null, error: null },
    });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(await screen.findByRole('button', { name: 'Retry route data' }));
    expect(await screen.findByRole('heading', { name: '1 route' })).toBeVisible();
    expect(screen.getByText(/Linked rides could not be loaded/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Linked' })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Change country: ${country.name}` })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry route data' }));
    await screen.findByRole('heading', { name: '1 route' });
    expect(screen.queryByText(/Linked rides could not be loaded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry route data' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('funroads:favorites:v1')!)).toEqual(saved);
  });

  it.each([
    ['nl', true], ['nl', false], ['ee', true], ['ee', false],
  ] as const)('offers a keyboard-accessible country picker without touching favorites (%s, mobile=%s)', async (id, mobile) => {
    viewport(mobile);
    window.history.replaceState(null, '', `/funroads/?country=${id}&qa=picker`);
    const saved = ['sprint:test', 'ee:sprint:test'];
    localStorage.setItem('funroads:favorites:v1', JSON.stringify(saved));
    const country = getCountry(id);
    const { loadAll } = await import('../data/load');
    const countryRoutes = validateRoutesDoc({
      ...routes.doc, meta: { country: id, schema_version: 1 },
    }, country);
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: countryRoutes, error: null }, linked: { value: null, error: null } });
    const user = userEvent.setup();
    mount();
    const picker = await screen.findByRole('button', { name: `Change country: ${country.name}` });
    expect(within(screen.getByRole('banner')).getByRole('button', { name: `Change country: ${country.name}` })).toBe(picker);
    expect(document.getElementById('sheet-body')).not.toContainElement(picker);
    expect(screen.getByRole('button', { name: 'Browse routes' })).toHaveAttribute('aria-expanded', 'false');
    picker.focus();
    await user.keyboard('{Enter}');
    const choices = await screen.findByRole('navigation', { name: 'Choose country' });
    expect(within(choices).getByRole('link', { name: country.name })).toHaveAttribute('aria-current', 'page');
    expect(within(choices).getByRole('link', { name: 'Estonia' })).toHaveAttribute('href', '/funroads/?country=ee&qa=picker');
    expect(within(choices).getByRole('link', { name: 'Netherlands' })).toHaveAttribute('href', '/funroads/?country=nl&qa=picker');
    const other = within(choices).getByRole('link', { name: id === 'ee' ? 'Netherlands' : 'Estonia' });
    other.addEventListener('click', (event) => event.preventDefault());
    await user.click(other);
    expect(localStorage.getItem('funroads:country:v1')).toBe(id === 'ee' ? 'nl' : 'ee');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Choose country' })).not.toBeInTheDocument());
    await waitFor(() => expect(picker).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Browse routes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    expect(picker).toBeVisible();
    expect(JSON.parse(localStorage.getItem('funroads:favorites:v1')!)).toEqual(saved);
  });

  it.each(['nl', 'ee'])('describes the actual country sources and circuit distances (%s)', async (id) => {
    window.history.replaceState(null, '', `/?country=${id}`);
    const country = getCountry(id);
    const distances = id === 'ee' ? { Tallinn: 220, Tartu: 65 } : undefined;
    const input = routes.doc.sprints[0];
    const countryRoutes = validateRoutesDoc({
      meta: { country: id, schema_version: 1 }, sprints: [],
      routes: [{ ...input, id: 'loop', name: 'Loop', area_id: 'test', area_name: 'Test area',
        line: [...input.line, input.line[0]], score: { ...input.score, total: 60 },
        flags: [], distance_km: distances }],
    }, country);
    expect(countryRoutes.dropped).toEqual([]);
    const { loadAll } = await import('../data/load');
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: countryRoutes, error: null }, linked: { value: null, error: null } });
    const user = userEvent.setup();
    mount();
    await screen.findAllByText('1 route');
    await user.click(screen.getByRole('button', { name: 'Map information' }));
    await user.click(await screen.findByRole('button', { name: /App and data/ }));
    expect(await screen.findByText(new RegExp(country.sourceSummary))).toBeVisible();
    expect(screen.getByText(new RegExp(country.quietDescription))).toBeVisible();
    expect(screen.getByText(/uses your chosen straight-line radius/)).toBeVisible();
    if (id === 'ee') {
      expect(screen.queryByText(/Circuits have no straight-line distance/)).not.toBeInTheDocument();
      expect(screen.queryByText(/pinned OpenStreetMap, speed-limit, traffic/)).not.toBeInTheDocument();
      expect(screen.getByText(/Home-to-start driving times are not modeled/)).toBeVisible();
    } else {
      expect(screen.getByText(/Circuits have no straight-line distance in this catalogue/)).toBeVisible();
      expect(screen.getByText(/Circuit reach time is modeled from Zaandam only/)).toBeVisible();
    }
  });

  it('shows missing Estonia data without loading Netherlands or altering favorites', async () => {
    window.history.replaceState(null, '', '/?country=ee');
    const saved = ['sprint:test', 'ee:sprint:missing'];
    localStorage.setItem('funroads:favorites:v1', JSON.stringify(saved));
    const { loadAll } = await import('../data/load');
    vi.mocked(loadAll).mockResolvedValue({
      routes: { value: null, error: 'data/ee/routes.json: HTTP 404' },
      linked: { value: null, error: 'data/ee/linked.json: HTTP 404' },
    });
    const user = userEvent.setup();
    const view = mount();
    expect(screen.getByRole('heading', { name: 'FunRoads' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    expect(await screen.findByText(/data\/ee\/routes.json: HTTP 404/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Change country: Estonia' }));
    expect(screen.getByRole('link', { name: 'Netherlands' })).toHaveAttribute('href', '/?country=nl');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Test Road Sprint')).not.toBeInTheDocument();
    expect(loadAll).toHaveBeenCalledTimes(1);
    const call = vi.mocked(loadAll).mock.calls[0];
    expect(call[2]?.id).toBe('ee');
    await user.click(screen.getByRole('button', { name: 'Simulate map failure' }));
    expect(screen.getByText(/The map could not start/)).not.toHaveTextContent(/Rijkswaterstaat|NDW|AHN|CBS/);
    expect(JSON.parse(localStorage.getItem('funroads:favorites:v1')!)).toEqual(saved);
    view.unmount();
    expect(call[3]?.aborted).toBe(true);
  });

  it('uses Estonia homes and deep links, and removes only stale Estonia favorites', async () => {
    window.history.replaceState(null, '', '/?country=ee#route=ee%3Asprint%3Atest');
    localStorage.setItem('funroads:favorites:v1', JSON.stringify(['sprint:test', 'ee:sprint:missing']));
    const { loadAll } = await import('../data/load');
    const ee = getCountry('ee');
    const eeRoutes = validateRoutesDoc({
      ...routes.doc, meta: { country: 'ee', schema_version: 1 },
      sprints: routes.doc.sprints.map((s) => ({
        ...s, line: [[26.9, 57.73], [26.91, 57.74]],
        start: { lon: 26.9, lat: 57.73 }, end: { lon: 26.91, lat: 57.74 },
        distance_km: { Tallinn: 220, Tartu: 65 },
      })),
    }, ee);
    vi.mocked(loadAll).mockResolvedValue({ routes: { value: eeRoutes, error: null }, linked: { value: null, error: 'No linked data' } });
    const user = userEvent.setup();
    mount();
    await waitFor(() => expect(screen.getByTestId('map-selection')).toHaveTextContent('ee:sprint:test'));
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    await user.click(screen.getByRole('button', { name: 'Change home: Tallinn' }));
    expect(screen.queryByRole('radio', { name: 'Zaandam' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Tartu' }));
    await user.click(screen.getByRole('button', { name: 'Remove from saved' }));
    expect(JSON.parse(localStorage.getItem('funroads:favorites:v1')!)).toEqual(['sprint:test']);
    await user.click(screen.getByRole('button', { name: /^Sprint.*Test Road Sprint/ }));
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(within(await screen.findByRole('dialog')).getByText('Straight-line from Tartu').closest('div')).toHaveTextContent('65 km');
    expect(location.search).toBe('?country=ee');

    vi.mocked(loadAll).mockResolvedValue({ routes: { value: routes, error: null }, linked: { value: null, error: 'No linked data' } });
    act(() => {
      history.replaceState(null, '', '/#route=sprint%3Atest');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(screen.getByTestId('map-selection')).toHaveTextContent(/^sprint:test$/));
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(screen.getByRole('button', { name: 'Change home: Zaandam' })).toBeVisible();
    expect(vi.mocked(loadAll).mock.calls.at(-1)?.[2]?.id).toBe('nl');
    expect(screen.getByRole('heading', { name: 'FunRoads' })).toBeVisible();
  }, 10000);
});
