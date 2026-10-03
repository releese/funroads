import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseProvider } from 'baseui';
import { Provider } from 'styletron-react';
import { Client } from 'styletron-engine-monolithic';
import { theme } from '../theme';
import { validateRoutesDoc } from '../data/validate';
import { App } from './App';

vi.mock('../data/load', () => ({ loadAll: vi.fn() }));
vi.mock('../map/MapView', () => ({
  MapView: ({ selected, onBlank, onSelect, onInteract }: { selected: { key: string } | null; onBlank: () => void; onSelect: (key: string) => void; onInteract: () => void }) => (
    <div aria-label="Test map">
      <button onClick={() => { onInteract(); onBlank(); }}>Blank map</button>
      <button onClick={() => { onInteract(); onSelect('sprint:test'); }}>Pick route on map</button>
      <button onClick={onInteract}>Overlapping routes on map</button>
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
  window.history.replaceState(null, '', '/');
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('max-width: 767'), media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as MediaQueryList));
  const { loadAll } = await import('../data/load');
  vi.mocked(loadAll).mockResolvedValue({ routes: { value: routes, error: null }, linked: { value: null, error: 'No linked data' } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function mount() {
  render(<Provider value={new Client()}><BaseProvider theme={theme}><App dataBase="/" /></BaseProvider></Provider>);
}

describe('responsive interactions', () => {
  it('keeps collapsed sheet controls hidden and opens them deliberately', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByText('1 route');
    expect(screen.getByRole('button', { name: 'Browse routes' })).toHaveAttribute('aria-expanded', 'false');
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
    expect(dialog.getAllByRole('button', { name: /Roads and route composition|Before you drive|Score breakdown|Route facts and sources/ }).map((button) => button.textContent)).toEqual([
      'Roads and route compositionDown Small', 'Score breakdown (0–100)Down Small', 'Route facts and sourcesDown Small', 'Before you driveDown Small',
    ]);
    expect(screen.getByRole('button', { name: 'Blank map' }).closest('[inert]')).not.toBeNull();
    expect(within(screen.getByRole('dialog')).queryByText(/Access is based on sampled data/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Before you drive/ }));
    expect(within(screen.getByRole('dialog')).getByText(/Access is based on sampled data/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Sample departures/ })).not.toBeInTheDocument();
    const navigate = dialog.getByRole('link', { name: 'Open in Google Maps' });
    expect(navigate.closest('footer')).toHaveClass('fr-detail-navigation');
    expect(dialog.getByRole('button', { name: 'Add to favorites' }).closest('header')).toHaveClass('fr-detail-actions');
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

  it('previews a result on the map and resumes the same browse position', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    const card = screen.getByRole('button', { name: /Sprint Road fun average.*Test Road Sprint/ });
    const sheet = document.getElementById('sheet-body')!;
    sheet.scrollTop = 140;
    fireEvent.scroll(sheet);
    await user.click(card);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sheet).not.toBeVisible();
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
    expect(location.hash).not.toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(location.hash).toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(location.hash).not.toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Back to results' }));
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
    await user.click(screen.getByRole('button', { name: /Sprint Road fun average.*Test Road Sprint/ }));
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(within(await screen.findByRole('dialog')).getByText('Straight-line from Haarlem').closest('div')).toHaveTextContent('20 km');
  });

  it('selects ranking styles directly and restores focus when dismissed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Browse routes' }));
    await user.click(screen.getByRole('button', { name: 'Rank routes: Balanced' }));
    await user.click(screen.getByRole('radio', { name: 'Scenic' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Route ranking' })).not.toBeInTheDocument());
    const ranking = screen.getByRole('button', { name: 'Rank routes: Scenic' });
    await user.click(ranking);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(ranking).toHaveFocus());
    expect(screen.getByTestId('map-selection')).toHaveTextContent('none');
    await user.click(ranking);
    await user.click(screen.getByRole('button', { name: 'Close route ranking' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Route ranking' })).not.toBeInTheDocument());
    expect(ranking).toHaveAccessibleName('Rank routes: Scenic');
    await user.click(ranking);
    await user.click(screen.getByRole('button', { name: 'Nearest (direct)' }));
    expect(screen.getByRole('button', { name: 'Rank routes: Nearest (straight-line)' })).toBeVisible();
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
    expect(screen.getByRole('button', { name: /Sprint Road fun average.*Test Road Sprint/ })).toBeVisible();
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

  it('closes narrow desktop details coherently when showing the list', async () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('max-width: 1319'), media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList));
    const user = userEvent.setup();
    mount();
    const card = await screen.findByRole('button', { name: /Sprint Road fun average.*Test Road Sprint/ });
    await user.click(card);
    expect(screen.getByRole('region', { name: 'Route details' })).toHaveClass('fr-detail-panel');
    expect(location.hash).toContain('detail=1');
    await user.click(screen.getByRole('button', { name: 'Show list' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Route details' })).not.toBeInTheDocument());
    expect(location.hash).not.toContain('detail=1');
    expect(card).toBeVisible();
    expect(screen.getByTestId('map-selection')).toHaveTextContent('sprint:test');
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
