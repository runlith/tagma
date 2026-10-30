import { Result, Schema } from 'effect';
import {
  HOST_COMMAND,
  type HarnessAddress,
  type HarnessCut,
  type HarnessCutMaking,
  type PrepareAnswer,
  type PrepareJudgment,
} from '@runlith/tagma/adapter/harness';
import { runAddress } from './chain.js';

export const CUT_METHODS = { initialize: 'initialize', fork: 'fork', turns: 'turns' } as const;

export const ForkAsked = Schema.Struct({ root: Schema.String, address: Schema.NullOr(Schema.String), dir: Schema.String });
export type ForkAsked = typeof ForkAsked.Type;

export const Forked = Schema.Struct({ sessionId: Schema.String, path: Schema.String });
export type Forked = typeof Forked.Type;

export const TurnsAsked = Schema.Struct({ root: Schema.String });
export type TurnsAsked = typeof TurnsAsked.Type;

export const Turns = Schema.Struct({ addresses: Schema.Array(Schema.NullOr(Schema.String)) });
export type Turns = typeof Turns.Type;

const judged =
  <A, T>(method: string, schema: Schema.Decoder<A>, accept: (value: A) => T) =>
  (outcome: PrepareAnswer): PrepareJudgment<T> => {
    if (outcome._tag === 'VendorError')
      return { _tag: 'Refuse', reason: `${method} was refused by the cut server: ${outcome.code} ${outcome.message}` };
    const decoded = Schema.decodeUnknownResult(schema)(outcome.value);
    return Result.isFailure(decoded)
      ? { _tag: 'Refuse', reason: `${method} answered in a shape the cut server does not speak` }
      : { _tag: 'Accept', value: accept(decoded.success) };
  };

const making: HarnessCutMaking = {
  _tag: 'Prepare',
  server: () => ({ program: HOST_COMMAND, args: ['harness-run', 'claude-code', '--cut'] }),
  initialize: {
    request: (client) => ({ method: CUT_METHODS.initialize, params: { client } }),
    judge: judged(CUT_METHODS.initialize, Schema.Struct({}), () => undefined),
  },
  fork: {
    request: (ask, workspace) => ({
      method: CUT_METHODS.fork,
      params: { root: ask.root, address: ask.address, dir: workspace } satisfies ForkAsked,
    }),
    judge: judged(CUT_METHODS.fork, Forked, (forked) => ({ id: forked.sessionId, artifact: forked.path })),
  },
  rows: {
    request: (root) => ({ method: CUT_METHODS.turns, params: { root } satisfies TurnsAsked }),
    judge: judged(CUT_METHODS.turns, Turns, (turns) => turns.addresses),
  },
};

export const claudeCut: HarnessCut = { whole: making, point: making };

export const claudeAddress: HarnessAddress = { reads: 'transcript', of: runAddress };
