export type Applications = {
  readonly carrier: (dir: string) => string | null;
  readonly carried: (unpacked: string) => string | null;
  readonly verify: (bundle: string, signal: AbortSignal) => Promise<string | null>;
  readonly copy: (bundle: string, to: string) => Promise<void>;
  readonly unquarantine: (path: string) => Promise<string | null>;
  readonly forget: (dir: string) => void;
  readonly signature: (carried: string, installRoot: string, signal: AbortSignal) => Promise<string | null>;
};
