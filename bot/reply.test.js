import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { boundaryText, stageText } = createRequire(import.meta.url)('./reply.js');

describe('stageText', () => {
  it('sends a timed marker along with the lines', () => {
    expect(stageText('--- 10am', ['11am sleep'])).toBe('--- 10am\n11am sleep');
  });

  it('leaves a plain marker out', () => {
    expect(stageText('---', ['11am sleep'])).toBe('11am sleep');
    expect(stageText(null, ['11am sleep'])).toBe('11am sleep');
  });
});

describe('boundaryText', () => {
  it('names the start time of a timed marker', () => {
    expect(boundaryText('---10am', 5)).toBe('since the last `---`, starting at 10am');
    expect(boundaryText('---', 5)).toBe('since the last `---`');
    expect(boundaryText(null, 5)).toBe('from the last 5 messages');
  });
});
