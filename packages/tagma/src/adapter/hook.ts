export type HookVerdict = { readonly allowed: boolean; readonly words: string };

export type HookMoment = 'before' | 'after';

export type HookTrust = {
  readonly home: string;
  readonly folder: string;
  readonly file: string;
  readonly table: string;
  readonly key: (filePath: string, event: string, group: number, handler: number) => string;
};

export type HookCommand = { readonly command: string; readonly timeout?: number };

export type HookHandler = HookCommand & { readonly type: 'command' };

export type HookEntry = HookCommand | { readonly hooks: readonly HookHandler[] };

export type HookFileShape = {
  readonly keys: Readonly<Record<string, unknown>>;
  readonly events: readonly string[];
  readonly holes: boolean;
  readonly trust: HookTrust | null;
  readonly entry: (command: string, timeout: number | undefined) => HookEntry;
};

export type HookCodec = {
  readonly file: HookFileShape;
  readonly permission: (verdict: HookVerdict) => string;
  readonly context: (text: string) => string;
  readonly tool: (text: string, moment: HookMoment) => string;
  readonly prompt: ((text: string) => string) | null;
};
