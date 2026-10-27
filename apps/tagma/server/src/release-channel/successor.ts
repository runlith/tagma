import { Effect, Schema } from 'effect';
import type { Operating } from '../installation/cli/server.js';
import type { HostVerdict } from '../installation/contract/service/steps.js';
import { INSTALLATION_OPERATIONS } from '../installation/contract/wire/operations.js';
import type { Weigh } from './install.js';

type Checked = { readonly verdict: 'takes' | 'refuses' | 'unasked'; readonly detail: string | null };

const readChecked = Schema.decodeUnknownResult(INSTALLATION_OPERATIONS.check_successor.answer);

const verdictOf = (answered: unknown): HostVerdict => {
  const read = readChecked(answered);
  if (read._tag !== 'Success' || read.success.status !== 'checked')
    return { _tag: 'Unasked', detail: 'the running server answered check_successor outside its checked shape' };
  const { verdict, detail } = read.success as Checked;
  return verdict === 'takes'
    ? { _tag: 'Takes' }
    : { _tag: verdict === 'refuses' ? 'Refuses' : 'Unasked', detail: detail ?? 'the server named no reason' };
};

export const weighedByServer =
  ({ ask, here }: Operating): Weigh =>
  (root) =>
    Effect.match(
      ask((door, at) =>
        door.operations.perform({ params: { id: 'check_successor' }, query: here(at), headers: {}, payload: { installation: root } }),
      ),
      {
        onFailure: (failure): HostVerdict => ({
          _tag: 'Unasked',
          detail: `the running server was not asked: ${failure instanceof Error ? failure.message : String(failure)}`,
        }),
        onSuccess: verdictOf,
      },
    );
