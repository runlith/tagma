import { Effect } from 'effect';
import type { AgentHarness } from '@runlith/agent/thread/AgentHarness';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { admitThreadFailures } from '../../threads/refusals.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import { gated } from '../../threads/projectGate.js';
import { instructionChanges } from '../../graph/orientation/Instructions.js';
import { Compaction, ThreadInstructions } from '../contract/service/context.js';
import type { CompactionChoices } from '../contract/service/compaction.js';
import type { NativeAgentDefinitions } from '../contract/service/agents.js';
import type { TargetPreparation } from '../../threads/contract/service/preparation.js';
import type { WorkspaceInputs } from '../contract/service/inputs.js';
import type { NativeThreadState } from '../../threads/contract/service/state.js';
import type { ThreadInstructionsRefreshed } from '../contract/wire/instructions.js';
import { CONTEXT_OPERATIONS } from '../contract/wire/operations/context.js';
import type { ThreadStore } from '../rows/threadRow.js';
import type { DeclaredAgents } from '../../threads/library/declared.js';
import { servedAgentOf } from '@runlith/agent/thread/rows';
import { basename } from 'node:path';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { skillInventory } from '../skills/pool.js';
import { ThreadNotFoundError } from '@runlith/agent/thread/storage/aggregate';

type NativeHarness = AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>;

export const nativeCompaction = (
  harness: NativeHarness,
  records: ThreadRecords['Service'],
  choices: CompactionChoices['Service'],
): Compaction['Service'] =>
  Compaction.of({
    compact: (threadId, projectId, input = {}) =>
      gated(records, threadId, projectId, () =>
        Effect.gen(function* () {
          const summarizer = input.summarizer === undefined ? undefined : yield* choices.admit(threadId, input.summarizer);
          return yield* harness.threads.handle(threadId, OPERATOR_PRINCIPAL).compact({
            keep: input.keep,
            at: input.at ?? 'step',
            summarizer,
          });
        }),
      ),
  });

export const nativeInstructions = (
  harness: NativeHarness,
  store: ThreadStore,
  records: ThreadRecords['Service'],
  sources: WorkspaceInputs['Service'],
  artifacts: ArtifactStore['Service'],
  projectRoot: (projectId: number) => Effect.Effect<string, HarnessFailure>,
  targets: TargetPreparation['Service'],
  instructions: NativeAgentDefinitions['Service']['instructions'],
  types: DeclaredAgents,
): ThreadInstructions['Service'] =>
  ThreadInstructions.of({
    refresh: (threadId, projectId) =>
      admitThreadFailures(
        gated(records, threadId, projectId, () =>
          Effect.gen(function* () {
            const row = yield* store.metadata(threadId);
            if (row === undefined) return yield* new ThreadNotFoundError(threadId);
            const served = servedAgentOf(row);
            if (served === null) {
              return yield* new GateRefusal(
                'external-context',
                'This thread runs its harness’s own agent, which keeps its instructions itself.',
                ['change its instructions through the harness itself'],
              );
            }
            const typeId = row.profile?.id ?? served;
            const definition = yield* types.resolveIn({ projectId, caller: 'operator', typeId });
            if (definition === null || 'withheld' in definition) {
              const rejected = (yield* types.rejectedIn(projectId)).find((entry) => basename(entry.path) === `${typeId}.md`);
              return yield* new GateRefusal(
                rejected === undefined ? 'agent-not-found' : 'agent-invalid',
                rejected === undefined ? `No definition named ${typeId} stands in this project.` : `${rejected.path}: ${rejected.reason}`,
                ['Restore or correct the definition, then refresh this thread again.'],
              );
            }
            const hosts = row.transport.agent;
            if (hosts !== null && definition.baseAgentId !== hosts) {
              return yield* new GateRefusal(
                'agent-invalid',
                `${typeId} now builds on ${definition.baseAgentId}, and this thread's harness serves ${hosts}.`,
                [`Make ${typeId} extend ${hosts} again, or start a new thread of it.`],
              );
            }
            const profile = definition.profile === undefined ? null : { id: typeId, overlay: definition.profile };
            const next = yield* targets.standing({ id: threadId, projectId, root: yield* projectRoot(projectId) });
            yield* sources.invalidate({ threadId });
            const walked = yield* sources.preview({ threadId, projectId, root: next.root });
            const checked = yield* harness.threads
              .handle(threadId, OPERATOR_PRINCIPAL)
              .checkInstructions({ agentId: hosts === null ? definition.baseAgentId : row.agentId, profile });
            const standing = yield* instructions(projectId, threadId, next.graph);
            const changes = instructionChanges(standing.current, standing.delivered ?? undefined);
            const ref = ({ kind, source, scope, revision }: (typeof changes.pending)[number]) => ({ kind, source, scope, revision });
            return {
              status: checked.status,
              instructions: {
                delivered:
                  standing.delivered === null
                    ? null
                    : {
                        projectId: standing.delivered.projectId,
                        root: standing.delivered.root,
                        audience: standing.delivered.audience,
                        entries: standing.delivered.entries.length,
                      },
                current: { audience: standing.current.audience, entries: standing.current.entries.length },
                pending: changes.pending.map(ref),
                withdrawn: changes.withdrawn.map(ref),
              },
              sources: {
                skills: skillInventory(artifacts, walked).flatMap(
                  ({ name, description, path, directory, scope, plugin, enabled, replacedBy }) =>
                    scope === 'built-in' ? [] : [{ name, description, path, directory, scope, plugin, enabled, replacedBy }],
                ),
                contextFiles: walked.contextFiles.map((file) => ({ path: file.path, name: file.name })),
                rejected: walked.rejected,
              },
            } satisfies ThreadInstructionsRefreshed;
          }),
        ),
        CONTEXT_OPERATIONS.refresh_thread_instructions.refusals,
      ),
  });
