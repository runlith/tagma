import { expect, test } from 'bun:test';
import { Cause } from 'effect';
import { ChannelFailed, ForegroundRefused, HolderLaunchUncertain, HolderRefused, TerminalInterruptRefused } from './Holder';

test('holder failures retain their producer detail when formatted for logs', () => {
  const detail = 'the native terminal could not complete this operation';
  const failures = [
    new ChannelFailed({ reason: 'os', detail }),
    new ForegroundRefused({ reason: 'unreadable', detail }),
    new HolderRefused({ act: 'observe', reason: 'os', detail }),
    new HolderLaunchUncertain({ execution: 'unsettled-execution', detail }),
    new TerminalInterruptRefused({ reason: 'isig-disabled', detail }),
  ];
  for (const failure of failures) expect(Cause.pretty(Cause.fail(failure))).toContain(detail);
});
