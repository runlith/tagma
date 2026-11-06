import { ActivityRecord } from '@runlith/activity/store/record';
import type { AskKind } from '@runlith/llm/models/description';
import type { JsonSchema } from '@runlith/llm/schema/ids';
import { Clock, Effect } from 'effect';
import { activityKeepHours } from '../activity/contract/wire/settings.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { AskChoice } from '../platform/contract/wire/setting.js';
import { Settings } from '../settings/contract/service/values.js';
import { askGate, ModelAsks, type AskRefused } from './contract/service/asks.js';
import { askModel as askModelSetting } from './contract/wire/settings.js';

type OutsideAsk = {
  readonly prompt: string;
  readonly system?: string;
  readonly model?: AskChoice;
  readonly schema?: JsonSchema;
};

const HOUR = 60 * 60 * 1000;

const refusal = (kind: AskKind) => (refused: AskRefused) =>
  askGate(refused, [`name a model that answers ${kind} asks, or choose one in \`ask.model\``]);

export const askModel = Effect.fn('ModelAsks.outside')(function* (input: OutsideAsk, caller: string | undefined) {
  const asks = yield* ModelAsks;
  const kind = input.schema === undefined ? 'text' : 'object';
  const role = input.model ?? (yield* (yield* Settings).value(askModelSetting));
  const refused = refusal(kind);
  const selection = yield* asks.choose(kind, role).pipe(Effect.mapError(refused));
  const ask = { system: input.system ?? '', input: input.prompt, caller };
  if (input.schema === undefined) {
    const answered = yield* asks.text(selection, ask).pipe(Effect.mapError(refused));
    return { status: 'text' as const, text: answered.value };
  }
  const answered = yield* asks.object(selection, ask, input.schema).pipe(Effect.mapError(refused));
  return { status: 'object' as const, value: answered.value };
});

const INPUT = 'usage.inputTokens';
const OUTPUT = 'usage.outputTokens';

export const askUsage = Effect.fn('ModelAsks.usage')(function* (caller: string) {
  const record = yield* ActivityRecord;
  const hours = yield* (yield* Settings).value(activityKeepHours);
  const now = yield* Clock.currentTimeMillis;
  const answered = yield* record
    .groups({
      through: now,
      since: now - hours * HOUR,
      where: [
        { path: 'kind', op: 'eq', value: 'ask' },
        { path: 'attrs.caller', op: 'eq', value: caller },
      ],
      group: ['outcome'],
      count: true,
      sum: [INPUT, OUTPUT],
      offset: 0,
      limit: 8,
    })
    .pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('activity-unreadable', `the activity store could not be read: ${failure.reason}`, [
            'read again; a store that stays unreadable is named in the server log',
          ]),
      ),
    );
  const sum = (path: string) => answered.groups.reduce((total, group) => total + (group.sum[path] ?? 0), 0);
  const asks = answered.groups.reduce((total, group) => total + group.count, 0);
  const done = answered.groups.reduce((total, group) => total + (group.by['outcome'] === 'ok' ? group.count : 0), 0);
  return { hours, asks, unanswered: asks - done, inputTokens: sum(INPUT), outputTokens: sum(OUTPUT) };
});
