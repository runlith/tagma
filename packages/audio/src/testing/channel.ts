import { Effect, Layer } from 'effect';
import { HelperChannel } from '../helper/channel.ts';
import { type FakeHelper, type FakeHelperOptions, startFakeHelper } from './helper.ts';
import { type SocketPair, socketPair } from './socketPair.ts';

export type Launch = { readonly helper: FakeHelper; readonly pair: SocketPair };

export type FakeChannel = {
  readonly layer: Layer.Layer<HelperChannel>;
  readonly launched: ReadonlyArray<Launch>;
};

export const fakeChannel = (options: FakeHelperOptions = {}, answer: (token: string) => string = (token) => token): FakeChannel => {
  const launched: Array<Launch> = [];
  const layer = Layer.succeed(HelperChannel, {
    open: Effect.fnUntraced(function* (token) {
      const pair = yield* socketPair;
      launched.push({ helper: yield* startFakeHelper(pair.helper, answer(token), options), pair });
      return pair.client;
    }),
  });
  return { layer, launched };
};
