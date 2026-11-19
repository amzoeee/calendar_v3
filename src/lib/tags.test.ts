import { describe, expect, it } from 'vitest';
import { suggestTagColor, TAG_PALETTE } from './tags';

describe('suggestTagColor', () => {
  it('starts at the top of the palette', () => {
    expect(suggestTagColor([])).toBe(TAG_PALETTE[0]);
  });

  it('skips colors already taken, whatever their case', () => {
    expect(suggestTagColor([TAG_PALETTE[0].toUpperCase()])).toBe(TAG_PALETTE[1]);
  });

  it('skips a palette color close to a hand-picked one', () => {
    expect(suggestTagColor(['#3a80f0'])).toBe(TAG_PALETTE[1]);
  });

  it('ignores colors it cannot read', () => {
    expect(suggestTagColor(['not a color', ''])).toBe(TAG_PALETTE[0]);
  });

  it('walks the palette without repeats', () => {
    const used: string[] = [];
    for (let i = 0; i < TAG_PALETTE.length; i++) used.push(suggestTagColor(used));
    expect(new Set(used).size).toBe(TAG_PALETTE.length);
  });

  it('still answers once every palette color is used', () => {
    expect(TAG_PALETTE).toContain(suggestTagColor([...TAG_PALETTE]));
  });
});
