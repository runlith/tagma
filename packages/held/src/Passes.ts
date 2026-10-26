import { Cause, Clock, Duration, Effect, Exit, type Scope } from 'effect';
import { ResourceInvalid } from './failures.js';

export type PassTrigger =
  | { readonly boot: true }
  | { readonly event: string }
  | { readonly cadence: Duration.Input }
  | { readonly intent: string };

export type PassDeclaration = {
  readonly name: string;
  readonly owner: string;
  readonly triggers: readonly [PassTrigger, ...PassTrigger[]];
  readonly class: 'recovery' | 'background';
  readonly cost: 'light' | 'heavy' | 'writer' | 'large';
  readonly source: { readonly durable: string } | { readonly advisory: string };
};

export type DrivenPass = {
  readonly declaration: PassDeclaration;
  readonly run: (key: string) => Effect.Effect<void, unknown>;
};

export type PassStanding = {
  readonly pass: string;
  readonly key: string;
  readonly running: boolean;
  readonly standing: number;
  readonly oldestTriggerAt: number | null;
  readonly failures: number;
};

export type LastRun = {
  readonly pass: string;
  readonly key: string;
  readonly ms: number;
  readonly outcome: 'done' | 'failed';
  readonly cause: string | null;
};

export type Passes = {
  trigger(pass: string, key: string): Effect.Effect<void>;
  event(name: string, key: string): Effect.Effect<void>;
  standing(): readonly PassStanding[];
  lastRuns(): readonly LastRun[];
};

export const BACKOFF_CAP = Duration.minutes(5);

type Slot = { running: boolean; standing: number; oldestTriggerAt: number | null; failures: number };

export const passes = Effect.fnUntraced(function* (driven: readonly DrivenPass[]): Effect.fn.Return<Passes, never, Scope.Scope> {
  const byName = new Map<string, DrivenPass>();
  for (const pass of driven) {
    const { name, triggers } = pass.declaration;
    if (byName.has(name)) return yield* Effect.die(new ResourceInvalid({ resource: name, reason: 'another pass has its name' }));
    if (triggers.length === 0)
      return yield* Effect.die(new ResourceInvalid({ resource: name, reason: 'it has no trigger, so nothing drives it' }));
    byName.set(name, pass);
  }
  const scope = yield* Effect.scope;
  const slots = new Map<string, Slot>();
  const last = new Map<string, LastRun>();
  const slotId = (pass: string, key: string) => `${pass}\u0000${key}`;

  const drive = Effect.fn('Passes.drive')(
    function* (pass: DrivenPass, key: string, slot: Slot) {
      while (slot.standing > 0) {
        slot.standing = 0;
        slot.oldestTriggerAt = null;
        const startedAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(pass.run(key));
        const ms = (yield* Clock.currentTimeMillis) - startedAt;
        const failed = Exit.isFailure(exit);
        last.set(pass.declaration.name, {
          pass: pass.declaration.name,
          key,
          ms,
          outcome: failed ? 'failed' : 'done',
          cause: failed ? Cause.pretty(exit.cause) : null,
        });
        if (!failed) {
          slot.failures = 0;
          continue;
        }
        slot.failures += 1;
        if (slot.standing === 0) {
          slot.standing = 1;
          slot.oldestTriggerAt = startedAt;
        }
        yield* Effect.sleep(Math.min(1000 * 2 ** (slot.failures - 1), Duration.toMillis(BACKOFF_CAP)));
      }
    },
    (effect, pass, key, slot) =>
      Effect.ensuring(
        effect,
        Effect.sync(() => {
          slot.running = false;
          if (slot.standing === 0) slots.delete(slotId(pass.declaration.name, key));
        }),
      ),
  );

  const trigger = Effect.fn('Passes.trigger')(function* (name: string, key: string) {
    const pass = byName.get(name);
    if (pass === undefined) return yield* Effect.die(new ResourceInvalid({ resource: name, reason: 'no such pass is declared' }));
    const id = slotId(name, key);
    let slot = slots.get(id);
    if (slot === undefined) {
      slot = { running: false, standing: 0, oldestTriggerAt: null, failures: 0 };
      slots.set(id, slot);
    }
    slot.standing = 1;
    slot.oldestTriggerAt ??= yield* Clock.currentTimeMillis;
    if (slot.running) return;
    slot.running = true;
    yield* Effect.forkIn(drive(pass, key, slot), scope);
  });

  for (const pass of driven) {
    for (const cause of pass.declaration.triggers) {
      if ('boot' in cause) yield* trigger(pass.declaration.name, pass.declaration.name);
      if ('cadence' in cause) {
        yield* Effect.forkIn(
          Effect.forever(Effect.andThen(Effect.sleep(cause.cadence), trigger(pass.declaration.name, pass.declaration.name))),
          scope,
        );
      }
    }
  }

  return {
    trigger,
    event: (name, key) =>
      Effect.forEach(
        driven.filter((pass) =>
          pass.declaration.triggers.some(
            (cause) => ('event' in cause && cause.event === name) || ('intent' in cause && cause.intent === name),
          ),
        ),
        (pass) => trigger(pass.declaration.name, key),
        { discard: true },
      ),
    standing: () =>
      [...slots].map(([id, slot]) => {
        const [pass, key] = id.split('\u0000') as [string, string];
        return {
          pass,
          key,
          running: slot.running,
          standing: slot.standing,
          oldestTriggerAt: slot.oldestTriggerAt,
          failures: slot.failures,
        };
      }),
    lastRuns: () => [...last.values()],
  };
});
