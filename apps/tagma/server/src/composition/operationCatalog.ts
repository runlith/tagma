import { Context, Effect } from 'effect';
import { approvalIssues } from '@runlith/agent/modes/ApprovalMode';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { DOOR_FIELDS } from '@runlith/agent/tool';
import { OperationCatalog } from '../invocation/contract/service/catalog.js';
import { OperationId } from '../platform/contract/wire/ids.js';
import { PLATFORM_REFUSAL_WORDS } from '../platform/contract/wire/refusal.js';
import { refusalWordsOf } from '../platform/contract/service/manifest.js';
import { settleJournalCall } from '../graph/journal/callRange.js';
import { checkSubjectOf } from './catalog.js';
import { collectedOperations, subjectPlaces } from './manifest.js';
import { operationBodies, operationPresentations } from './bodies.js';
import { operationRegistry } from './registry.js';

const inputFields = (schema: unknown): readonly string[] => {
  const shaped = schema as { readonly fields?: Readonly<Record<string, unknown>>; readonly members?: readonly unknown[] };
  return shaped.fields === undefined ? (shaped.members ?? []).flatMap(inputFields) : Object.keys(shaped.fields);
};

export const operationCatalog: Effect.Effect<OperationCatalog['Service'], never, ApprovalModes> = Effect.map(
  Effect.all([operationBodies, operationPresentations, operationRegistry, collectedOperations, ApprovalModes, subjectPlaces]),
  ([bodies, presentations, registry, { journaled, modules }, modes, subjects]) => {
    const refusals = refusalWordsOf(modules, PLATFORM_REFUSAL_WORDS);
    const issues = approvalIssues(
      [...registry.ids].map((id) => ({ id, approval: registry.entry(id).approval })),
      modes,
    );
    if (issues.length > 0) throw new Error(`The operation approvals do not compose:\n${issues.join('\n')}`);
    const claimed = [...registry.ids].flatMap((id) =>
      DOOR_FIELDS.filter((field) => inputFields(registry.entry(id).params).includes(field)).map(
        (field) => `${id} declares the input field ${field}, which the door offers every operation`,
      ),
    );
    if (claimed.length > 0) throw new Error(`The operation inputs claim door fields:\n${claimed.join('\n')}`);
    const bound = Object.fromEntries(
      Object.entries(bodies).map(([name, body]) => {
        const id = OperationId.make(name);
        const declaration = registry.entry(id);
        return [
          id,
          body.settle !== undefined || !journaled.has(id) || typeof declaration.identity !== 'object'
            ? body
            : { ...body, settle: settleJournalCall },
        ];
      }),
    );
    return {
      registry,
      modes,
      bound: (id) => bound[id],
      subjects: (kind) => subjects.get(kind),
      subjectCalls: () => Context.mergeAll(...[...subjects.values()].flatMap((owner) => (owner.call === undefined ? [] : [owner.call()]))),
      checks: checkSubjectOf,
      presentation: (id) => presentations.get(id),
      refusals,
    };
  },
);
