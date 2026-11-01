import { Context, Effect, Option } from 'effect';
import { GateRefusal, type Unblock } from '../wire/refusal.js';
import type { Right, RightKey } from '../wire/right.js';

export class Access extends Context.Service<
  Access,
  {
    right(key: RightKey): Effect.Effect<Right>;
  }
>()('tagma/platform/Access') {}

type RightUse = 'read' | 'write';

export type NamedRight = { readonly key: RightKey; readonly by: string };

const short = (right: Right, use: RightUse): boolean => right.access === 'none' || (right.access === 'read' && use === 'write');

const waysOf = (right: Right): Unblock => {
  const [first, ...rest] = right.unblock;
  return first === undefined ? [`gain the right "${right.key}" from whoever grants this build's access`] : [first, ...rest];
};

const rightMissing = (subject: string, right: Right): GateRefusal<'right-missing'> =>
  new GateRefusal(
    'right-missing',
    `${subject} needs the right "${right.key}", which stands ${right.state} with ${right.access} access`,
    waysOf(right),
    undefined,
    undefined,
    undefined,
    right,
  );

export const admitRight = (subject: string, key: RightKey | undefined, use: RightUse): Effect.Effect<void, GateRefusal<'right-missing'>> =>
  key === undefined
    ? Effect.void
    : Effect.flatMap(
        Effect.serviceOption(Access),
        Option.match({
          onNone: () => Effect.die(new Error(`${subject} names the right "${key}", and no access filler stands in this context.`)),
          onSome: (access) =>
            Effect.flatMap(access.right(key), (right) => (short(right, use) ? Effect.fail(rightMissing(subject, right)) : Effect.void)),
        }),
      );
