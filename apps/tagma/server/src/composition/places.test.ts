import { layer } from '@runlith/effect-test';
import { world } from '@runlith/testbed/worlds';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { catalogWorld } from './testing/catalogWorld.js';
import type { Operation } from '../platform/contract/wire/operation.js';
import { isSubject } from '../platform/contract/wire/place.js';
import { inputFields } from '../platform/contract/wire/subjects.js';

const SUBJECT_NAMES = new Set([
  'cursor',
  'blockId',
  'blockIds',
  'scopeId',
  'parentId',
  'fromId',
  'toId',
  'oldId',
  'withId',
  'ontoId',
  'rule',
  'rules',
  'threadId',
  'threadIds',
  'threads',
  'rootId',
  'rootIds',
  'root',
  'checkout',
  'worktree',
  'path',
  'paths',
  'cwd',
  'project',
]);

const PLACED_ALONE: ReadonlySet<string> = new Set(['checkout', 'worktree', 'thread', 'cursor']);

const faultsOf = (id: string, entry: Operation, computed: boolean): readonly string[] => {
  const fields = inputFields(entry.params);
  const faults: string[] = [];
  for (const field of fields) {
    if (entry.place === 'project' && SUBJECT_NAMES.has(field.name) && field.textual && field.role === undefined)
      faults.push(`${id}.${field.path} names a subject but declares no place role`);
    if (isSubject(field.role) && entry.place !== 'project')
      faults.push(`${id}.${field.path} is a ${field.role} subject of a ${entry.place} operation`);
  }
  const selector = fields.some((field) => field.role === 'selector' && field.path === 'project');
  const named = fields.some((field) => field.required && field.role !== undefined && PLACED_ALONE.has(field.role));
  if (entry.place !== 'project' && selector) faults.push(`${id} takes \`project\` but its place is ${entry.place}`);
  if (entry.place === 'project' && named && selector) faults.push(`${id} takes \`project\` beside a required subject that names it`);
  if (entry.place === 'project' && !named && !selector && !computed)
    faults.push(`${id} has no required subject naming one project, takes no \`project\` and computes no place`);
  return faults;
};

layer(world(catalogWorld, null))('operation places', (it) => {
  it.effect('every operation declares how its place is chosen, and every subject kind it names has an owner', () =>
    Effect.gen(function* () {
      const catalog = yield* OperationCatalog;
      const faults = catalog.registry.ids.flatMap((id) => {
        const entry = catalog.registry.entry(id);
        const unowned = inputFields(entry.params).flatMap((field) =>
          isSubject(field.role) && catalog.subjects(field.role) === undefined
            ? [`${id}.${field.path}: no module resolves ${field.role}`]
            : [],
        );
        return [...faultsOf(id, entry, catalog.bound(id)?.place !== undefined), ...unowned];
      });
      expect(faults).toEqual([]);
    }),
  );
});
