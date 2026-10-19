import { describe, expect, it } from 'vitest';
import { normalizeTitle, replaceInTitle, retitleKeepingBrackets, titleParts } from './titleParts';

describe('titleParts', () => {
  it.each([
    ['get ready + drive', ['get ready', 'drive']],
    ['yt (long form)', ['yt', 'long form']],
    ['[train, bus] rr', ['rr']],
    ['yap w jerry, katherine', ['yap']],
    ['walk w/ izzie', ['walk']],
    ['deal w bedding', ['deal w bedding']],
    ['robo: website', ['robo', 'website']],
    ['robo -- website', ['robo', 'website']],
    ['call 10:30', ['call 10:30']],
    ['sleep :D', ['sleep']],
    ['study >:(', ['study']],
    ['Lunch  AND  dinner!!', ['lunch', 'dinner']],
  ])('%s', (title, parts) => {
    expect(titleParts(title)).toEqual(parts);
  });

  it('keeps a long colon prefix as part of the sentence', () => {
    expect(titleParts('read the whole thing: chapter 2')).toEqual(['read the whole thing: chapter 2']);
  });

  it('dedupes repeated parts', () => {
    expect(titleParts('drive + drive')).toEqual(['drive']);
  });
});

describe('normalizeTitle', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTitle('  Get   Ready ')).toBe('get ready');
  });
});

describe('replaceInTitle', () => {
  it('matches whole words only in word mode', () => {
    expect(replaceInTitle('error rr', 'rr', 'run', 'word')).toBe('error run');
  });

  it('matches inside words in substring mode', () => {
    expect(replaceInTitle('error rr', 'rr', 'R', 'substring')).toBe('eRor R');
  });

  it('ignores case and runs of spaces', () => {
    expect(replaceInTitle('Get  Ready + drive', 'get ready', 'prep', 'word')).toBe('prep + drive');
  });

  it('treats regex characters literally', () => {
    expect(replaceInTitle('c++ (lab)', 'c++', 'cpp', 'substring')).toBe('cpp (lab)');
  });

  it('leaves the title alone for an empty pattern', () => {
    expect(replaceInTitle('drive', '  ', 'x', 'word')).toBe('drive');
  });
});

describe('retitleKeepingBrackets', () => {
  it('keeps bracketed context', () => {
    expect(retitleKeepingBrackets('[home] SLEEP!! :D yippee', 'sleep')).toBe('[home] sleep');
  });

  it('just uses the new title without brackets', () => {
    expect(retitleKeepingBrackets('nap', 'sleep')).toBe('sleep');
  });
});
