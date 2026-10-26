export type NativeRefusal = 'failed' | 'would-block' | 'closed' | 'invalid' | 'gone';
export type Refused = { readonly refusal: NativeRefusal; readonly detail: string };
export type NativeAnswer = { readonly count: number } | Refused;
export type NativeStatus = Refused | undefined;

const REFUSALS: Record<number, NativeRefusal> = {
  [-1]: 'failed',
  [-2]: 'would-block',
  [-3]: 'closed',
  [-5]: 'invalid',
  [-7]: 'gone',
};

export const refusalOf = (code: number): NativeRefusal => REFUSALS[code] ?? 'failed';
