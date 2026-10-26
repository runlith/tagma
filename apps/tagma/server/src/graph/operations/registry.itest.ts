import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { withGraphCall } from '../../invocation/testing/call.js';
import { execute } from '../../invocation/testing/performing.js';
import { REGISTRY_PAIRS } from './registry.js';

layer(demoGraphLayer(), { excludeTestServices: true })('root listing', (it) => {
  it.effect('returns the total of the roots it delivers', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const pair = REGISTRY_PAIRS.list_root_blocks;
        const answer = yield* execute({ ...pair.body, id: pair.id }, {}, undefined, { actor: { kind: 'operator' }, files: null }).pipe(
          withGraphCall(
            Effect.succeed({
              project: { id: demo.projectId, name: 'demo' },
              vocabulary: yield* demo.table(),
              lens: { scope: undefined, names: 'law-and-reflections' },
              deliveredTags: new Set<string>(),
            }),
          ),
        );
        expect(answer).toMatchObject({ status: 'ok', total: 1, blocks: [{ title: 'demo' }] });
      }),
    ),
  );
});
