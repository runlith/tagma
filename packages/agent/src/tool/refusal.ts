export type ToldRefusal = {
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
  readonly words?: { readonly text: string };
};

export function refusalTail(refusal: Omit<ToldRefusal, 'code' | 'reason'>): string[] {
  return [
    ...(refusal.words === undefined ? [] : [`said: ${refusal.words.text}`]),
    ...(refusal.inputFile === undefined ? [] : [`input file: ${refusal.inputFile}`]),
    ...refusal.unblock.map((way) => `unblock: ${way}`),
  ];
}

export function refusalLines(refusal: ToldRefusal): string[] {
  return [`refused[${refusal.code}]: ${refusal.reason}`, ...refusalTail(refusal)];
}
