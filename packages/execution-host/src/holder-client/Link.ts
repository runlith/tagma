import type { Effect } from 'effect';
import type {
  ChannelFailed,
  HeldLaunch,
  HolderRefused,
  Readable,
  Terminal,
  TransportDescriptors,
  WorkState,
  Writable,
} from '../holder/Holder';

export type Reception = { readonly count: number; readonly handles: ReadonlyArray<number>; readonly capacity: boolean };

export type Owned = { readonly close: () => void };

export type HeldTerminal = Terminal & Owned;

export type HeldPipe = Readable & Writable & Owned;

export type Link = {
  readonly copies: TransportDescriptors;
  readonly receive: (landing: Uint8Array) => Effect.Effect<Reception, ChannelFailed>;
  readonly write: (bytes: Uint8Array) => Effect.Effect<number, ChannelFailed>;
  readonly close: () => void;
  readonly discard: (handle: number) => void;
  readonly terminal: (handles: ReadonlyArray<number>) => HeldTerminal;
  readonly pipe: (handle: number) => HeldPipe;
  readonly workState: (work: number, leader: number, exited: boolean) => WorkState;
  readonly prepare: (launch: HeldLaunch) => Effect.Effect<HeldLaunch, HolderRefused>;
};
