const DENSE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function trigramForm(word: string): string {
  if (!DENSE.test(word)) return word;
  let form = '';
  for (const char of word) form += DENSE.test(char) ? char + char : char;
  return form;
}
