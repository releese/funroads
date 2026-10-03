import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMediaQuery } from './hooks';

it('reconciles breakpoints on resize even without a media-query change event', () => {
  const original = window.matchMedia;
  let matches = false;
  const remove = vi.fn();
  window.matchMedia = vi.fn((media) => ({
    matches, media, addEventListener: vi.fn(), removeEventListener: remove,
  } as unknown as MediaQueryList));
  try {
    const hook = renderHook(() => useMediaQuery('(max-width: 767.98px)'));
    expect(hook.result.current).toBe(false);
    matches = true;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(hook.result.current).toBe(true);
    hook.unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  } finally {
    window.matchMedia = original;
  }
});
