import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { restartProbe } from './restartProbe.js';

it.live(
  'the owned restart preserves its place and recorded window, reading only the requested rollout',
  () => Effect.asVoid(restartProbe),
  55_000,
);
