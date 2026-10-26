import { openBrowserDefault } from '@runlith/llm/oauth/flows/open-browser';
import { Console, Duration, Effect, Redacted } from 'effect';
import { Prompt } from 'effect/cli';
import type { SignInMethod } from '@runlith/llm/oauth/vendor';
import type { DoorLens, Perform } from '../../platform/contract/service/perform.js';
import { PROVIDER_OPERATIONS as OPS } from '../contract/wire/operations.js';
import type { AccountStatus } from '../contract/wire/signIns.js';

const POLL_EVERY = Duration.seconds(3);

export const signIn = Effect.fnUntraced(function* (perform: Perform, lens: DoorLens, provider: string, method?: SignInMethod) {
  const { flow } = yield* perform(OPS.begin_sign_in, { provider, method }, lens);
  if (flow.flow === 'paste' || flow.flow === 'key') {
    if (flow.flow === 'paste') {
      yield* Console.log(`authorize at ${flow.authorizeUrl}, then paste the code here`);
      openBrowserDefault(flow.authorizeUrl);
    }
    const code = Redacted.value(yield* Prompt.Password({ message: flow.flow === 'paste' ? 'Authorization code' : 'API key' }));
    const answered = yield* perform(OPS.complete_sign_in, { provider, code }, lens);
    if (answered.status === 'signed') return answered.account;
  }
  if (flow.flow === 'external-cli') {
    yield* Console.log(`finish the ${flow.provider} sign-in in its own CLI; Tagma reads the account when it lands`);
  } else if (flow.flow === 'device') {
    yield* Console.log(`open this URL and approve the sign-in:\n${flow.authorizeUrl}\nuser code: ${flow.userCode}`);
    openBrowserDefault(flow.authorizeUrl);
  } else if (flow.flow === 'loopback') {
    yield* Console.log(`opening the browser; if nothing opens, follow this URL:\n${flow.authorizeUrl}`);
    openBrowserDefault(flow.authorizeUrl);
  }
  yield* Console.log('waiting for authorization...');
  while (true) {
    const answered = yield* perform(
      OPS.complete_sign_in,
      { provider, account: flow.flow === 'external-cli' ? flow.account : undefined },
      lens,
    );
    if (answered.status === 'signed') return answered.account satisfies AccountStatus;
    yield* Effect.sleep(POLL_EVERY);
  }
});
