import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { restartProbe } from './restartProbe.js';

it.live('the owned restart restores its place and window with one formed page of the requested offloaded thread', () =>
  Effect.asVoid(restartProbe),
);
