import { isAbsolute, relative, resolve } from 'node:path';
import { displayLanguage } from '@runlith/utils/codeLanguage';
import { toolFilePatch, type ToolDisplay, type ToolDisplayFact } from '@runlith/agent/tool/display';

export function displayPath(cwd: string, target: string): string {
  const absolute = isAbsolute(target) ? target : resolve(cwd, target);
  const inside = relative(resolve(cwd), absolute);
  return inside && !inside.startsWith('..') ? inside : absolute;
}

export function searchedIn(cwd: string, target: string | undefined): string | undefined {
  if (target === undefined) return undefined;
  const absolute = isAbsolute(target) ? target : resolve(cwd, target);
  return relative(resolve(cwd), absolute) === '' ? undefined : `in ${displayPath(cwd, target)}`;
}

export function filePatch(cwd: string, target: string, before: string, after: string): ToolDisplay {
  const file = toolFilePatch(displayPath(cwd, target), before, after);
  return { form: 'diff', title: file.path, files: [file] };
}

export function fileCode(cwd: string, target: string, content: string, status: 'created' | 'wrote'): ToolDisplay {
  const path = displayPath(cwd, target);
  const language = displayLanguage(path);
  return {
    form: 'code',
    title: path,
    path,
    language: language || undefined,
    firstLine: 1,
    text: content,
    opens: true,
    facts: [{ label: status, value: `${content.length === 0 ? 0 : content.split('\n').length} lines` }],
  };
}

export function binaryFile(cwd: string, target: string, byteLength: number): ToolDisplay {
  const path = displayPath(cwd, target);
  return { form: 'binary', title: path, path, byteLength };
}

export function pageWindow(from: number, shown: number, total: number): string {
  if (from === 0) return shown === total ? `${total}` : `${shown} of ${total}`;
  return `${from + 1}-${from + shown} of ${total}`;
}

const counted = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export function displayCount(label: string, count: number): ToolDisplayFact {
  return { label, value: String(count) };
}

export function searchCount(matches: number | null, files: number): ToolDisplayFact {
  if (matches === null) return { label: counted(files, 'file', 'files') };
  if (matches === 0) return { label: 'no matches' };
  return { label: `${counted(matches, 'match', 'matches')} in ${counted(files, 'file', 'files')}` };
}
