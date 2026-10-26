import { Context, Effect } from 'effect';

export type HoldToken = {
  readonly resource: string;
  readonly rank: number;
  readonly key: string;
  readonly stack: string;
  readonly since: number;
  readonly heldFor: string | null;
  live: boolean;
};

export type TicketToken = {
  readonly phase: string;
  live: boolean;
};

export type Holding = {
  readonly tokens: readonly HoldToken[];
  readonly tickets: readonly TicketToken[];
  readonly within: readonly string[];
};

export const Holding = Context.Reference<Holding>('@runlith/held/Holding', {
  defaultValue: () => ({ tokens: [], tickets: [], within: [] }),
});

export const Origin = Context.Reference<ReadonlySet<string>>('@runlith/held/Origin', { defaultValue: () => new Set() });

export const HeldFor = Context.Reference<string | null>('@runlith/held/HeldFor', { defaultValue: () => null });

export const liveHolds = (holding: Holding): readonly HoldToken[] =>
  holding.tokens.length === 0 ? holding.tokens : holding.tokens.filter((token) => token.live);

export const liveTickets = (holding: Holding): readonly TicketToken[] => holding.tickets.filter((ticket) => ticket.live);

export const occupied: Effect.Effect<ReadonlySet<string>> = Effect.map(
  Holding,
  (holding) => new Set([...holding.within, ...liveHolds(holding).map((token) => `${token.resource}:${token.key}`)]),
);

export type Stall = {
  readonly resource: string;
  readonly owner: string;
  readonly key: string;
  readonly kind: 'hold-threshold' | 'hold-cut' | 'wait-ceiling';
  readonly ms: number;
};

export type StallRecord = Stall & { readonly heldFor: string | null };

export const StallRecords = Context.Reference<(record: StallRecord) => Effect.Effect<void>>('@runlith/held/StallRecords', {
  defaultValue: () => (record) =>
    Effect.sync(() =>
      console.warn(
        `[held] ${record.owner} ${record.resource} ${record.key}: ${record.kind} after ${record.ms} ms${record.heldFor === null ? '' : ` — ${record.heldFor}`}`,
      ),
    ),
});

export const stall = (sighted: Stall): Effect.Effect<void> =>
  Effect.flatMap(Effect.all([StallRecords, HeldFor]), ([write, heldFor]) => write({ ...sighted, heldFor }));
