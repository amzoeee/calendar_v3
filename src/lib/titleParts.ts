// Splits an event title into the activities it names, so "get ready + drive"
// and "drive" can be recognised as related. Which separators split and what
// gets ignored is set per user in Settings (NameMatching).

export const normalizeTitle = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export const SEPARATORS = ['/', '+', '&', ',', 'and'] as const;
export type Separator = (typeof SEPARATORS)[number];

export interface NameMatching {
  separators: Separator[];
  ignoreBrackets: boolean;
  ignoreParens: boolean;
  ignoreEmoticons: boolean;
  // "yap w jerry", "walk w/ izzie", "hang out with ashley".
  ignoreCompany: boolean;
  // "robo: website" also yields "robo".
  categoryPrefixes: boolean;
  // Verbs whose "w"/"with" is part of the activity ("deal w bedding").
  keepWithAfter: string[];
  // Phrases that contain a separator but are one name ("cats and soup").
  neverSplit: string[];
}

export const DEFAULT_NAME_MATCHING: NameMatching = {
  separators: [...SEPARATORS],
  ignoreBrackets: true,
  ignoreParens: true,
  ignoreEmoticons: true,
  ignoreCompany: true,
  categoryPrefixes: true,
  keepWithAfter: ['deal', 'help'],
  neverSplit: [],
};

const MAX_LIST = 100;
const MAX_WORD = 80;

const cleanList = (v: unknown, fallback: string[]) =>
  Array.isArray(v)
    ? [...new Set(v.filter((w): w is string => typeof w === 'string').map(normalizeTitle).filter(Boolean))]
        .map((w) => w.slice(0, MAX_WORD))
        .slice(0, MAX_LIST)
    : fallback;

/** Reads stored rules, falling back to the defaults for anything missing or malformed. */
export function parseNameMatching(raw: unknown): NameMatching {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_NAME_MATCHING;
  const bool = (k: keyof NameMatching) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean));
  return {
    separators: Array.isArray(r.separators)
      ? SEPARATORS.filter((sep) => (r.separators as unknown[]).includes(sep))
      : d.separators,
    ignoreBrackets: bool('ignoreBrackets'),
    ignoreParens: bool('ignoreParens'),
    ignoreEmoticons: bool('ignoreEmoticons'),
    ignoreCompany: bool('ignoreCompany'),
    categoryPrefixes: bool('categoryPrefixes'),
    keepWithAfter: cleanList(r.keepWithAfter, d.keepWithAfter),
    neverSplit: cleanList(r.neverSplit, d.neverSplit),
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Standalone emoticons: ":>", ":3", ":D", ">:(", ":thumbsup:".
const EMOTICON_RE = /(^|\s)>?[:;](?:[^\sa-z]+|[dpo]|[a-z_]+:)(?=\s|$)/g;

// "robo: website" / "robo -- website" / "robo - website". The colon must not
// precede a digit (so "call 10:30" is left alone) and the prefix stays short,
// since a long one is a sentence rather than a category.
const PREFIX_RE = /^([^:]+?)\s*(?::(?!\d)|\s-{1,2}\s)\s*(.+)$/;
const MAX_PREFIX_WORDS = 3;

// Stands in for a never-split phrase while splitting; contains no separator.
const HOLD = '\u0001';

const cleanPart = (s: string) => normalizeTitle(s).replace(/[!?.~]+$/, '');

interface Compiled {
  company: RegExp | null;
  split: RegExp | null;
  neverSplit: { re: RegExp; phrase: string }[];
}

const compiled = new WeakMap<NameMatching, Compiled>();

function compile(rules: NameMatching): Compiled {
  const hit = compiled.get(rules);
  if (hit) return hit;

  // The company runs to the next "/" or "+", since names are listed with ","
  // and "and" but activities aren't: "yap w kishan, peyton / sleep".
  const keep = rules.keepWithAfter.map((w) => escapeRegExp(w).replace(/ /g, '\\s+'));
  const keepGuard = keep.length ? `(?<!\\b(?:${keep.join('|')})(?:ing)?)` : '';
  const company = rules.ignoreCompany
    ? new RegExp(`${keepGuard}(?:^|\\s+)(?:w|with)\\s+[^/+]*`, 'g')
    : null;

  const chars = rules.separators.filter((sep) => sep !== 'and').map(escapeRegExp).join('');
  const alts = [...(chars ? [`[${chars}]`] : []), ...(rules.separators.includes('and') ? ['\\band\\b'] : [])];
  const split = alts.length ? new RegExp(`\\s*(?:${alts.join('|')})\\s*`) : null;

  const neverSplit = rules.neverSplit.map((phrase) => ({
    phrase,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}])`, 'gu'),
  }));

  const out = { company, split, neverSplit };
  compiled.set(rules, out);
  return out;
}

export function titleParts(title: string, rules: NameMatching = DEFAULT_NAME_MATCHING): string[] {
  const c = compile(rules);
  let t = normalizeTitle(title);
  const parts: string[] = [];

  if (rules.ignoreBrackets) t = t.replace(/\[[^\]]*\]/g, ' ');
  if (rules.ignoreParens) t = t.replace(/\([^)]*\)/g, ' ');
  if (rules.ignoreEmoticons) t = t.replace(EMOTICON_RE, '$1');
  // "w/" is a word, not a "/" separator.
  t = t.replace(/\bw\/\s*/g, 'w ');
  if (c.company) t = t.replace(c.company, ' ');
  t = normalizeTitle(t);

  const held: string[] = [];
  for (const { re, phrase } of c.neverSplit) {
    t = t.replace(re, () => `${HOLD}${held.push(phrase) - 1}${HOLD}`);
  }
  const restore = (s: string) => s.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, 'g'), (_, i) => held[Number(i)]);

  const m = rules.categoryPrefixes ? t.match(PREFIX_RE) : null;
  if (m && m[1].split(' ').length <= MAX_PREFIX_WORDS) {
    parts.push(cleanPart(restore(m[1])));
    t = m[2];
  }
  const pieces = c.split ? t.split(c.split) : [t];
  parts.push(...pieces.map((p) => cleanPart(restore(p))).filter(Boolean));

  return [...new Set(parts)];
}

// Replaces `from` inside `title`, ignoring case and runs of spaces. 'word'
// only matches whole words, so renaming "rr" leaves "error" alone.
export function replaceInTitle(title: string, from: string, to: string, mode: 'word' | 'substring'): string {
  const body = normalizeTitle(from).split(' ').map(escapeRegExp).join('\\s+');
  if (!body) return title;
  const pattern = mode === 'word' ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body;
  return title.replace(new RegExp(pattern, 'giu'), () => to);
}
