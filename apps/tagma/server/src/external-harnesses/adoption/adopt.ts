import { Clock, Effect } from 'effect';
import { ApprovalModes } from '@runlith/agent/modes/ApprovalModes';
import { hostname } from 'node:os';
import { threadCallFailed } from '../../threads/contract/service/failure.js';
import { Settings } from '../../settings/contract/service/values.js';
import { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { harnessAdapter } from '../contract/service/table.js';
import type { HarnessAdoptInput } from '../contract/wire/adoption.js';
import { HARNESS_HOOK_BYTES } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessStorage } from '../../threads/contract/wire/harness/session.js';
import type { RootBinding } from '../../workspace/contract/wire/roots.js';
import { birthApprovalMode } from '../../threads/contract/wire/settings.js';
import { registeredMode } from '../../threads/contract/service/modes.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { TerminalRecord } from '../../executions/contract/wire/terminals.js';
import { ExecutionProcessEvidence } from '../../executions/contract/service/records.js';
import { Terminals } from '../../executions/contract/service/terminals.js';
import { HarnessAdoption } from '../contract/service/adoption.js';
import type { SessionBirths } from '../contract/service/births.js';
import type { AdoptionPlacement } from '../contract/service/adoptionPlacement.js';
import type { SessionDriver } from '../sessions/drive.js';
import { SessionLookupStore } from '../../threads/store/sessionLookups.js';
import type { AdoptionList } from '../contract/service/adoptionList.js';
import { jobUnder, RETAINED_READING_MS } from './shellJob.js';

const OPERATOR = principalOf({ _tag: 'Operator' });

