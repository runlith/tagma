import { Context, Effect, Layer } from 'effect';
import { assembleLanding } from './assembly.js';
import { Merges, PendingMerges } from './contract/service/merges.js';

export const landingServingLayer = Layer.effectContext(
  Effect.map(assembleLanding, ({ merges, pending }) => Context.make(Merges, merges).pipe(Context.add(PendingMerges, pending))),
);
