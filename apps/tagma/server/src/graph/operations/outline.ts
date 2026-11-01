import { Effect } from 'effect';
import { body, pair } from '../../platform/contract/service/body.js';
import { said } from '../../platform/contract/service/presentation.js';
import { admitted } from '../../platform/contract/service/routed.js';
import { Settings } from '../../settings/contract/service/values.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { BlockNames, BlockReferences } from '../contract/service/acts.js';
import { Blocks, Edges, Trash } from '../contract/service/blocks.js';
import { Orientation } from '../contract/service/orientation.js';
import { Selection } from '../contract/service/reads.js';
import { Sources } from '../contract/service/sources.js';
import { GraphCall } from '../contract/service/serving.js';
import { InstalledCatalogs, Tags } from '../contract/service/vocabulary.js';
import { OUTLINE_OPERATIONS as OPS } from '../contract/wire/operations/outline.js';
import { wireBlock, wireTreeBlock, wireWritten } from '../reading/rows.js';
import { titlesAcross } from '../serving/routing.js';
import { Catalogs } from '../contract/wire/catalogs.js';
import { served } from './served.js';
import { scoped, targeted } from './crossing.js';
import { priced } from '../../platform/contract/service/start.js';
import { lawPricing } from './start.js';
import { vocabularyOf } from '../vocabulary/served.js';
import { farEndOf, farStates } from '../acts/far.js';
import { farKey } from '../contract/wire/far.js';
import { addressed, blockAddress, blockIdentity, blockName } from '../contract/wire/references.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { LIFECYCLE } from '../contract/wire/tags/lifecycle.js';
import { deliveryOf, FINDING_UNHEARD, reachesNobody } from '../contract/wire/tags/law.js';

type In<K extends keyof typeof OPS> = (typeof OPS)[K]['input']['Type'];

