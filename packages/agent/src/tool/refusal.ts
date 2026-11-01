export type ToldRefusal = {
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly string[];
  readonly inputFile?: string;
  readonly words?: { readonly text: string };
  readonly field?: string;
  readonly right?: { readonly key: string; readonly state: string; readonly access: string; readonly until?: number };
};

const rightLine = (right: NonNullable<ToldRefusal['right']>): string =>
  `right: ${right.key} (${right.state}, access ${right.access}${right.until === undefined ? '' : `, until ${new Date(right.until).toISOString()}`})`;

export function refusalTail(refusal: Omit<ToldRefusal, 'code' | 'reason'>): string[] {
  return [
    ...(refusal.field === undefined ? [] : [`field: ${refusal.field}`]),
    ...(refusal.right === undefined ? [] : [rightLine(refusal.right)]),
    ...(refusal.words === undefined ? [] : [`said: ${refusal.words.text}`]),
    ...(refusal.inputFile === undefined ? [] : [`input file: ${refusal.inputFile}`]),
    ...refusal.unblock.map((way) => `unblock: ${way}`),
  ];
}

export function refusalLines(refusal: ToldRefusal): string[] {
  return [`refused[${refusal.code}]: ${refusal.reason}`, ...refusalTail(refusal)];
}
