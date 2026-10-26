declare const madeByPoint: unique symbol;

export type Contribution = { readonly point: string; readonly id: string; readonly [madeByPoint]: true };

export type Contributed<A> = { readonly owner: string; readonly entry: A };
