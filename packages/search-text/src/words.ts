const SEPARATOR = /[^\p{L}\p{M}\p{N}_./#-]+/u;
const TRAILING = /[./-]+$/u;
const WORDLIKE = /[\p{L}\p{N}]/u;
const ASCII = /^[\x00-\x7f]*$/;
const IDENTIFIER = /[_./#\p{N}-]/u;
const LATIN_MARKS = /(\p{Script=Latin})\p{M}+/gu;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

export function normalize(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase();
  return text.toLowerCase().normalize('NFD').replace(LATIN_MARKS, '$1').normalize('NFC').replaceAll('ё', 'е');
}

export function words(text: string): string[] {
  const found: string[] = [];
  for (const token of normalize(text).split(SEPARATOR)) {
    const word = token.replace(TRAILING, '');
    if (!WORDLIKE.test(word)) continue;
    if (!UNSPACED.test(word) || IDENTIFIER.test(word)) {
      found.push(word);
      continue;
    }
    for (const piece of segmenter.segment(word)) if (piece.isWordLike) found.push(piece.segment);
  }
  return found;
}
