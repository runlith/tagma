import { Context, Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import type { Actor } from '../../platform/contract/wire/actor.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { SessionResolution } from '../../external-harnesses/contract/service/sessionResolution.js';
import {
  MCP_SESSION_HEADER,
  NATIVE_HARNESS,
  SESSION_HEADER,
  parseSessionToken,
  type SessionRef,
} from '../../platform/contract/wire/session.js';
import { runFacts } from '../../native-harness/row.js';
import { recordFacts } from '../../thread-record/facts.js';
import { mandateFacts } from '../../threads/mandate.js';
import {
  ACT_HEADER,
  CALLER_HEADER,
  GRANT_HEADER,
  GRANT_VARIABLE,
  parseAct,
  TERMINAL_HEADER,
} from '../../platform/contract/service/credentials.js';
import type { GrantSigner } from '../../platform/contract/service/grantSigner.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { HARNESS_NAMES } from '../../threads/contract/wire/harness/names.js';
import type { MachineContext } from '../../graph/serving/machine.js';
import type { CallWorld } from '../contract/service/admission.js';

type ThreadBornOf = NonNullable<Extract<Actor, { readonly kind: 'thread' }>['act']>;

export type NativeIdentity = {
  readonly threadId: string;
  readonly ownerId: string;
  readonly projectId: number;
  readonly act: ThreadBornOf | null;
};

export type CallIdentity = {
  readonly session: SessionRef | null;
  readonly native: NativeIdentity | null;
  readonly world: CallWorld['Service'];
  readonly external?: string;
};

export const worldOf = (hostKind: string | null): CallWorld['Service'] => (hostKind === null ? 'checkout' : 'elsewhere');

type GrantedThread = {
  readonly ownerId: string;
  readonly projectId: number | null;
  readonly hostKind: string | null;
};

const grantedThread = (machine: MachineContext, threadId: string): Effect.Effect<GrantedThread | null, StoreFailure> =>
  Context.get(machine, MachineStore)
    .db.select({ ownerId: recordFacts.principalId, hostKind: mandateFacts.hostKind, projectId: recordFacts.projectId })
    .from(recordFacts)
    .innerJoin(mandateFacts, eq(mandateFacts.id, recordFacts.id))
    .where(eq(recordFacts.id, threadId))
    .limit(1)
    .pipe(Effect.map((rows) => rows[0] ?? null));

const signedBy = Effect.fnUntraced(function* (
  machine: MachineContext,
  resolution: SessionResolution['Service'],
  headers: Record<string, string | undefined>,
  bridge: SessionRef,
) {
  const shellKey = headers[TERMINAL_HEADER]?.trim();
  const adopted = shellKey
    ? yield* Context.get(machine, MachineUnits)
        .read((unit) =>
          resolution.resolve(unit, {
            session: bridge,
            shellKey,
          }),
        )
        .pipe(
          Effect.mapError(
            (failure) =>
              new GateRefusal('graph-pool', `this server could not resolve the shell's session: ${failure.message}`, [
                'make the call again',
              ]),
          ),
        )
    : null;
  const native: NativeIdentity | null =
    adopted === null
      ? null
      : {
          threadId: adopted.threadId,
          ownerId: adopted.principalId,
          projectId: adopted.projectId,
          act: null,
        };
  return native === null
    ? { session: bridge, native: null, world: 'checkout' as const }
    : { session: { harness: NATIVE_HARNESS, key: native.threadId }, native, world: 'checkout' as const };
});

const actOf = (machine: MachineContext, threadId: string, header: string | undefined): Effect.Effect<ThreadBornOf | null, GateRefusal> => {
  const act = parseAct(header);
  if (act === null) return Effect.succeed(null);
  return Context.get(machine, MachineStore)
    .db.select({ id: runFacts.id })
    .from(runFacts)
    .where(and(eq(runFacts.id, act.runId), eq(runFacts.threadId, threadId)))
    .limit(1)
    .pipe(
      Effect.map((rows) => (rows.length === 0 ? null : { by: act.runId, step: act.step })),
      Effect.mapError(
        (failure) =>
          new GateRefusal('graph-pool', `this server could not read the run behind that act: ${failure.message}`, ['make the call again']),
      ),
    );
};

export const identityOf = Effect.fnUntraced(function* (
  machine: MachineContext,
  resolution: SessionResolution['Service'],
  grants: GrantSigner['Service'],
  headers: Record<string, string | undefined>,
): Effect.fn.Return<CallIdentity, GateRefusal> {
  const grant = headers[GRANT_HEADER]?.trim();
  if (grant) {
    const threadId = grants.threadOf(grant);
    if (threadId === null) return { session: null, native: null, world: 'checkout' };
    const granted = yield* Effect.mapError(
      grantedThread(machine, threadId),
      (failure) =>
        new GateRefusal('graph-pool', `this server could not read the session behind that grant: ${failure.message}`, [
          'make the call again',
        ]),
    );
    if (granted === null) {
      return yield* new GateRefusal('grant-thread-gone', `the thread ${threadId} behind this grant no longer exists`, [
        'start the work again from a live thread',
        `unset ${GRANT_VARIABLE} to call as the operator`,
      ]);
    }
    return {
      session: { harness: NATIVE_HARNESS, key: threadId },
      native:
        granted.projectId === null
          ? null
          : {
              threadId,
              ownerId: granted.ownerId,
              projectId: granted.projectId,
              act: yield* actOf(machine, threadId, headers[ACT_HEADER]),
            },
      world: worldOf(granted.hostKind),
    };
  }
  const declared = headers[MCP_SESSION_HEADER]?.trim();
  if (declared) {
    const bridge = parseSessionToken(declared);
    if (bridge === null || !HARNESS_NAMES.some((name) => name === bridge.harness)) {
      return yield* new GateRefusal(
        'mcp-session-shape',
        `${MCP_SESSION_HEADER} is "<harness>:<key>" naming a harness this server carries, got "${declared}"`,
        [`send one of: ${HARNESS_NAMES.join(', ')}`, 'a session of this server is proven by its shell’s grant, not declared here'],
      );
    }
    return yield* signedBy(machine, resolution, headers, bridge);
  }
  const header = headers[SESSION_HEADER]?.trim();
  if (!header) {
    const external = headers[CALLER_HEADER]?.trim();
    return { session: null, native: null, world: 'checkout', external: external || undefined };
  }
  const parsed = parseSessionToken(header);
  if (parsed === null) {
    return yield* new GateRefusal('session-shape', `${SESSION_HEADER} is "<harness>:<key>", got "${header}"`, [
      'send the token that shape, or send no header at all: a caller with no session behind it is expected',
    ]);
  }
  if (parsed.harness === NATIVE_HARNESS) {
    return yield* new GateRefusal(
      'session-native',
      `a session of this server is proven by its shell's grant, not named in ${SESSION_HEADER}`,
      [
        `run the command from that session's own shell, which carries ${GRANT_HEADER}`,
        'send your own harness token instead: <harness>:<key>',
      ],
    );
  }
  return yield* signedBy(machine, resolution, headers, parsed);
});
