// Splits an event title into the activities it names, so "get ready + drive"
// and "drive" can be recognised as related. Bracketed context
// ("[train, bus] rr"), parenthesised qualifiers ("yt (long form)") and who it
// was with ("yap w jerry") are dropped.

export const normalizeTitle = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Standalone emoticons: ":>", ":3", ":D", ">:(", ":thumbsup:".
const EMOTICON_RE = /(^|\s)>?[:;](?:[^\sa-z]+|[dpo]|[a-z_]+:)(?=\s|$)/g;

// "yap w jerry, katherine" / "walk w/ izzie": the company, up to the next "/"
// or "+", since names are listed with "," and "and" but activities aren't.
// Kept after verbs where "w" belongs to the activity ("deal w bedding").
const WITH_RE = /(?<!\b(?:deal|dealing|help|helping))(?:^|\s+)w(?:\/\s*|\s+)[^/+]*/g;

const cleanPart = (s: string) => normalizeTitle(s).replace(/[!?.~]+$/, '');

const splitList = (s: string) =>
  s
    .split(/\s*(?:[/+&,]|\band\b)\s*/)
    .map(cleanPart)
    .filter(Boolean);

// "robo: website" / "robo -- website" / "robo - website". The colon must not
// precede a digit (so "call 10:30" is left alone) and the prefix stays short,
// since a long one is a sentence rather than a category.
const PREFIX_RE = /^([^:]+?)\s*(?::(?!\d)|\s-{1,2}\s)\s*(.+)$/;
const MAX_PREFIX_WORDS = 3;

export function titleParts(title: string): string[] {
  let t = normalizeTitle(title);
  const parts: string[] = [];

  t = t.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  t = t.replace(EMOTICON_RE, '$1');
  t = t.replace(WITH_RE, ' ');
  t = normalizeTitle(t);

  const m = t.match(PREFIX_RE);
  if (m && m[1].split(' ').length <= MAX_PREFIX_WORDS) {
    parts.push(cleanPart(m[1]));
    t = m[2];
  }
  parts.push(...splitList(t));

  return [...new Set(parts)];
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replaces `from` inside `title`, ignoring case and runs of spaces. 'word'
// only matches whole words, so renaming "rr" leaves "error" alone.
export function replaceInTitle(title: string, from: string, to: string, mode: 'word' | 'substring'): string {
  const body = normalizeTitle(from).split(' ').map(escapeRegExp).join('\\s+');
  if (!body) return title;
  const pattern = mode === 'word' ? `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])` : body;
  return title.replace(new RegExp(pattern, 'giu'), () => to);
}

// `to` as a whole new title, keeping any bracketed context from `title`:
// "[home] SLEEP!! :D yippee" -> "[home] sleep".
export function retitleKeepingBrackets(title: string, to: string): string {
  const brackets = title.match(/\[[^\]]*\]/g) ?? [];
  return [...brackets, to].join(' ');
}
