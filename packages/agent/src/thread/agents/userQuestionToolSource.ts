import { Effect, Layer } from 'effect';
import { USER_QUESTION_SOURCE, threadUserQuestionTools } from '../../tools/UserQuestion';
import { ThreadToolRegistry } from '../ThreadPorts';

export const userQuestionToolSourceLayer: Layer.Layer<never, never, ThreadToolRegistry> = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ThreadToolRegistry;
    yield* registry.hold({
      id: USER_QUESTION_SOURCE,
      owner: '@runlith/agent/tools/UserQuestion',
      names: Object.keys(threadUserQuestionTools),
      offer: () => Effect.succeed({ id: USER_QUESTION_SOURCE, tools: threadUserQuestionTools }),
    });
  }).pipe(Effect.orDie),
);
