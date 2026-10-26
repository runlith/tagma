import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { openMemoryStorage } from './memoryStorage';
import { nativeStopRig } from './nativeStopRig';
import { nativeWordRig } from './nativeWordRig';
import { describeTransportStops } from './transportStops';
import { describeTransportWords } from './transportWords';

describeTransportStops('native', () => Effect.succeed(nativeStopRig(openMemoryStorage)), it.live);
describeTransportWords('native', () => Effect.succeed(nativeWordRig(openMemoryStorage)), it.live);
