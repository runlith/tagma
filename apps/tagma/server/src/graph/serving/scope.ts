import { Effect } from 'effect';
import { basename, dirname, isAbsolute } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import { sourceSpelling } from '../contract/wire/sources.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import { source, block } from '../store/tables.js';
import { sameOrInside } from '../../projects/resolution.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import type { Projects } from '../../projects/contract/service/registry.js';
import { GraphScopes } from '../contract/service/serving.js';
import { insideRelative, sourcePath } from '../sources/readers/place.js';
import type { BlockNames, BlockRow } from '../contract/service/acts.js';
import type { BlockRows } from '../acts/rows.js';
import { GateRefusal, type GitRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { placeAt } from '../../projects/identity.js';
import type { readsOf } from '../acts/reads.js';
import { checkoutAt } from '../../workspace/checkouts/git.js';
import { blockName } from '../contract/wire/references.js';
import type { policyRows } from './policy.js';
import { ownsCheckout } from './checkout.js';

export const graphScopes = (input: {
  readonly db: StoreDb<'graph'>;
  readonly reads: ReturnType<typeof readsOf>;
  readonly git: Git['Service'];
  readonly projects: Projects['Service'];
  readonly blockRows: BlockRows['Service'];
  readonly blockNames: BlockNames['Service'];
  readonly byId: ReturnType<typeof policyRows>['byId'];
}) => {
  const { db, reads, git, blockRows, blockNames, byId } = input;
  const resolve = input.projects.resolve;

  const checkout = (cwd: string) => Effect.mapError(checkoutAt(git, cwd), gitRefusal);

  const relativePlace = Effect.fn('Projects.relativePlace')(function* (
    row: ProjectRow,
    cwd: string,
  ): Effect.fn.Return<string | undefined, GateRefusal<GitRefusal>> {
    const here = yield* checkout(cwd);
    if (here !== null) return (yield* ownsCheckout(row, here)) ? here.path : undefined;
    if (!sameOrInside(cwd, row.rootPath)) return undefined;
    const rest = cwd.replace(/\/+$/, '').slice(row.rootPath.replace(/\/+$/, '').length);
    return rest === '' ? '.' : rest.replace(/^\/+/, '');
  });

  const zoneByPlace = reads(
    Effect.fn('Projects.zoneByPlace')(function* (projectId: number, place: string) {
      const sourced = yield* db
        .select({ block, path: source.ref })
        .from(source)
        .innerJoin(block, eq(block.id, source.blockId))
        .where(and(eq(source.kind, 'dir'), eq(block.projectId, projectId), isNull(block.deletedAt)));
      let best: { block: BlockRow; path: string } | undefined;
      for (const item of sourced) {
        const path = item.path.replace(/\/+$/, '');
        if (path === '.' || !insideRelative(place, path)) continue;
        if (best === undefined || path.length > best.path.length) best = { block: item.block, path };
      }
      return best?.block;
    }),
  );

  const scopeByPlace = reads(
    Effect.fn('Projects.scopeByPlace')(function* (
      projectId: number,
      cwd: string,
    ): Effect.fn.Return<BlockRow | undefined, StoreFailure | GateRefusal<'not-found' | GitRefusal>> {
      const row = yield* byId(projectId);
      const place = yield* relativePlace(row, cwd);
      if (place === undefined || place === '.') return undefined;
      return yield* zoneByPlace(projectId, place);
    }),
  );

  const placeOf = reads(
    Effect.fn('Projects.placeOf')(function* (
      projectId: number,
      spelling: string,
    ): Effect.fn.Return<
      { place: string; symbol: string | undefined },
      StoreFailure | GateRefusal<'not-found' | 'source-outside' | GitRefusal>
    > {
      const row = yield* byId(projectId);
      const { ref: rawPath, symbol } = sourceSpelling(spelling);
      const dir = isAbsolute(rawPath) ? yield* relativePlace(row, dirname(rawPath)) : undefined;
      const place = isAbsolute(rawPath)
        ? dir === undefined
          ? undefined
          : dir === '.'
            ? basename(rawPath)
            : `${dir}/${basename(rawPath)}`
        : sourcePath(rawPath);
      if (place === undefined || place === null) {
        return yield* new GateRefusal('source-outside', `"${rawPath}" is not a place inside the project`, [
          'name a path relative to the project root, or an absolute path inside it',
        ]);
      }
      return { place, symbol };
    }),
  );

  const scope = reads(
    Effect.fn('Projects.scope')(function* (
      projectId: number,
      scopeId: number,
    ): Effect.fn.Return<BlockRow, StoreFailure | GateRefusal<'not-found' | 'deleted' | 'scope-outside-project'>> {
      const row = yield* blockRows.blockById(scopeId);
      if (row.projectId !== projectId) {
        return yield* new GateRefusal(
          'scope-outside-project',
          `${blockName(row.uuid)} belongs to project "${(yield* byId(row.projectId)).name}"`,
          ['name a block of the scoped project, or drop the scope'],
        );
      }
      return row;
    }),
  );

  return GraphScopes.of({
    zoneByPlace,
    scopeByPlace,
    placeOf,
    scope,

    lens: Effect.fn('Projects.lens')(function* (input: { project?: string; cwd?: string; scopeName?: string }) {
      const named = input.project ? yield* resolve(input.project) : undefined;
      if (input.scopeName !== undefined) {
        const named_scope = yield* blockRows.blockById(yield* blockNames.idOfName(input.scopeName));
        if (named !== undefined) yield* scope(named.id, named_scope.id);
        return { projectId: named_scope.projectId, scopeId: named_scope.id };
      }
      const here = named ?? (yield* resolve(undefined, yield* placeAt(input.cwd)));
      if (here === undefined) return {};
      const place = named === undefined && input.cwd !== undefined ? yield* scopeByPlace(here.id, input.cwd) : undefined;
      return { projectId: here.id, scopeId: place?.id };
    }),
  });
};
