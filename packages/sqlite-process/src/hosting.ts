import type { SqliteReply, SqliteRequest } from './channel.js';

export type Host = {
  readonly pid: number;
  readonly spawned: boolean;
  readonly signalCode: NodeJS.Signals | number | null;
  readonly exited: Promise<unknown>;
  readonly send: (request: SqliteRequest) => void;
  readonly kill: (signal?: NodeJS.Signals) => void;
};

export type Hosting = (receive: (reply: SqliteReply) => void, onExit: (host: Host, code: number | null) => void) => Host;
