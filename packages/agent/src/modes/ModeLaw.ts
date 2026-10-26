import { Context, Effect, Layer } from 'effect';
import { modeOfLookup, type ModeOf } from './ApprovalMode';
import { ApprovalModes } from './ApprovalModes';

export class ModeLaw extends Context.Service<
  ModeLaw,
  {
    of(threadId: string, mode: string): ModeOf;
    move(threadId: string, mode: string): void;
    forget(threadId: string): void;
  }
>()('@runlith/agent/ModeLaw') {}

export const modeLawLayer = Layer.effect(
  ModeLaw,
  Effect.gen(function* () {
    const modes = yield* ApprovalModes;
    const laws = new Map<string, { mode: string }>();
    return ModeLaw.of({
      of: (threadId, mode) => {
        const law = laws.get(threadId) ?? { mode };
        laws.set(threadId, law);
        return modeOfLookup(modes, () => law.mode);
      },
      move: (threadId, mode) => {
        const law = laws.get(threadId);
        if (law !== undefined) law.mode = mode;
      },
      forget: (threadId) => {
        laws.delete(threadId);
      },
    });
  }),
);
