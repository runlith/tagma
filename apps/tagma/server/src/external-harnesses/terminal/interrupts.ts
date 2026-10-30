import { Clock, Duration, Effect, FiberMap } from 'effect';
import type { InterruptReceipt } from '@runlith/agent/thread/transport/contract';
import type { ExternalSession, HarnessInterrupt, HarnessInterrupting } from '../../threads/contract/wire/harness/externalSession.js';
import { harnessSessionActive } from '../../threads/contract/wire/harness/session.js';
import type { HarnessFailure } from '../../threads/contract/service/failure.js';
import type { HarnessExecutionRef } from '../../threads/contract/wire/harness/observation.js';
import type { HarnessExitArm, HarnessWidgetKey } from '@runlith/tagma/adapter/harness';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import { promptDigest, typedBack } from '../adapter/input.js';
import type { Keyboard, SessionDriver } from '../sessions/drive.js';
import type { HarnessSessionStore } from '../store/sessions.js';
import type { StandingSession } from '../contract/service/sessionRows.js';
import type { TerminalEndings } from './endings.js';
import type { TerminalWatch } from './watch.js';

const FIRST_BEAT_MS = 100;
const LAST_BEAT_MS = 2_000;

type Clearing = { pressed: string | null };

const CLI_GONE: ReadonlySet<string> = new Set(['input-ended', 'execution-gone']);

type Keyed = 'typed' | 'aimless' | 'armed';

export const armedConfirmed = (facet: ExternalSession, at: string): ExternalSession => {
  const armed = facet.armed;
  if (armed === undefined || armed.confirmedAt !== undefined || Date.parse(at) <= Date.parse(armed.at)) return facet;
  return { ...facet, armed: { ...armed, confirmedAt: at } };
};

export const confirmedBy = (facet: ExternalSession, at: string): ExternalSession => {
  const mark = facet.interrupted;
  return armedConfirmed(mark === undefined ? facet : { ...facet, interrupted: { ...mark, heard: at } }, at);
};

const arming = (arm: HarnessExitArm | undefined, keys: readonly HarnessWidgetKey[]): arm is HarnessExitArm =>
  arm !== undefined && keys.some((key) => JSON.stringify(key) === JSON.stringify(arm.key));

const disarmed = (arm: HarnessExitArm, facet: ExternalSession | null, lines: readonly string[], now: number): boolean => {
  if (lines.some((line) => line.includes(arm.banner))) return false;
  const armed = facet?.armed;
  if (armed === undefined) return true;
  return armed.confirmedAt !== undefined && now - Date.parse(armed.confirmedAt) >= arm.windowMs;
};

export class TerminalInterrupts {
  constructor(
    private readonly store: HarnessSessionStore,
    private readonly driver: SessionDriver,
    private readonly watch: TerminalWatch,
    private readonly endings: TerminalEndings,
    private readonly confirming: FiberMap.FiberMap<string, void, never>,
    private readonly adapters: HarnessAdapters['Service'],
  ) {}

  private rowOf(facet: ExternalSession) {
    return this.adapters.row(facet.name, facet.presentation.install);
  }

  readonly press = Effect.fn('TerminalInterrupts.press')(function* (
    this: TerminalInterrupts,
    threadId: string,
    runId: string,
    facet: ExternalSession,
  ): Effect.fn.Return<void, HarnessFailure> {
    const adapter = yield* this.rowOf(facet);
    const keys = adapter.interrupt;
    const session = facet.session;
    if (keys === null || facet.turn?.run !== runId || !harnessSessionActive(session) || session.state === 'stopping') {
      yield* this.endings.stopped(threadId, runId, false);
      return;
    }
    const execution = yield* this.driver.seated(threadId);
    if (execution !== null) yield* this.unarmed(threadId);
    const typed =
      execution !== null &&
      (yield* this.keyed(threadId, execution, adapter, keys, { run: runId, operation: `interrupt:${runId}` }).pipe(
        Effect.map((keyed) => keyed === 'typed'),
        Effect.catchTag('GateRefusal', (refusal) => (CLI_GONE.has(refusal.code) ? Effect.succeed(false) : Effect.fail(refusal))),
      ));
    if ((yield* this.endings.stopped(threadId, runId, typed)) === 'ended' && typed) yield* this.follow(threadId);
  });

