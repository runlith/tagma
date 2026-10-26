import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import type { Unreachable } from './transportStops';

export const WORD_STATES = ['running', 'ending', 'starting', 'stopping', 'reopening', 'archived'] as const;

export type WordState = (typeof WORD_STATES)[number];

export type WordCase = {
  send(text: string): Effect.Effect<unknown, unknown>;
  during(press: Effect.Effect<void, unknown>): Effect.Effect<void, unknown>;
  settle(): Effect.Effect<void, unknown>;
  heard(): Effect.Effect<string, unknown>;
};

export type WordRig<R = never> = {
  reach(state: WordState): Effect.Effect<WordCase | Unreachable, unknown, Scope.Scope | R>;
};

const occurrences = (heard: string, word: string): number => heard.split(word).length - 1;

export function describeTransportWords<R>(
  transport: string,
  make: () => Effect.Effect<WordRig<R>, unknown, Scope.Scope | R>,
  test: Tester<Scope.Scope | R>,
  states: readonly WordState[] = WORD_STATES,
  timeout?: number,
): void {
  describe(`${transport}: Enter keeps every word and the agent hears it once, in the order pressed`, () => {
    for (const state of states)
      test(
        `Enter in the state ${state}`,
        Effect.fnUntraced(function* () {
          const rig = yield* make();
          const reached = yield* rig.reach(state);
          if ('unreachable' in reached) return;
          const words = [`ALPHA-${state} words`, `BRAVO-${state} words`] as const;
          yield* reached.during(Effect.asVoid(Effect.andThen(reached.send(words[0]), reached.send(words[1]))));
          yield* reached.settle();
          const heard = yield* reached.heard();
          expect(words.map((word) => occurrences(heard, word))).toEqual([1, 1]);
          expect(heard.indexOf(words[0])).toBeLessThan(heard.indexOf(words[1]));
        }),
        timeout,
      );
  });
}