export const makeAdoption = Effect.fnUntraced(function* ({
  list,
  births,
  sessions,
  placement,
}: {
  readonly list: AdoptionList;
  readonly births: SessionBirths;
  readonly sessions: SessionDriver;
  readonly placement: AdoptionPlacement;
}) {
  const terminals = yield* Terminals;
  const evidence = yield* ExecutionProcessEvidence;
  const lookups = yield* SessionLookupStore;
  const settings = yield* Settings;
  const grants = yield* GrantSigner;
  const modes = yield* ApprovalModes;

  const standing = (shell: TerminalRecord) =>
    shell.transport !== 'pty' || shell.holder !== OPERATOR || shell.launchedFor !== undefined
      ? Effect.succeed(false)
      : Effect.map(terminals.lost(shell), (lost) => lost === null);

  const job = Effect.fn('HarnessAdoption.job')(function* (shell: TerminalRecord, ask: HarnessAdoptInput, arrivedAt: number) {
    const here = ask.machine === hostname();
    const read = Effect.gen(function* () {
      const foreground = yield* evidence.foreground(shell.execution).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
      if (foreground._tag === 'ForegroundRefused') {
        return { report: undefined, proof: { _tag: 'Unread' as const, reason: foreground.detail } };
      }
      const report = yield* evidence.processes(shell.execution).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
      return {
        report,
        proof: jobUnder(
          report,
          ask.ancestry,
          here && report?.scope.host._tag === 'Local' ? report.scope.host : { _tag: 'Local', machine: ask.machine },
          foreground,
        ),
      };
    });
    const first = yield* read;
    const settled = first.proof._tag === 'Job' || (first.proof._tag === 'NotUnder' && first.proof.final === true);
    if (settled || first.report === undefined || first.report.observedAt >= arrivedAt) return first.proof;
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.sleep(Math.max(0, Math.min(RETAINED_READING_MS, first.report.observedAt + RETAINED_READING_MS - now)));
    return (yield* read).proof;
  });

  const found = Effect.fn('HarnessAdoption.found')(function* (shell: TerminalRecord, ask: HarnessAdoptInput) {
    const mode = yield* settings.value(birthApprovalMode, shell.projectId).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
    yield* registeredMode(modes, mode);
    const place =
      shell.rootId === undefined
        ? undefined
        : yield* placement
            .resolve({
              projectId: shell.projectId,
              rootId: shell.rootId,
              operationId: `adopt:${ask.harness}:${ask.key}`,
              name: harnessAdapter(ask.harness).label,
            })
            .pipe(
              Effect.catch((refusal) =>
                Effect.logWarning('an adopted thread could not be placed in its terminal’s root', {
                  rootId: shell.rootId,
                  code: refusal.code,
                }).pipe(Effect.as<RootBinding | undefined>(undefined)),
              ),
            );
    return yield* births.adopt({
      projectId: shell.projectId,
      harness: ask.harness,
      key: ask.key,
      mode,
      place: place === undefined ? undefined : { rootId: place.rootId, locationRevision: place.locationRevision },
    });
  });

  const storage = Effect.fn('HarnessAdoption.storage')(
    (shell: TerminalRecord, ask: HarnessAdoptInput): Effect.Effect<{ readonly storage?: HarnessStorage }> =>
      terminals.target({ projectId: shell.projectId, kind: 'host', cwd: ask.cwd ?? shell.cwd ?? '.' }).pipe(
        Effect.map((target) => {
          const entries = ask.storage.map((entry) => ({ name: entry.name, value: entry.value }));
          const bounded = Buffer.byteLength(JSON.stringify(entries)) <= HARNESS_HOOK_BYTES;
          return {
            storage: bounded
              ? { binding: target.binding, entries }
              : { binding: target.binding, entries: [], unreadable: 'launch-storage-limit' as const },
          };
        }),
        Effect.catch((cause) =>
          Effect.logWarning('an adopted session’s storage binding could not be resolved', { cause }).pipe(Effect.as({})),
        ),
      ),
  );

  return HarnessAdoption.of({
    adopt: Effect.fn('HarnessAdoption.adopt')(
      function* (ask, projectId) {
        const arrivedAt = yield* Clock.currentTimeMillis;
        const adapter = harnessAdapter(ask.harness);
        if (adapter.hooks === null) {
          return yield* new GateRefusal(
            'harness-unhooked',
            `This server carries no hook surface for ${adapter.label}, so none of its sessions is adopted.`,
            ['run the CLI as a harness thread Tagma launches'],
          );
        }
        const shell = yield* terminals.shell(ask.shell).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
        if (shell === null || shell.projectId !== projectId || !(yield* standing(shell))) {
          return yield* new GateRefusal('shell-unknown', 'No standing operator terminal of the project the CLI works in holds that key.', [
            'start the CLI in a terminal opened from the Tagma app, inside that terminal’s own project',
          ]);
        }
        const proof = yield* job(shell, ask, arrivedAt);
        if (proof._tag === 'NotUnder' && proof.final === true) {
          return yield* new GateRefusal(
            'not-under-shell',
            `The caller does not run under terminal ${shell.execution.execution}: ${proof.reason}.`,
            ['start the CLI straight from the terminal’s own shell, not under tmux or another session manager'],
          );
        }
        if (proof._tag !== 'Job') {
          return yield* new GateRefusal(
            'job-unproven',
            `The caller is not yet proven to run as a job of terminal ${shell.execution.execution}: ${proof.reason}.`,
            ['bring the CLI to the terminal’s foreground; its next event asks again'],
          );
        }
        const at = { execution: shell.execution.execution, incarnation: shell.execution.incarnation };
        const joined = yield* lookups.adoptedOn(at.execution, proof.witness).pipe(Effect.mapError((cause) => threadCallFailed(cause)));
        const { threadId, born } = joined === null ? yield* found(shell, ask) : { threadId: joined, born: false };
        const session = yield* sessions.adopt(threadId, {
          shell: at,
          job: proof.witness,
          key: ask.key,
          cwd: ask.cwd ?? shell.cwd ?? null,
          ...(yield* storage(shell, ask)),
        });
        if (joined === null && !born) {
          yield* list
            .advanceReaderOrder(threadId)
            .pipe(
              Effect.catch((cause) =>
                Effect.logWarning('an adopted thread could not be moved to the top of its list', { threadId, cause }),
              ),
            );
          yield* list.announce(threadId);
        }
        return { threadId, grant: grants.grantFor(threadId), session: session.id, job: proof.witness };
      },
      (effect, ask) =>
        Effect.tapError(effect, (failure) =>
          failure instanceof GateRefusal
            ? Effect.logDebug('a CLI was not adopted', { code: failure.code, harness: ask.harness, reason: failure.reason })
            : Effect.void,
        ),
    ),
    adopters: Effect.fn('HarnessAdoption.adopters')((projectId, executions) =>
      lookups
        .adoptedIn(projectId, executions)
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning('the threads adopted in these terminals could not be read', { cause }).pipe(Effect.as(new Map())),
          ),
        ),
    ),
  });
});
