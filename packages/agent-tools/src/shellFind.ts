import type { ShellWord } from './shellCommands';

type FindMutation = { readonly writes: boolean; readonly roots: readonly ShellWord[] | null };
const OPAQUE: FindMutation = { writes: true, roots: null };
const READS: FindMutation = { writes: false, roots: null };
const ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
const VALUES = new Set([
  '-name',
  '-iname',
  '-path',
  '-ipath',
  '-wholename',
  '-iwholename',
  '-regex',
  '-iregex',
  '-regextype',
  '-type',
  '-xtype',
  '-fstype',
  '-user',
  '-group',
  '-uid',
  '-gid',
  '-size',
  '-perm',
  '-inum',
  '-links',
  '-maxdepth',
  '-mindepth',
  '-mtime',
  '-mmin',
  '-ctime',
  '-cmin',
  '-atime',
  '-amin',
  '-newer',
  '-anewer',
  '-cnewer',
  '-lname',
  '-ilname',
  '-samefile',
  '-used',
  '-context',
  '-printf',
  '-Bmin',
  '-Btime',
]);

export function findMutation(words: readonly ShellWord[]): FindMutation {
  const roots: ShellWord[] = [];
  let at = 1;
  for (; at < words.length; at++) {
    const word = words[at] as ShellWord;
    if (!word.literal && word.glob === undefined) return OPAQUE;
    if (word.literal && (/^-[HLPXdsE]+$/.test(word.text) || word.text === '--') && roots.length === 0) continue;
    if (word.literal && word.text === '-f') {
      const root = words[++at];
      if (root === undefined) return OPAQUE;
      roots.push(root);
      continue;
    }
    if (/^-(?:files0-from(?:=|$)|D$|O)/.test(word.text)) return OPAQUE;
    if (word.text.startsWith('-') || word.text === '!' || word.text === '(') break;
    roots.push(word);
  }
  let deleted = false;
  for (; at < words.length; at++) {
    const word = words[at] as ShellWord;
    if (!word.literal || ACTIONS.has(word.text)) return OPAQUE;
    if (word.text === '-delete') deleted = true;
    if (VALUES.has(word.text) || /^-newer[acmBt][acmBt]$/.test(word.text)) {
      const value = words[++at];
      if (value === undefined || !value.literal) return OPAQUE;
    }
  }
  return deleted ? { writes: true, roots: roots.length === 0 ? [{ text: '.', literal: true }] : roots } : READS;
}
