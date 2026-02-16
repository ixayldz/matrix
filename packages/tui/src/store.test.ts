import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store.js';

describe('tui store scroll offsets', () => {
  beforeEach(() => {
    useStore.setState({
      scrollOffsets: {
        chat: 0,
        files: 0,
        diff: 0,
        session: 0,
      },
    });
  });

  it('clamps setScrollOffset to non-negative integers', () => {
    const { setScrollOffset } = useStore.getState();

    setScrollOffset('chat', -3.7);
    expect(useStore.getState().scrollOffsets.chat).toBe(0);

    setScrollOffset('chat', 4.9);
    expect(useStore.getState().scrollOffsets.chat).toBe(4);
  });

  it('applies scrollBy delta and prevents negative values', () => {
    const { scrollBy } = useStore.getState();

    scrollBy('diff', 5.8);
    expect(useStore.getState().scrollOffsets.diff).toBe(5);

    scrollBy('diff', -2.2);
    expect(useStore.getState().scrollOffsets.diff).toBe(3);

    scrollBy('diff', -99);
    expect(useStore.getState().scrollOffsets.diff).toBe(0);
  });
});
