import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RouteProfile } from '../data/model';
import { ProfileChart } from './ProfileChart';

const options = vi.hoisted(() => vi.fn());
vi.mock('uplot', () => ({
  default: class {
    constructor(config: unknown) { options(config); }
    setSize() {}
    destroy() {}
  },
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('sizes the profile to its narrow container rather than forcing horizontal overflow', () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
  const profile = { elev: [[0, 1], [1, 2]], curv: [] } as unknown as RouteProfile;
  render(<ProfileChart circuit={profile} totalKm={1} onCursorKm={vi.fn()} />);
  expect(options).toHaveBeenCalledWith(expect.objectContaining({ width: 240 }));
});