export const OUTLINE_PAIRS = {
  read_tree: pair(
    OPS.read_tree,
    body(OPS.read_tree, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const blocks = (yield* (yield* Selection).tree(call.project.id)).map(wireTreeBlock);
        return { status: 'ok' as const, blocks };
      }),
    }),
  ),

  read_titles: pair(
    OPS.read_titles,
    body(OPS.read_titles, {
      execute: Effect.fnUntraced(function* (input: In<'read_titles'>) {
        return { status: 'ok' as const, ...(yield* admitted(OPS.read_titles)(titlesAcross(input.names))) };
      }),
    }),
  ),

  list_trash: pair(
    OPS.list_trash,
    body(OPS.list_trash, {
      execute: Effect.fnUntraced(function* (input: In<'list_trash'>) {
        const call = yield* yield* GraphCall;
        let wanted: number | undefined;
        if (input.name !== undefined) {
          const address = blockAddress(input.name);
          if (address.projectId !== null && address.projectId !== call.project.id) {
            return yield* new GateRefusal('place-mismatch', 'the requested block names another project', [
              'list the trash of the named project',
            ]);
          }
          wanted = yield* (yield* BlockNames).idOfName(addressed(call.project.id, address.name));
        }
        const rows = yield* (yield* Trash).roots(call.project.id, wanted === undefined ? undefined : [wanted]);
        const blocks = rows.filter((row) => wanted === undefined || row.id === wanted).map(wireBlock);
        return { status: 'ok' as const, blocks };
      }),
    }),
  ),

  read_edges: pair(
    OPS.read_edges,
    body(OPS.read_edges, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const names = yield* BlockNames;
        const graphEdges = yield* Edges;
        const near = yield* graphEdges.of(call.project.id);
        const far = yield* graphEdges.farOf(call.project.id);
        const identities = yield* names.identitiesOf([
          ...new Set([...near.flatMap((row) => [row.fromId, row.toId]), ...far.map((row) => row.fromId)]),
        ]);
        const edges = [];
        for (const row of near) {
          const from = identities.get(row.fromId);
          const to = identities.get(row.toId);
          if (from === undefined) return yield* Effect.die(`no block ${row.fromId} to name`);
          if (to === undefined) return yield* Effect.die(`no block ${row.toId} to name`);
          edges.push({
            fromName: blockName(from),
            toName: blockName(to),
            fromIdentity: from,
            toIdentity: to,
            fromRowKey: row.fromId,
            toRowKey: row.toId,
            kind: row.kind,
            createdBySessionId: row.createdBySessionId,
            createdAt: row.createdAt.toISOString(),
          });
        }
        const states = yield* farStates(far, LIFECYCLE);
        const farRows = far.map((row) => {
          const from = identities.get(row.fromId);
          return {
            fromName: from === undefined ? '' : blockName(from),
            toName: blockName(row.uuid),
            fromIdentity: from ?? null,
            toIdentity: blockIdentity(row.uuid),
            fromRowKey: row.fromId,
            toRowKey: null,
            kind: row.kind,
            createdBySessionId: row.createdBySessionId,
            createdAt: row.createdAt.toISOString(),
            graph: farEndOf(row, states.get(farKey(row)) ?? { kind: 'absent', reason: 'project', detail: null }),
          };
        });
        return { status: 'ok' as const, edges: [...edges, ...farRows] };
      }),
    }),
  ),

  read_refs: pair(
    OPS.read_refs,
    body(OPS.read_refs, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        return { status: 'ok' as const, refs: yield* (yield* BlockReferences).refsOf(call.project.id) };
      }),
    }),
  ),

  read_vocabulary: pair(
    OPS.read_vocabulary,
    body(OPS.read_vocabulary, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const table = yield* (yield* Tags).of(call.project.id);
        const shipped = yield* Catalogs;
        const installed = yield* InstalledCatalogs;
        return {
          status: 'ok' as const,
          ...vocabularyOf(
            table,
            shipped.key === null ? [] : yield* (yield* Settings).value(shipped.key, call.project.id),
            yield* installed.read(call.project.id),
            yield* installed.findings(call.project.id),
          ),
        };
      }),
    }),
  ),

  read_law: pair(
    OPS.read_law,
    body(OPS.read_law, {
      execute: Effect.fnUntraced(function* () {
        const call = yield* yield* GraphCall;
        const law = yield* admitted(OPS.read_law)((yield* Orientation).law({ projectId: call.project.id }));
        return { status: 'ok' as const, law };
      }),
      voice: said((answer) => answer.law),
    }),
  ),

  read_path_exists: pair(
    OPS.read_path_exists,
    body(OPS.read_path_exists, {
      execute: Effect.fnUntraced(function* (input: In<'read_path_exists'>) {
        const graph = yield* served;
        const report = yield* (yield* CheckoutPaths).pathWithin(graph.checkout, input.path);
        return { status: 'ok' as const, exists: report.exists };
      }),
    }),
  ),

  set_rule_enabled: pair(
    OPS.set_rule_enabled,
    body(OPS.set_rule_enabled, {
      ...targeted(
        (input: In<'set_rule_enabled'>) => input.blockId,
        Effect.fnUntraced(function* (input: In<'set_rule_enabled'>) {
          const { id, projectId } = yield* scoped(input.blockId);
          const written = yield* priced(lawPricing(projectId), (yield* Blocks).setEnabled({ id, enabled: input.enabled }));
          return { status: 'ok' as const, block: wireWritten(written.value), start: written.start };
        }),
      ),
    }),
  ),

  set_rule_delivery: pair(
    OPS.set_rule_delivery,
    body(OPS.set_rule_delivery, {
      ...targeted(
        (input: In<'set_rule_delivery'>) => input.blockId,
        Effect.fnUntraced(function* (input: In<'set_rule_delivery'>) {
          const { id, projectId } = yield* scoped(input.blockId);
          const written = yield* priced(lawPricing(projectId), (yield* Blocks).setDelivery({ id, delivery: input.delivery }));
          const node = written.value;
          const projection = (yield* (yield* Tags).of(projectId)).lawProjection(node);
          const sourced = (yield* (yield* Sources).of(id)).length > 0;
          const warning = !reachesNobody(projection, node, sourced)
            ? undefined
            : deliveryOf(projection, node, sourced) === 'code'
              ? 'Code delivery has no sources: this rule reaches no agent. Any enforcement still measures the whole project. Add sources with anchor_block, choose finding for an enforced rule, or set_rule_delivery to prompt.'
              : FINDING_UNHEARD;
          return { status: 'ok' as const, block: wireWritten(written.value), start: written.start, warning };
        }),
      ),
    }),
  ),
};
