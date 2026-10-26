import { Failure } from '@runlith/layer/Failure';
import { Layer } from '@runlith/layer/Layer';
import { Notices } from './Service.svelte.js';

export const NoticesLayer = Layer.mergeAll(
  Notices,
  Layer.provide(Failure, function* () {
    const notices = yield* Notices;
    return new Failure((reason) => notices.background(reason));
  }),
);
