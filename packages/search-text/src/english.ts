const VOWELS = 'aeiouy';
const DOUBLES = ['bb', 'dd', 'ff', 'gg', 'mm', 'nn', 'pp', 'rr', 'tt'];
const LI_ENDINGS = 'cdeghkmnrt';
const R1_PREFIXES = ['gener', 'commun', 'arsen'];

const EXCEPTIONS = new Map([
  ['skis', 'ski'],
  ['skies', 'sky'],
  ['dying', 'die'],
  ['lying', 'lie'],
  ['tying', 'tie'],
  ['idly', 'idl'],
  ['gently', 'gentl'],
  ['ugly', 'ugli'],
  ['early', 'earli'],
  ['only', 'onli'],
  ['singly', 'singl'],
  ['sky', 'sky'],
  ['news', 'news'],
  ['howe', 'howe'],
  ['atlas', 'atlas'],
  ['cosmos', 'cosmos'],
  ['bias', 'bias'],
  ['andes', 'andes'],
]);

const INVARIANT_AFTER_1A = new Set(['inning', 'outing', 'canning', 'herring', 'earring', 'proceed', 'exceed', 'succeed']);

const STEP_1B = ['eedly', 'ingly', 'edly', 'eed', 'ing', 'ed'];

const STEP_2 = longestFirst([
  ['ization', 'ize'],
  ['ational', 'ate'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['iveness', 'ive'],
  ['tional', 'tion'],
  ['biliti', 'ble'],
  ['lessli', 'less'],
  ['entli', 'ent'],
  ['ation', 'ate'],
  ['alism', 'al'],
  ['aliti', 'al'],
  ['ousli', 'ous'],
  ['iviti', 'ive'],
  ['fulli', 'ful'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['abli', 'able'],
  ['izer', 'ize'],
  ['ator', 'ate'],
  ['alli', 'al'],
  ['bli', 'ble'],
  ['ogi', 'og'],
  ['li', ''],
]);

const STEP_3 = longestFirst([
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['alize', 'al'],
  ['icate', 'ic'],
  ['iciti', 'ic'],
  ['ative', ''],
  ['ical', 'ic'],
  ['ness', ''],
  ['ful', ''],
]);

const STEP_4 = [
  'ement',
  'ance',
  'ence',
  'able',
  'ible',
  'ment',
  'ant',
  'ent',
  'ism',
  'ate',
  'iti',
  'ous',
  'ive',
  'ize',
  'ion',
  'al',
  'er',
  'ic',
];

export function english(word: string): string {
  if (word.length <= 2) return word;
  const exception = EXCEPTIONS.get(word);
  if (exception !== undefined) return exception;

  let w = markY(word);
  const r1 = regionOne(w);
  const r2 = regionAfter(w, r1);

  w = step1a(w);
  if (INVARIANT_AFTER_1A.has(w)) return w;
  w = step1b(w, r1);
  w = step1c(w);
  w = replaceIn(w, r1, STEP_2, (stem, suffix) =>
    suffix === 'ogi' ? stem.endsWith('l') : suffix === 'li' ? LI_ENDINGS.includes(stem.charAt(stem.length - 1)) : true,
  );
  w = replaceIn(w, r1, STEP_3, (stem, suffix) => suffix !== 'ative' || stem.length >= r2);
  w = step4(w, r2);
  w = step5(w, r1, r2);
  return w.replaceAll('Y', 'y');
}

function longestFirst(pairs: [string, string][]): [string, string][] {
  return pairs.toSorted((a, b) => b[0].length - a[0].length);
}

function isVowel(char: string): boolean {
  return char !== '' && VOWELS.includes(char);
}

function markY(word: string): string {
  const marked = word.startsWith('y') ? `Y${word.slice(1)}` : word;
  return marked.replace(/([aeiouy])y/g, '$1Y');
}

function regionOne(word: string): number {
  const prefix = R1_PREFIXES.find((one) => word.startsWith(one));
  return prefix === undefined ? regionAfter(word, 0) : prefix.length;
}

function regionAfter(word: string, start: number): number {
  for (let at = start + 1; at < word.length; at++) {
    if (!isVowel(word.charAt(at)) && isVowel(word.charAt(at - 1))) return at + 1;
  }
  return word.length;
}

function endsShortSyllable(word: string): boolean {
  const n = word.length;
  if (n === 2) return isVowel(word.charAt(0)) && !isVowel(word.charAt(1));
  if (n < 3) return false;
  const last = word.charAt(n - 1);
  return !isVowel(last) && !'wxY'.includes(last) && isVowel(word.charAt(n - 2)) && !isVowel(word.charAt(n - 3));
}

function step1a(w: string): string {
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ied') || w.endsWith('ies')) return w.length > 4 ? w.slice(0, -2) : w.slice(0, -1);
  if (w.endsWith('us') || w.endsWith('ss')) return w;
  if (w.endsWith('s') && /[aeiouy]/.test(w.slice(0, -2))) return w.slice(0, -1);
  return w;
}

function step1b(w: string, r1: number): string {
  const suffix = STEP_1B.find((one) => w.endsWith(one));
  if (suffix === undefined) return w;
  const stem = w.slice(0, -suffix.length);
  if (suffix === 'eed' || suffix === 'eedly') return stem.length >= r1 ? `${stem}ee` : w;
  if (!/[aeiouy]/.test(stem)) return w;
  if (stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz')) return `${stem}e`;
  if (DOUBLES.some((double) => stem.endsWith(double))) return stem.slice(0, -1);
  if (r1 >= stem.length && endsShortSyllable(stem)) return `${stem}e`;
  return stem;
}

function step1c(w: string): string {
  const last = w.charAt(w.length - 1);
  if ((last === 'y' || last === 'Y') && w.length > 2 && !isVowel(w.charAt(w.length - 2))) return `${w.slice(0, -1)}i`;
  return w;
}

function replaceIn(
  w: string,
  region: number,
  table: readonly [string, string][],
  allowed: (stem: string, suffix: string) => boolean,
): string {
  const found = table.find(([suffix]) => w.endsWith(suffix));
  if (found === undefined) return w;
  const [suffix, replacement] = found;
  const stem = w.slice(0, -suffix.length);
  if (stem.length < region || !allowed(stem, suffix)) return w;
  return stem + replacement;
}

function step4(w: string, r2: number): string {
  const suffix = STEP_4.find((one) => w.endsWith(one));
  if (suffix === undefined) return w;
  const stem = w.slice(0, -suffix.length);
  if (stem.length < r2) return w;
  if (suffix === 'ion' && !stem.endsWith('s') && !stem.endsWith('t')) return w;
  return stem;
}

function step5(w: string, r1: number, r2: number): string {
  const at = w.length - 1;
  if (w.endsWith('e') && (at >= r2 || (at >= r1 && !endsShortSyllable(w.slice(0, -1))))) return w.slice(0, -1);
  if (w.endsWith('l') && at >= r2 && w.charAt(at - 1) === 'l') return w.slice(0, -1);
  return w;
}
