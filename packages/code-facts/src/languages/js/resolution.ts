import { posix } from 'node:path';
import ts from 'typescript';
import type { Resolution } from '../../adapter';
import type { Tree } from '../../tree';
import { configResolver } from './config';
import { resolve } from './resolve';

const local = (path: string): string => path.replace(/^\//, '');

export const resolver = (tree: Tree) => {
  const configured = configResolver(tree, () => undefined, new Map());
  const answers = new Map<string, Resolution | null>();
  return (specifier: string, from: string): Resolution | null => {
    const key = `${from}\0${specifier}`;
    if (answers.has(key)) return answers.get(key)!;
    const relative = resolve(specifier, from, tree);
    let answer = relative;
    if (answer === null || !('to' in answer)) {
      const aliased = configured(specifier, from, tree, new Set());
      answer = aliased;
      if (answer === null || !('to' in answer)) {
        const found = ts.resolveModuleName(
          specifier,
          posix.resolve('/', from),
          {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
            allowJs: true,
            customConditions: ['bun'],
          },
          {
            fileExists: (path) => tree.has(local(path)),
            readFile: (path) => (tree.has(local(path)) ? tree.read(local(path)) : undefined),
            realpath: (path) => posix.resolve('/', tree.realpath?.(local(path)) ?? local(path)),
          },
        ).resolvedModule;
        answer = found === undefined ? (relative ?? aliased) : { to: local(found.resolvedFileName) };
      }
    }
    answers.set(key, answer);
    return answer;
  };
};