  private readonly unarmed = Effect.fnUntraced(function* (this: TerminalInterrupts, threadId: string) {
    for (;;) {
      const facet = yield* this.store.read(threadId);
      const arm = facet === null ? undefined : this.adapters.find(facet.name)?.exitArm;
      const confirmedAt = facet?.armed?.confirmedAt;
      if (arm === undefined || confirmedAt === undefined) return;
      const left = arm.windowMs - ((yield* Clock.currentTimeMillis) - Date.parse(confirmedAt));
      if (left <= 0) return;
      yield* Effect.sleep(Duration.millis(left));
    }
  });

  private keyed(
    threadId: string,
    execution: HarnessExecutionRef,
    adapter: HarnessAdapter,
    keys: readonly HarnessWidgetKey[],
    pressing: { readonly run: string; readonly operation: string },
    aimed: (facet: ExternalSession | null) => boolean = () => true,
  ): Effect.Effect<Keyed, HarnessFailure> {
    const { store } = this;
    const drafted = adapter.composer?.drafted;
    const arm = adapter.exitArm;
    const strokes = (chosen: HarnessInterrupting): readonly HarnessWidgetKey[] =>
      chosen.drafted && drafted !== undefined ? drafted : keys;
    const sequence = (keyboard: Keyboard, chosen: HarnessInterrupting) =>
      keyboard.keys(strokes(chosen), chosen.drafted && drafted !== undefined ? `${chosen.operation}:drafted` : chosen.operation);
    const recorded = (chosen: HarnessInterrupting | undefined, armedAt?: string) =>
      store.change(threadId, (facet) => {
        const { interrupting: _settled, ...rest } = facet;
        const next = chosen === undefined ? rest : { ...rest, interrupting: chosen };
        const armed = armedAt === undefined ? next : { ...next, armed: { at: armedAt, operation: pressing.operation } };
        return Effect.succeed({ facet: armed, value: undefined });
      });
    return this.driver.typing(threadId, execution, (keyboard) =>
      Effect.gen(function* () {
        const standing = yield* store.read(threadId);
        if (!aimed(standing)) return 'aimless' as const;
        const pending = drafted === undefined ? undefined : standing?.interrupting;
        if (pending !== undefined && pending.operation !== pressing.operation && pending.run === pressing.run) {
          yield* sequence(keyboard, pending);
        }
        const chosen =
          pending?.operation === pressing.operation
            ? pending
            : { ...pressing, drafted: drafted !== undefined && (yield* keyboard.composer) !== null };
        const resumed = standing?.armed?.operation === pressing.operation;
        const armedAt = arming(arm, strokes(chosen)) && !resumed ? new Date(yield* Clock.currentTimeMillis).toISOString() : undefined;
        if (armedAt !== undefined && arm !== undefined && !disarmed(arm, standing, yield* keyboard.lines, Date.parse(armedAt))) {
          return 'armed' as const;
        }
        if (drafted !== undefined || armedAt !== undefined) yield* recorded(drafted === undefined ? undefined : chosen, armedAt);
        yield* sequence(keyboard, chosen);
        if (drafted !== undefined) yield* recorded(undefined);
        return 'typed' as const;
      }),
    );
  }

