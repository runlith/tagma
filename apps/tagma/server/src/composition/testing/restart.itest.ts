import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { lagProbe, restartProbe } from './restartProbe.js';

it.live('the owned restart preserves its place and recorded window, reading only the requested rollout', () => Effect.asVoid(restartProbe));

it.live(
  'a restart onto a new journal shape step serves the first frame of an offloaded big thread in the new shape within the small thread window',
  () => Effect.asVoid(lagProbe),
);
