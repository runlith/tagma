const VOWELS = 'аеиоуыэюя';

type SuffixRule = { suffix: string; afterAYa: boolean };

function rules(afterAYa: boolean, ...suffixes: string[]): SuffixRule[] {
  return suffixes.map((suffix) => ({ suffix, afterAYa }));
}

const PERFECTIVE_GERUND: SuffixRule[] = [
  ...rules(true, 'в', 'вши', 'вшись'),
  ...rules(false, 'ив', 'ивши', 'ившись', 'ыв', 'ывши', 'ывшись'),
];

const ADJECTIVE: SuffixRule[] = rules(
  false,
  'ее',
  'ие',
  'ые',
  'ое',
  'ими',
  'ыми',
  'ей',
  'ий',
  'ый',
  'ой',
  'ем',
  'им',
  'ым',
  'ом',
  'его',
  'ого',
  'ему',
  'ому',
  'их',
  'ых',
  'ую',
  'юю',
  'ая',
  'яя',
  'ою',
  'ею',
);

const PARTICIPLE: SuffixRule[] = [...rules(true, 'ем', 'нн', 'вш', 'ющ', 'щ'), ...rules(false, 'ивш', 'ывш', 'ующ')];

const REFLEXIVE: SuffixRule[] = rules(false, 'ся', 'сь');

const VERB: SuffixRule[] = [
  ...rules(true, 'ла', 'на', 'ете', 'йте', 'ли', 'й', 'л', 'ем', 'н', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'ешь', 'нно'),
  ...rules(
    false,
    'ила',
    'ыла',
    'ена',
    'ейте',
    'уйте',
    'ите',
    'или',
    'ыли',
    'ей',
    'уй',
    'ил',
    'ыл',
    'им',
    'ым',
    'ен',
    'ило',
    'ыло',
    'ено',
    'ят',
    'ует',
    'уют',
    'ит',
    'ыт',
    'ены',
    'ить',
    'ыть',
    'ишь',
    'ую',
    'ю',
  ),
];

const NOUN: SuffixRule[] = rules(
  false,
  'а',
  'ев',
  'ов',
  'ие',
  'ье',
  'е',
  'иями',
  'ями',
  'ами',
  'еи',
  'ии',
  'и',
  'ией',
  'ей',
  'ой',
  'ий',
  'й',
  'иям',
  'ям',
  'ием',
  'ем',
  'ам',
  'ом',
  'о',
  'у',
  'ах',
  'иях',
  'ях',
  'ы',
  'ь',
  'ию',
  'ью',
  'ю',
  'ия',
  'ья',
  'я',
);

const SUPERLATIVE: SuffixRule[] = rules(false, 'ейш', 'ейше');

const DERIVATIONAL: SuffixRule[] = rules(false, 'ост', 'ость');

export function russian(word: string): string {
  const { rv, r2 } = markRegions(word);

  let stem = cutSuffix(word, rv, PERFECTIVE_GERUND);
  if (stem === null) {
    const base = cutSuffix(word, rv, REFLEXIVE) ?? word;
    stem = cutAdjectival(base, rv) ?? cutSuffix(base, rv, VERB) ?? cutSuffix(base, rv, NOUN) ?? base;
  }

  if (stem.length - 1 >= rv && stem.endsWith('и')) stem = stem.slice(0, -1);

  stem = cutSuffix(stem, r2, DERIVATIONAL) ?? stem;

  return tidyUp(stem, rv);
}

function markRegions(word: string): { rv: number; r2: number } {
  const end = word.length;
  let at = 0;
  while (at < end && !isVowelAt(word, at)) at++;
  if (at === end) return { rv: end, r2: end };
  const rv = at + 1;

  at = rv;
  while (at < end && isVowelAt(word, at)) at++;
  if (at === end) return { rv, r2: end };
  at++;

  while (at < end && !isVowelAt(word, at)) at++;
  if (at === end) return { rv, r2: end };
  at++;

  while (at < end && isVowelAt(word, at)) at++;
  if (at === end) return { rv, r2: end };
  return { rv, r2: at + 1 };
}

function isVowelAt(word: string, index: number): boolean {
  return index >= 0 && index < word.length && VOWELS.includes(word.charAt(index));
}

function cutAdjectival(word: string, rv: number): string | null {
  const withoutAdjective = cutSuffix(word, rv, ADJECTIVE);
  if (withoutAdjective === null) return null;
  return cutSuffix(withoutAdjective, rv, PARTICIPLE) ?? withoutAdjective;
}

function cutSuffix(word: string, limit: number, ruleSet: readonly SuffixRule[]): string | null {
  let longest: SuffixRule | null = null;
  for (const rule of ruleSet) {
    if (word.length - rule.suffix.length < limit) continue;
    if (!word.endsWith(rule.suffix)) continue;
    if (longest === null || rule.suffix.length > longest.suffix.length) longest = rule;
  }
  if (longest === null) return null;

  const start = word.length - longest.suffix.length;
  if (longest.afterAYa && !(start > limit && 'ая'.includes(word.charAt(start - 1)))) return null;
  return word.slice(0, start);
}

function tidyUp(word: string, rv: number): string {
  const withoutSuperlative = cutSuffix(word, rv, SUPERLATIVE);
  if (withoutSuperlative !== null) return undoubleN(withoutSuperlative, rv);
  const undoubled = undoubleN(word, rv);
  if (undoubled !== word) return undoubled;
  if (word.length - 1 >= rv && word.endsWith('ь')) return word.slice(0, -1);
  return word;
}

function undoubleN(word: string, rv: number): string {
  return word.length - 2 >= rv && word.endsWith('нн') ? word.slice(0, -1) : word;
}
