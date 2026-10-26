import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import type { ThreadContextUse } from '@runlith/agent/thread/agents/ThreadAgent';
import { WebCache } from '@runlith/llm/profiles/webCache';
import { Effect } from 'effect';
import { type RunWebs, runWebs, type ThreadWeb, type WebModel } from './runWebs.js';

const TAGMA: ThreadWeb = { source: 'tagma' };
const HOSTED: ThreadWeb = { source: 'hosted' };
const SOL: WebModel = { provider: 'openai-oauth', model: 'gpt-5.6-sol' };

const decided = (webs: RunWebs, use: ThreadContextUse, web: ThreadWeb, on: WebModel = SOL) => webs.of(use, on, Effect.succeed(web));

const opening: ThreadContextUse = { kind: 'run', runId: 'run-1', context: null };
const later: ThreadContextUse = { kind: 'tools', runId: 'run-1', context: null };

describe('the web a run is decided to search with', () => {
  it.effect('is decided when the run opens and stands for every later reading of that run, whatever the setting says since', () =>
    Effect.gen(function* () {
      const webs = runWebs(new WebCache(1));
      expect(yield* decided(webs, opening, TAGMA)).toBe(TAGMA);
      expect(yield* decided(webs, later, HOSTED)).toBe(TAGMA);
    }),
  );

  it.effect('is decided again when a step of the run moves to another model or provider', () =>
    Effect.gen(function* () {
      const webs = runWebs(new WebCache(1));
      yield* decided(webs, opening, TAGMA);
      expect(yield* decided(webs, later, HOSTED, { provider: 'openai-oauth', model: 'gpt-5.5' })).toBe(HOSTED);
      expect(yield* decided(webs, later, TAGMA, { provider: 'openai-oauth', model: 'gpt-5.5' })).toBe(HOSTED);
      expect(yield* decided(webs, later, TAGMA, { provider: 'subscription', model: 'gpt-5.5' })).toBe(TAGMA);
    }),
  );

  it.effect('is decided again when the run is opened again, and released when the run settles', () =>
    Effect.gen(function* () {
      const webs = runWebs(new WebCache(1));
      yield* decided(webs, opening, TAGMA);
      expect(yield* decided(webs, opening, HOSTED)).toBe(HOSTED);
      yield* webs.release('run-1');
      expect(yield* decided(webs, later, TAGMA)).toBe(TAGMA);
    }),
  );

  it.effect('is read afresh by a reading that belongs to no run', () =>
    Effect.gen(function* () {
      const webs = runWebs(new WebCache(1));
      yield* decided(webs, opening, TAGMA);
      expect(yield* decided(webs, { kind: 'tools', runId: null, context: null }, HOSTED)).toBe(HOSTED);
    }),
  );
});
