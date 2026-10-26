import { Effect } from 'effect';
import { ThreadHarness } from '../../threads/contract/service/engine.js';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import { HarnessSessions } from '../contract/service/sessions.js';
import type { ProtocolDriver } from './driver.js';

export const makeProtocolWords = Effect.fnUntraced(function* (input: { readonly driver: ProtocolDriver }) {
  const harness = yield* ThreadHarness;
  const core = (threadId: string) => harness.threads.handle(threadId, OPERATOR_PRINCIPAL);
  return HarnessSessions.of({
    start: Effect.fn('HarnessSessions.start')(function* (threadId, prompt) {
      if (prompt !== undefined && prompt.trim() !== '') return yield* core(threadId).begin(prompt);
      yield* input.driver.ensure(threadId);
      return { runId: (yield* input.driver.current(threadId)) ?? threadId };
    }),
    send: (threadId, text, attachments) => core(threadId).send(text, attachments),
  });
});
