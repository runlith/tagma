import { importsOf } from '@runlith/code-facts/tree';
import { matchesGlob } from 'node:path';
import type { Implementation } from '../../../core/node/reading';
import { localOf, picks } from '../../../core/node/select';
import { unitsOf } from '../../../core/verdict';
import type { reexports as declared } from './declaration';

type Of = typeof declared.params.Type;

const selects = (params: Of, path: string): boolean => {
  const local = localOf(params.base, path);
  return local !== undefined && picks(params.files, local) && !params.allows.some((glob) => matchesGlob(local, glob));
};

export const reexports: Implementation<Of> = {
  lists: (params) => [params.base],
  selects,
  read: (params, tree, paths, adapters) => ({
    violations: unitsOf(
      paths.flatMap((path) => {
        const local = localOf(params.base, path);
        if (local === undefined || !selects(params, path)) return [];
        return importsOf(tree, path, 'forwards', adapters).map(({ specifier, line }) => ({
          fingerprint: `${local} -> ${specifier}`,
          file: path,
          line,
          specifier,
          message: `re-exports \`${specifier}\``,
          fix: `Import what it forwards from \`${specifier}\` directly where it is used, and delete the forwarding here.`,
        }));
      }),
    ),
    unjudged: [],
  }),
};
