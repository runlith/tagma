import type { HarnessTypedShape } from '../../threads/contract/wire/harness/externalSession.js';

const escaped = (id: string): string =>
  id.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const unescaped = (id: string): string =>
  id.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const digest = (text: string): string => new Bun.CryptoHasher('sha256').update(text).digest('hex');

const typable = (words: string): string => words.replaceAll('\u001b', '␛').replace(/\r\n?/g, '\n');

export const inputWords = (id: string, words: string): string => {
  const text = typable(words);
  return `<input envelope="${escaped(id)}" length="${text.length}" digest="${digest(text)}">\n${text}\n</input>`;
};

export const plainWords = (words: string): string => typable(words).trim();

export const promptDigest = (prompt: string): string => digest(plainWords(prompt));

const COLLAPSED_PASTE = /^\[Pasted text #\d+ \+(\d+) lines\]$/;

const unspaced = (text: string): string => digest(text.replace(/\s+/g, ''));

export const typedShape = (words: string): HarnessTypedShape => {
  const text = plainWords(words);
  return { digest: unspaced(text), breaks: text.split('\n').length - 1 };
};

export const typedBack = (shown: string, typed: readonly HarnessTypedShape[], counts: 'breaks' | 'lines'): boolean => {
  const collapsed = COLLAPSED_PASTE.exec(shown.trim());
  if (collapsed !== null) return typed.some((shape) => shape.breaks + (counts === 'lines' ? 1 : 0) === Number(collapsed[1]));
  const drawn = unspaced(shown);
  return typed.some((shape) => shape.digest === drawn);
};

type Envelope = { readonly id: string; readonly from: number; readonly to: number };

const envelopesIn = (text: string): readonly Envelope[] => {
  const found: Envelope[] = [];
  const openings = /(?:^|\n)<input envelope="([^"]+)" length="(\d+)" digest="([a-f0-9]{64})">\n/g;
  for (const match of text.matchAll(openings)) {
    const start = match.index + match[0].length;
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length > text.length - start) continue;
    const words = text.slice(start, start + length);
    const closing = '\n</input>';
    if (!text.startsWith(closing, start + length) || digest(words) !== match[3]) continue;
    found.push({ id: unescaped(match[1]!), from: match.index, to: start + length + closing.length });
  }
  return found;
};

export const inputEnvelopes = (prompt: string): readonly string[] => envelopesIn(prompt.replace(/\r\n?/g, '\n')).map((each) => each.id);

export const operatorWords = (prompt: string): string => {
  const text = prompt.replace(/\r\n?/g, '\n');
  let rest = '';
  let at = 0;
  for (const each of envelopesIn(text)) {
    rest += text.slice(at, each.from);
    at = each.to;
  }
  return (rest + text.slice(at)).trim();
};
