// Splits an event title into the activities it names, so "get ready + drive"
// and "drive" can be recognised as related. Bracketed context
// ("[train, bus] rr") and parenthesised qualifiers ("yt (long form)") are
// dropped.

export const normalizeTitle = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Standalone emoticons: ":>", ":3", ":D", ">:(", ":thumbsup:".
const EMOTICON_RE = /(^|\s)>?[:;](?:[^\sa-z]+|[dpo]|[a-z_]+:)(?=\s|$)/g;

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
  t = t.replace(/\bw\//g, 'with ');
  t = normalizeTitle(t);

  const m = t.match(PREFIX_RE);
  if (m && m[1].split(' ').length <= MAX_PREFIX_WORDS) {
    parts.push(cleanPart(m[1]));
    t = m[2];
  }
  parts.push(...splitList(t));

  return [...new Set(parts)];
}
