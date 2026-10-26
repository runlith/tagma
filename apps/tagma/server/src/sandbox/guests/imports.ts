import { type Context, Effect, type Scope } from 'effect';
import type { RunAdmission } from '@runlith/agent/thread/run/runAdmission';
import { ImportSourceRefused, type WorkspaceImports } from '@runlith/agent-tools/WorkspaceImports';
import type { ImportFailure, ImportRefused } from '@runlith/agent-tools/importFile';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { runningOf } from '../../change-record/record/sessions.js';
import type { SandboxFiles, ThreadQuiet } from '../contract/service/files.js';
import { SandboxUnavailable } from '../contract/service/sandboxes.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

export type GuestImportContext = {
  readonly files: SandboxFiles['Service'];
  readonly machine: StoreShape;
  readonly admission: Context.Service.Shape<typeof RunAdmission>;
  readonly projectId: number;
  readonly ownerId: string;
  readonly threadId: string;
};

const NOT_A_SANDBOX = 'import-source';
const SANDBOX_UNREADABLE = 'sandbox-unavailable';
type GuestImportRefusal = typeof NOT_A_SANDBOX | typeof SANDBOX_UNREADABLE;

export function guestImports(ctx: GuestImportContext): WorkspaceImports {
  return {
    open: (namespace, path) =>
      namespace.kind !== 'sandbox'
        ? Effect.fail(
            new ImportSourceRefused({
              code: NOT_A_SANDBOX,
              reason: `nothing here produces in a ${namespace.kind} namespace; the one this server produces in is a sandbox.`,
            }),
          )
        : Effect.gen(function* () {
            const file = yield* ctx.files
              .read(namespace.id, path, { ownerId: ctx.ownerId, projectId: ctx.projectId }, (threadId) =>
                stillSession(ctx, threadId).pipe(
                  Effect.mapError(
                    (failure) =>
                      new SandboxUnavailable({
                        sandbox: namespace.id,
                        reason: `its session's stillness could not be verified: ${failure.message}`,
                      }),
                  ),
                ),
              )
              .pipe(
                Effect.catch((failure) =>
                  failure._tag === 'SandboxUnavailable'
                    ? Effect.fail(new ImportSourceRefused({ code: SANDBOX_UNREADABLE, reason: failure.message }))
                    : Effect.die(failure),
                ),
              );
            return {
              text: file.text,
              from: `sandbox ${namespace.id}:${file.guestPath} — ${file.stillness}`,
            };
          }),
  };
}

const stillSession = Effect.fn('sandbox.stillSession')(function* (ctx: GuestImportContext, threadId: string) {
  yield* Effect.acquireRelease(
    Effect.sync(() => ctx.admission.hold([threadId])),
    (release) => Effect.sync(() => release()),
  );
  const running = yield* runningOf(ctx.machine, ctx.projectId, [threadId]);
  return running.length > 0
    ? { quiet: false, reason: `thread ${threadId} is taking a turn in it, so its tree is being written` }
    : {
        quiet: true,
        reason: `thread ${threadId} holds it and took no turn while this read stood; a process its workload left running is not covered`,
      };
});

export type ImportRefusalCode = ImportRefused['code'] | GuestImportRefusal | 'destination-path';

export function importRefusal(failure: ImportFailure): { readonly code: ImportRefusalCode; readonly reason: string } {
  if (failure._tag === 'ImportRefused') return { code: failure.code, reason: failure.reason };
  if (failure._tag === 'ImportSourceRefused') {
    return {
      code: failure.code === SANDBOX_UNREADABLE ? SANDBOX_UNREADABLE : NOT_A_SANDBOX,
      reason: failure.reason,
    };
  }
  return { code: 'destination-path', reason: failure.message };
}
