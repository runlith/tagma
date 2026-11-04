import { Effect } from 'effect';
import { ChannelFailed } from '../../holder/Holder';
import { testSystem } from '../../composition/testing/system';

export const background = (pid: number) =>
  Effect.flatMap(testSystem, (system) => system.background(pid)).pipe(
    Effect.mapError((error) => (error._tag === 'ChannelFailed' ? error : new ChannelFailed({ reason: 'os', detail: error.detail }))),
  );
