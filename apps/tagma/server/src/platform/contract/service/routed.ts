import type { PermissionSubject } from '@runlith/agent/permissions';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Data, Effect } from 'effect';
import { type Bound, type Graphless, type MachinePlace, type SettleAnswer, type TaggedBody, body, pair } from './body.js';
import type { StoreFailure } from './store.js';
import type { Caller } from '../wire/caller.js';
import type { CallKey } from '../wire/ids.js';
import type { DeclaredAnswer, OperationDeclaration } from '../wire/operation.js';
import type { Place } from '../wire/place.js';
import type { Voice } from './presentation.js';
import { type FieldRefusal, GateRefusal, isFieldRefusal } from '../wire/refusal.js';

type Input<D extends OperationDeclaration> = D['input']['Type'];

type Refusal<D extends OperationDeclaration> = GateRefusal<D['refusals'][number] | FieldRefusal> | StoreFailure;

type RoutedParts<D extends OperationDeclaration, Prepared, Raw, R, E, RP, EP> = {
  readonly place?: (input: Input<D>, caller: Caller) => Effect.Effect<Place | null, EP, RP>;
  readonly files?: (input: Input<D>, caller: Caller) => readonly PermissionSubject[];
  readonly prepare?: (input: Input<D>, caller: Caller) => Effect.Effect<Prepared, E, R>;
  readonly execute: (input: Input<D>, prepared: Prepared, caller: Caller) => Effect.Effect<Raw, E, R>;
  readonly answer: (raw: Raw, input: Input<D>) => DeclaredAnswer<D['answer']>;
  readonly report?: (answer: DeclaredAnswer<D['answer']>, prepared: Prepared) => DeclaredAnswer<D['answer']>;
  readonly voice?: Voice<DeclaredAnswer<D['answer']>, Input<D>, R>;
  readonly display?: (answer: DeclaredAnswer<D['answer']>) => ToolDisplay;
  readonly settle?: (key: CallKey) => Effect.Effect<SettleAnswer, E, R>;
};

type Declared<D extends OperationDeclaration, E> = [Exclude<E, Refusal<D>>] extends [never]
  ? unknown
  : { readonly undeclaredRefusal: Exclude<E, Refusal<D>> };

export const routed = <const D extends OperationDeclaration, Raw, Prepared = undefined, R = never, E = never, RP = never, EP = never>(
  declaration: D,
  parts: RoutedParts<D, Prepared, Raw, R, E, RP, EP> &
    Declared<D, E | EP> &
    MachinePlace<NoInfer<D>, NoInfer<R | RP>> &
    Graphless<NoInfer<D>, NoInfer<R | RP>>,
) => {
  const { answer, report, settle, ...route } = parts as RoutedParts<D, Prepared, Raw, R, E, RP, EP>;
  const execute = (input: Input<D>, prepared: Prepared, caller: Caller) =>
    Effect.map(route.execute(input, prepared, caller), (raw) => answer(raw, input));
  const implementation = { ...route, execute, report, settle } as unknown as Parameters<typeof body<D, Prepared, R | RP, Refusal<D>>>[1];
  return {
    pair: pair(
      declaration,
      body<D, Prepared, R | RP, Refusal<D>>(declaration, implementation) as Parameters<
        typeof pair<D, TaggedBody<D, Prepared, R | RP, Refusal<D>>>
      >[1],
    ),
    route: { ...route, id: declaration.id } as unknown as Bound<Input<D>, Prepared, Raw, R | RP, (E | EP) & Refusal<D>>,
  };
};

type CodeOf<E> = E extends GateRefusal<infer C> ? C : never;

type Admission<D extends OperationDeclaration, E> =
  string extends CodeOf<E>
    ? unknown
    : [Exclude<CodeOf<E>, D['refusals'][number] | FieldRefusal>] extends [never]
      ? unknown
      : { readonly undeclaredRefusal: Exclude<CodeOf<E>, D['refusals'][number] | FieldRefusal> };

type Admitted<D extends OperationDeclaration, E> =
  E extends GateRefusal<infer C> ? (string extends C ? GateRefusal<D['refusals'][number] | FieldRefusal> : E) : E;

export class UndeclaredRefusal extends Data.TaggedError('UndeclaredRefusal')<{
  readonly code: string;
  readonly declared: readonly string[];
}> {
  override get message(): string {
    return `an owner raised the refusal ${this.code}, which its operation does not declare (${this.declared.join(', ')})`;
  }
}

const declares = (declared: readonly string[], code: string): Effect.Effect<void> =>
  declared.includes(code) ? Effect.void : Effect.die(new UndeclaredRefusal({ code, declared }));

export const admits = (declared: readonly string[], code: string): Effect.Effect<void> =>
  isFieldRefusal(code) ? Effect.void : declares(declared, code);

export const declaredRefusal =
  <const Code extends string>(declared: readonly Code[]) =>
  (refusal: GateRefusal): Effect.Effect<never, GateRefusal<Code>> =>
    Effect.andThen(declares(declared, refusal.code), Effect.fail(refusal as GateRefusal<Code>));

export const admitted =
  <D extends OperationDeclaration>(declaration: D) =>
  <A, E extends GateRefusal | StoreFailure, R>(work: Effect.Effect<A, E, R> & Admission<D, E>): Effect.Effect<A, Admitted<D, E>, R> =>
    Effect.catch(work as Effect.Effect<A, E, R>, (failure) =>
      Effect.andThen(
        failure instanceof GateRefusal ? admits(declaration.refusals, failure.code) : Effect.void,
        Effect.fail(failure as Admitted<D, E>),
      ),
    );

export const pairsOf = <const T extends Readonly<Record<string, { readonly pair: unknown }>>>(
  routes: T,
): { readonly [K in keyof T]: T[K]['pair'] } => Object.fromEntries(Object.entries(routes).map(([id, entry]) => [id, entry.pair])) as never;

export const routesOf = <const T extends Readonly<Record<string, { readonly route: unknown }>>>(
  routes: T,
): { readonly [K in keyof T]: T[K]['route'] } =>
  Object.fromEntries(Object.entries(routes).map(([id, entry]) => [id, entry.route])) as never;
