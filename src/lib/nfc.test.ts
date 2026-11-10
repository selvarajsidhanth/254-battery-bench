import { describe, expect, it } from 'vitest';
import { NTAG213_BYTES, tagBytes, tagUrl } from './nfc';

describe('nfc tags', () => {
  it('builds the tap link from the real site, not the demo', () => {
    expect(tagUrl('2025-03e', 'https://example.github.io/battery-bench/')).toBe('https://example.github.io/battery-bench/#/b/2025-03e?tap');
    expect(tagUrl('2025-03e', 'https://example.github.io/battery-bench')).toBe('https://example.github.io/battery-bench/#/b/2025-03e?tap');
  });
  it('fits an NTAG213 with room to spare', () => {
    const url = tagUrl('2025-03e', 'https://selvarajsidhanth.github.io/254-battery-bench/');
    expect(tagBytes(url)).toBeLessThan(NTAG213_BYTES);
    expect(tagBytes('https://a.io/')).toBe(5 + 8);
  });
});
