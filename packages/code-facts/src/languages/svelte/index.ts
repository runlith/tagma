import { UnsupportedSource } from '../../imports';
import type { Embedded, Embedding } from '../js/imports';
import { language } from './language';

const SCRIPT = /<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

const MODULE_SCRIPT = /\s(?:module|context\s*=\s*module)(?=[\s/>])/i;

const moduleScript = (tag: string): boolean =>
  MODULE_SCRIPT.test(
    tag.replace(/"([^"]*)"|'([^']*)'/g, (_, double?: string, single?: string) => ((double ?? single) === 'module' ? 'module' : '""')),
  );

const commentedOut = (source: string, at: number): boolean => {
  const opened = source.lastIndexOf('<!--', at);
  if (opened === -1) return false;
  const closed = source.indexOf('-->', opened);
  return closed === -1 || closed > at;
};

export const svelte: Embedding = {
  ...language,
  scripts: (source, path) => {
    const scripts: Embedded[] = [];
    for (const match of source.matchAll(SCRIPT)) {
      if (commentedOut(source, match.index)) continue;
      const opens = match.index + match[0].length;
      const closes = source.indexOf('</script', opens);
      if (closes === -1) throw new UnsupportedSource(path, 'a <script> block is never closed');
      scripts.push({ text: source.slice(opens, closes), at: opens, module: moduleScript(match[0]) });
    }
    return scripts;
  },
};
