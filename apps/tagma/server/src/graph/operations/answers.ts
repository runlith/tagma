import { Effect, Result } from 'effect';
import { Orientation } from '../contract/service/orientation.js';
import { Tags } from '../contract/service/vocabulary.js';
import { Tasks } from '../contract/service/work.js';
import { readFieldOption } from '../vocabulary/declarationRules.js';
import { WORK } from '../contract/wire/tags/work.js';
import { SPEC } from '../contract/wire/tags/spec.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { IdleSpecAnswer, RemainingDebt } from '../contract/wire/answers.js';
import { Git } from '@runlith/git/Git';
import { Projects } from '../../projects/contract/service/registry.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { checkoutsOf } from '../../workspace/checkouts/git.js';
import { CurrentGraph, measuredRoot } from '../contract/service/serving.js';
import { WorkDebt } from '../contract/service/workDebt.js';
import type { GraphCopy, BlockAnswer, BlockResultAnswer } from '../contract/wire/answers.js';
import type { BlockRecord, BlockWrite } from '../contract/service/acts.js';
import type { BlockEnd, WorklessSpec } from '../contract/service/work.js';
import { addressed, blockName } from '../contract/wire/references.js';
import type { Priced } from '../../platform/contract/service/start.js';

export const writtenAt = Effect.fnUntraced(function* <A extends { readonly graphCopy?: GraphCopy }>(
  answer: A,
  selected?: GraphCopy | null,
) {
  const graph = yield* CurrentGraph;
  const copy =
    'graphCopy' in answer
      ? answer.graphCopy
      : selected === null
        ? undefined
        : (selected ??
          (graph === null
            ? undefined
            : { projectId: graph.projectId, checkout: graph.checkout, tree: graph.layout.treeRoot, branch: undefined }));
  if (copy === undefined || copy.branch !== undefined) return answer;
  const project = yield* (yield* Projects).byId(copy.projectId);
  const branch =
    copy.checkout === project.rootPath
      ? null
      : ((yield* Effect.mapError(checkoutsOf(yield* Git, project.rootPath), gitRefusal)).find((checkout) => checkout.path === copy.checkout)
          ?.branch ?? undefined);
  return { ...answer, graphCopy: { ...copy, branch } };
});

export function blockSummary(row: BlockRecord): BlockAnswer {
  return {
    name: blockName(row.uuid),
    tags: row.tags,
    fields: row.fields,
    actions: row.actions,
    title: row.title,
    parentName: row.parentId === null ? null : blockName((row as { parentUuid?: string | null }).parentUuid ?? ''),
    superseded: row.superseded,
    blocked: row.blocked,
    stealth: row.stealth ? true : undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function blockResult(row: BlockRecord & { refsIn?: never }): BlockResultAnswer {
  return { status: 'ok', block: blockSummary(row) };
}

export function specAnswers(specs: readonly WorklessSpec[]): IdleSpecAnswer[] | undefined {
  if (specs.length === 0) return undefined;
  return specs.map((spec) => ({
    name: spec.projectId === undefined ? blockName(spec.uuid) : addressed(spec.projectId, blockName(spec.uuid)),
    title: spec.title,
  }));
}

export const endResult = Effect.fn('graph.endResult')(function* (row: BlockEnd, commit?: string) {
  const table = yield* (yield* Tags).of(row.projectId);
  if (!table.supports(row, WORK) && !table.supports(row, SPEC)) return blockResult(row);
  const answer = { ...blockResult(row), specs: specAnswers(yield* (yield* Tasks).specsLeftBy([row])) };
  const debt: RemainingDebt[] = [];
  const unreadable: string[] = [];
  const rules = yield* Effect.result((yield* Orientation).rules(row.projectId));
  if (Result.isFailure(rules)) {
    if (!(rules.failure instanceof GateRefusal)) return yield* Effect.fail(rules.failure);
    return { ...answer, debtUnreadable: [rules.failure.reason] };
  }
  const owner = blockName(row.uuid);
  for (const rule of rules.success) {
    const field = table.lawProjection(rule)?.enforcement?.field;
    if (field === undefined) continue;
    const name = blockName(rule.uuid);
    const read = yield* Effect.result(readFieldOption(rule, field, 'lawEnforcement'));
    if (Result.isFailure(read)) {
      unreadable.push(`${name}: ${read.failure.reason}`);
      continue;
    }
    let entries = 0;
    for (const entry of read.success?.debt ?? []) if (entry.owner === owner) entries += 1;
    if (entries === 0) continue;
    debt.push({
      rule: name,
      title: rule.title,
      entries,
      reassign: `read_enforcement with rule=${name} supplies base and debt fingerprints; enforce_rule with blockId=${name} and owners mapping those owned by ${owner} to a standing task or spec`,
    });
  }
  if (commit !== undefined && debt.length > 0) {
    const remaining = yield* Effect.gen(function* () {
      const root = yield* measuredRoot(yield* (yield* Projects).byId(row.projectId));
      return yield* (yield* WorkDebt).remaining({ projectId: row.projectId, root, owner, commit });
    }).pipe(Effect.catchTag('GateRefusal', (failure) => Effect.succeed({ debtUnreadable: [failure.reason] })));
    return { ...answer, ...remaining };
  }
  return {
    ...answer,
    debt: debt.length === 0 ? undefined : debt,
    debtUnreadable: unreadable.length === 0 ? undefined : unreadable,
  };
});

export function claimResult(row: BlockWrite): BlockResultAnswer {
  return {
    status: 'ok',
    block: blockSummary(row),
    refsIn: row.refsIn.length === 0 ? undefined : row.refsIn,
  };
}

export function pricedResult(raw: Priced<BlockWrite>): BlockResultAnswer {
  return { ...claimResult(raw.value), start: raw.start };
}

export function pricedBlockResult(raw: Priced<BlockRecord>): BlockResultAnswer {
  return { ...blockResult(raw.value), start: raw.start };
}
