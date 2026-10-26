import { js } from '@runlith/code-facts/adapters';
import { namesConfig } from '@runlith/code-facts/js/config';
import { sitesOf, type Tree } from '@runlith/code-facts/tree';
import { posix } from 'node:path';
import type { Change } from '../../../core/node/memo';
import { optionOf } from './routes';
import { inside, messageOf, type Of, pathOf } from './snapshot';
import { routedOf } from './starts';

const optionsOf = (params: Of, tree: Tree, path: string) =>
  params.apps.map((app) => {
    const option = app.routes?.option;
    const routed = routedOf(params, app);
    const name = posix.basename(path);
    if (option === undefined || routed === undefined || !inside(path, routed)) return null;
    if (!option.pages.includes(name) && !option.layouts.includes(name)) return null;
    return optionOf(tree, path, option.export, option.off) ?? null;
  });

const ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, one]) => one !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, one]) => [key, ordered(one)]),
        )
      : value;

const readingOf = (params: Of, tree: Tree, path: string): string => {
  let sites: string;
  try {
    sites = JSON.stringify(ordered(sitesOf(tree, path, [js])));
  } catch (error) {
    sites = `!${messageOf(error)}`;
  }
  try {
    return JSON.stringify([sites, optionsOf(params, tree, path)]);
  } catch (error) {
    return JSON.stringify([sites, `!${messageOf(error)}`]);
  }
};

export const compares = (params: Of): readonly string[] => (params.built ?? []).map(({ output }) => pathOf(params.base, output));

export function carries(params: Of, before: Tree, after: Tree, changes: readonly Change[]): boolean {
  if (changes.some(({ path, before: was, after: now }) => was === null || now === null || namesConfig(path))) return false;
  return changes.every(({ path }) => readingOf(params, before, path) === readingOf(params, after, path));
}
