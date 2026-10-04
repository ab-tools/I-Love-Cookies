import { describe, expect, it } from 'vitest';
import { SECONDS_PER_BANNER, formatTimeSaved } from '../../src/shared/stats';

describe('time saved', () => {
  it('picks a readable unit', () => {
    expect(SECONDS_PER_BANNER).toBe(3);
    expect(formatTimeSaved(5, 'en')).toBe('15 sec');
    expect(formatTimeSaved(400, 'en')).toBe('20 min');
    expect(formatTimeSaved(1800, 'en')).toBe('1.5 hr');
    expect(formatTimeSaved(100_000, 'en')).toBe('3.5 days');
  });
});
