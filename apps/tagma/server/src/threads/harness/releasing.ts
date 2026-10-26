import { Effect } from 'effect';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { type ReleaseThread, ThreadReleasing } from '../contract/service/releasing.js';

export function threadReleasing(): ThreadReleasing['Service'] {
  let serving: ReleaseThread | null = null;
  return ThreadReleasing.of({
    release: (threadId) =>
      serving === null
        ? Effect.fail(new ThreadCallBroke({ cause: new Error('no thread engine serves yet, so no session can be released') }))
        : serving(threadId),
    serve: (release) => {
      serving = release;
      return () => {
        if (serving === release) serving = null;
      };
    },
  });
}
