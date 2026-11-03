import { Data, type Effect } from 'effect';

export class ApplicationNotCopied extends Data.TaggedError('ApplicationNotCopied')<{
  readonly path: string;
  readonly reason: string;
  readonly needed?: number;
}> {
  override get message(): string {
    return `${this.path}: ${this.reason}`;
  }
}

export type Applications = {
  readonly kept: (root: string, name: string) => string;
  readonly inside: (application: string) => string;
  readonly carrier: (dir: string) => string | null;
  readonly carried: (unpacked: string) => string | null;
  readonly verify: (bundle: string) => Effect.Effect<string | null>;
  readonly copy: (bundle: string, to: string) => Effect.Effect<void, ApplicationNotCopied>;
  readonly unquarantine: (path: string) => Effect.Effect<string | null>;
  readonly forget: (dir: string) => void;
  readonly signature: (carried: string, installRoot: string) => Effect.Effect<string | null>;
};
