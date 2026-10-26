import type { OperationDeclaration } from './operation.js';

type Projected<D extends OperationDeclaration> = D extends OperationDeclaration
  ? Omit<D, 'id' | 'input' | 'negative' | 'destructiveConsequence'> & {
      readonly params: D['input'];
      readonly mutates?: true;
      readonly negative?: (answer: unknown) => boolean;
    } & (D extends { readonly intent: 'destructive' } ? { readonly destructiveConsequence: (input: any) => string } : unknown)
  : never;

export const projectedOperations = <const Ds extends Readonly<Record<string, OperationDeclaration>>>(
  declarations: Ds,
): { readonly [K in keyof Ds]: Projected<Ds[K]> } =>
  Object.fromEntries(
    Object.entries(declarations).map(([id, { id: _id, input, negative, ...declared }]) => [
      id,
      {
        ...declared,
        params: input,
        mutates: declared.effect === 'read' ? undefined : (true as const),
        ...(negative === undefined
          ? {}
          : typeof negative === 'function'
            ? { negative: (answer: unknown) => negative(answer as never) }
            : { negative: (answer: unknown) => negative.includes((answer as { readonly status?: never }).status as never) }),
      },
    ]),
  ) as never;