  restarted(threadId: string, turn: string): Effect.Effect<void> {
    const pressed = this.again(threadId, turn).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('a turn the CLI began after a stop could not be interrupted again', { threadId, turn, failure }),
      ),
    );
    return Effect.asVoid(FiberMap.run(this.confirming, `again:${threadId}:${turn}`, pressed, { onlyIfMissing: true }));
  }

  private readonly again = Effect.fn('TerminalInterrupts.again')(function* (
    this: TerminalInterrupts,
    threadId: string,
    turn: string,
  ): Effect.fn.Return<void, HarnessFailure> {
    const facet = yield* this.store.read(threadId);
    if (facet === null) return;
    const mark = facet.interrupted;
    const adapter = yield* this.rowOf(facet);
    const keys = adapter.interrupt;
    if (mark === undefined || keys === null) return;
    const execution = yield* this.driver.seated(threadId);
    if (execution === null) return;
    yield* this.keyed(
      threadId,
      execution,
      adapter,
      keys,
      { run: mark.turn.run, operation: `interrupt:${mark.turn.run}:${turn}` },
      (standing) => standing?.interrupted?.at === mark.at,
    );
  });

  readonly repeated = Effect.fn('TerminalInterrupts.repeated')(function* (
    this: TerminalInterrupts,
    threadId: string,
    runId: string,
    facet: ExternalSession,
  ): Effect.fn.Return<InterruptReceipt, HarnessFailure> {
    const adapter = yield* this.rowOf(facet);
    const keys = adapter.interrupt;
    if (facet.interrupted?.turn.run !== runId || keys === null) return 'no-turn';
    const execution = yield* this.driver.seated(threadId);
    if (execution === null) return 'no-turn';
    const operation = `interrupt:${runId}:again:${yield* Clock.currentTimeMillis}`;
    const marked = (standing: ExternalSession | null) => standing?.interrupted?.turn.run === runId;
    return yield* this.keyed(threadId, execution, adapter, keys, { run: runId, operation }, marked).pipe(
      Effect.map((keyed) => (keyed === 'aimless' ? ('no-turn' as const) : ('interrupted' as const))),
      Effect.catchTag('GateRefusal', (refusal) => (CLI_GONE.has(refusal.code) ? Effect.succeed('no-turn' as const) : Effect.fail(refusal))),
    );
  });

  settled(threadId: string): Effect.Effect<void, HarnessFailure> {
    return Effect.flatMap(this.store.read(threadId), (facet) =>
      facet?.interrupted === undefined
        ? Effect.void
        : Effect.andThen(this.follow(threadId), Effect.asVoid(this.store.wait(threadId, (standing) => standing.interrupted === undefined))),
    );
  }

  rearm(standing: readonly StandingSession[]): Effect.Effect<void> {
    return Effect.forEach(standing, ({ threadId, facet }) => (facet.interrupted === undefined ? Effect.void : this.follow(threadId)), {
      discard: true,
    });
  }

  private follow(threadId: string): Effect.Effect<void> {
    return Effect.asVoid(FiberMap.run(this.confirming, threadId, this.confirmation(threadId), { onlyIfMissing: true }));
  }

  private readonly confirmation = Effect.fnUntraced(function* (this: TerminalInterrupts, threadId: string) {
    let beat = FIRST_BEAT_MS;
    const progress: Clearing = { pressed: null };
    for (;;) {
      const step = yield* Effect.result(this.step(threadId, progress));
      if (step._tag === 'Success' && step.success !== 'unconfirmed') {
        if (step.success === 'settled') return;
        beat = FIRST_BEAT_MS;
        continue;
      }
      if (step._tag === 'Failure') {
        yield* Effect.logWarning('an interrupted CLI could not be read for its confirmation; it is read again', {
          threadId,
          failure: step.failure,
        });
      }
      yield* Effect.sleep(Duration.millis(beat));
      beat = Math.min(beat * 2, LAST_BEAT_MS);
    }
  });

  private readonly step = Effect.fnUntraced(function* (
    this: TerminalInterrupts,
    threadId: string,
    progress: Clearing,
  ): Effect.fn.Return<'settled' | 'moved' | 'unconfirmed', HarnessFailure> {
    const facet = yield* this.store.read(threadId);
    const mark = facet?.interrupted;
    if (facet === null || mark === undefined) return 'settled';
    const session = facet.session;
    if (!harnessSessionActive(session) || session.state === 'stopping') {
      yield* this.lifted(threadId, mark);
      return 'settled';
    }
    const execution = facet.execution?.execution ?? null;
    if (session.state !== 'running' || execution === null) {
      yield* this.store.wait(
        threadId,
        (standing) =>
          standing.interrupted?.at !== mark.at ||
          standing.session?.id !== session.id ||
          standing.session.state !== session.state ||
          (standing.execution?.execution ?? null) !== execution,
      );
      return 'moved';
    }
    const seen = yield* this.confirmed(threadId, facet, mark, progress);
    if (seen === 'cleared') return 'moved';
    if (seen === 'unconfirmed') return 'unconfirmed';
    yield* this.lifted(threadId, mark);
    return 'settled';
  });

  private readonly confirmed = Effect.fnUntraced(function* (
    this: TerminalInterrupts,
    threadId: string,
    facet: ExternalSession,
    mark: HarnessInterrupt,
    progress: Clearing,
  ): Effect.fn.Return<'confirmed' | 'cleared' | 'unconfirmed', HarnessFailure> {
    const { store } = this;
    const adapter = this.adapters.find(facet.name);
    if (adapter === null) return 'confirmed';
    const record = adapter.ends.interrupt === 'record';
    const transcribed = mark.heard === undefined && (yield* this.watch.endOf(threadId, facet, mark.turn)) !== null;
    const ended = mark.heard !== undefined || transcribed;
    if (record && !ended) return 'unconfirmed';
    if (transcribed && facet.armed !== undefined && facet.armed.confirmedAt === undefined) {
      const at = new Date(yield* Clock.currentTimeMillis).toISOString();
      yield* store.change(threadId, (standing) =>
        Effect.succeed({ facet: standing.interrupted?.at === mark.at ? confirmedBy(standing, at) : standing, value: undefined }),
      );
    }
    const prompt = adapter.promptScreenOf;
    const composer = adapter.composer;
    const returns = composer?.returns;
    const arm = adapter.exitArm;
    const execution = facet.execution;
    if (execution === null || composer === undefined || returns === undefined) {
      if (ended) return 'confirmed';
      if (execution === null || prompt === undefined) return adapter.metadata?.ends === undefined ? 'confirmed' : 'unconfirmed';
      return prompt(yield* this.driver.lines(execution)) ? 'confirmed' : 'unconfirmed';
    }
    const typed = mark.turn.typed ?? [];
    const returned = (lines: readonly string[]): boolean => {
      const shown = composer.of(lines);
      return shown !== null && typedBack(shown, typed, returns.counts);
    };
    const idle = (lines: readonly string[]): boolean => (record ? ended : prompt?.(lines) === true);
    const read = yield* Effect.result(this.driver.lines(execution));
    if (read._tag === 'Failure') return ended ? 'confirmed' : yield* Effect.fail(read.failure);
    if (!returned(read.success)) return ended || idle(read.success) ? 'confirmed' : 'unconfirmed';
    if (!idle(read.success) || read.success.join('\n') === progress.pressed) return 'unconfirmed';
    return yield* this.driver.typing(threadId, execution, (keyboard) =>
      Effect.gen(function* () {
        const lines = yield* keyboard.lines;
        const shown = lines.join('\n');
        if (!returned(lines) || !idle(lines) || shown === progress.pressed || (yield* keyboard.asking)) {
          return 'unconfirmed' as const;
        }
        const operation = `clear:${mark.at}:${promptDigest(shown)}`;
        const standing = yield* store.read(threadId);
        if (arming(arm, returns.clear) && standing?.armed?.operation !== operation) {
          const now = yield* Clock.currentTimeMillis;
          if (!disarmed(arm, standing, lines, now)) return 'unconfirmed' as const;
          yield* store.change(threadId, (latest) =>
            Effect.succeed({ facet: { ...latest, armed: { at: new Date(now).toISOString(), operation } }, value: undefined }),
          );
        }
        yield* keyboard.keys(returns.clear, operation);
        progress.pressed = shown;
        return 'cleared' as const;
      }),
    );
  });

  private lifted(threadId: string, mark: HarnessInterrupt): Effect.Effect<void, HarnessFailure> {
    return Effect.flatMap(Clock.currentTimeMillis, (now) =>
      this.store.change(threadId, (standing) => {
        if (standing.interrupted?.at !== mark.at) return Effect.succeed({ facet: standing, value: undefined });
        const { interrupted: _confirmed, ...rest } = confirmedBy(standing, new Date(now).toISOString());
        return Effect.succeed({ facet: rest, value: undefined });
      }),
    );
  }
}
