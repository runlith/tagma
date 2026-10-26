import type { PermissionSubject } from '@runlith/agent/permissions';
import type { ToolMedia } from '@runlith/agent/tool';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { Data, Effect, Stream, type Schema } from 'effect';
import type { DeclaredAnswer, OperationDeclaration } from '../wire/operation.js';
import type { CallKey } from '../wire/ids.js';
import type { GraphStore, StoreFailure } from './store.js';
import type { GraphUnits } from './units.js';
import type { WriterRegister } from './writers.js';
import type { Caller } from '../wire/caller.js';
import { GateRefusal, type FieldRefusal, type RefusalBody } from '../wire/refusal.js';
import type { Place } from '../wire/place.js';
import type { PlaceScoped } from './place.js';
import type { Voice } from './presentation.js';

export type SettleAnswer =
  | { readonly status: 'happened'; readonly evidence: unknown }
  | { readonly status: 'not-happened'; readonly evidence: unknown }
  | { readonly status: 'unknown'; readonly current: unknown };

type DeclarationRefusal<D extends OperationDeclaration> = GateRefusal<D['refusals'][number] | FieldRefusal> | StoreFailure;

type OperationBody<D extends OperationDeclaration, Prepared, R, E> = {
  readonly place?: (input: D['input']['Type'], caller: Caller) => Effect.Effect<Place | null, E, R>;
  readonly files?: (input: D['input']['Type'], caller: Caller) => readonly PermissionSubject[];
  readonly prepare?: (input: D['input']['Type'], caller: Caller) => Effect.Effect<Prepared, E, R>;
  readonly execute: (input: D['input']['Type'], prepared: Prepared, caller: Caller) => Effect.Effect<DeclaredAnswer<D['answer']>, E, R>;
  readonly report?: (answer: DeclaredAnswer<D['answer']>, prepared: Prepared) => DeclaredAnswer<D['answer']>;
  readonly voice?: Voice<DeclaredAnswer<D['answer']>, D['input']['Type'], R>;
  readonly display?: (answer: DeclaredAnswer<D['answer']>) => ToolDisplay;
  readonly media?: (answer: DeclaredAnswer<D['answer']>) => Effect.Effect<readonly ToolMedia[], never, R>;
} & (D extends { readonly identity: 'manual' }
  ? { readonly settle: (key: CallKey) => Effect.Effect<SettleAnswer, E | GateRefusal, R> }
  : { readonly settle?: (key: CallKey) => Effect.Effect<SettleAnswer, E | GateRefusal, R> });

const bodyTag = Symbol('OperationBody');

export interface BodyMark<D extends OperationDeclaration> {
  readonly declaration: D;
  readonly [bodyTag]: true;
}

export type TaggedBody<D extends OperationDeclaration, Prepared, R, E> = OperationBody<D, Prepared, R, E> & BodyMark<D>;

export type MachinePlace<D extends OperationDeclaration, R> = D extends { readonly place: 'machine' }
  ? [Extract<R, PlaceScoped>] extends [never]
    ? unknown
    : { readonly placeOfMachineOperation: Extract<R, PlaceScoped> }
  : unknown;

export interface GraphScoped {
  readonly graphScoped: true;
}

type GraphReach<R> = Extract<R, { readonly key: `tagma/graph/${string}` } | GraphStore | GraphUnits | WriterRegister | GraphScoped>;

export type Graphless<D extends OperationDeclaration, R> = D extends { readonly graph: 'none' }
  ? [GraphReach<R>] extends [never]
    ? unknown
    : { readonly graphOfGraphlessOperation: GraphReach<R> }
  : unknown;

export const body = <
  const D extends OperationDeclaration,
  Prepared = undefined,
  R = never,
  E extends DeclarationRefusal<D> = DeclarationRefusal<D>,
>(
  declaration: D,
  implementation: OperationBody<NoInfer<D>, Prepared, R, E>,
): TaggedBody<D, Prepared, R, E> => {
  const report = implementation.report;
  const execute =
    report === undefined
      ? implementation.execute
      : (input: D['input']['Type'], prepared: Prepared, caller: Caller) =>
          Effect.map(implementation.execute(input, prepared, caller), (answer) => report(answer, prepared));
  return { ...implementation, report: undefined, execute, declaration, [bodyTag]: true as const };
};

export class OperationPairInvalid extends Data.TaggedError('OperationPairInvalid')<{
  readonly declaration: string;
  readonly body: string;
}> {}

type DeclaredBody<D extends OperationDeclaration> = OperationBody<D, any, unknown, DeclarationRefusal<D>> & BodyMark<D>;

const pairTag = Symbol('OperationPair');

export type OperationPair<D extends OperationDeclaration = OperationDeclaration, B extends DeclaredBody<D> = DeclaredBody<D>> = {
  readonly [pairTag]: true;
  readonly id: D['id'];
  readonly declaration: D;
  readonly body: B;
};

type Needs<F> = F extends (...args: any) => Effect.Effect<any, any, infer R> ? R : never;

type BodyNeeds<B extends DeclaredBody<any>> = Needs<B['execute']> | Needs<B['prepare']> | Needs<B['place']>;

export const pair = <const D extends OperationDeclaration, const B extends DeclaredBody<NoInfer<D>>>(
  declaration: D,
  implementation: B & MachinePlace<NoInfer<D>, BodyNeeds<NoInfer<B>>> & Graphless<NoInfer<D>, BodyNeeds<NoInfer<B>>>,
): OperationPair<D, B> => {
  if (implementation.declaration !== declaration)
    throw new OperationPairInvalid({ declaration: declaration.id, body: implementation.declaration.id });
  return { id: declaration.id, declaration, body: implementation, [pairTag]: true };
};

export type BoundDeclaration = { readonly refusals: readonly string[] } & (
  | { readonly input: Schema.Top }
  | { readonly params: Schema.Top }
);

export type InputOf<D extends BoundDeclaration> = D extends { readonly input: Schema.Top }
  ? D['input']['Type']
  : D extends { readonly params: Schema.Top }
    ? D['params']['Type']
    : never;

export type RefusalOf<D extends BoundDeclaration> = D['refusals'][number];

export type Refused<D extends BoundDeclaration> = GateRefusal<RefusalOf<D> | FieldRefusal> | StoreFailure;

type Performed<Input, Prepared, Answer, R, E> = {
  readonly place?: (input: Input, caller: Caller) => Effect.Effect<Place | null, E, R>;
  readonly files?: (input: Input, caller: Caller) => readonly PermissionSubject[];
  readonly prepare?: (input: Input, caller: Caller) => Effect.Effect<Prepared, E, R>;
  readonly execute: (input: Input, prepared: Prepared, caller: Caller) => Effect.Effect<Answer, E, R>;
  readonly answer?: (value: Answer, input: Input) => unknown;
  readonly settle?: (key: CallKey) => Effect.Effect<SettleAnswer, GateRefusal | StoreFailure, R>;
};

export type BoundBody<D extends BoundDeclaration, Prepared = undefined, Answer = unknown, R = never, E = Refused<D>> = Performed<
  InputOf<D>,
  Prepared,
  Answer,
  R,
  E
>;

export type Bound<Input, Prepared = undefined, Answer = unknown, R = never, E = unknown> = Performed<Input, Prepared, Answer, R, E> & {
  readonly id: string;
};

export const bind = <
  const T extends Readonly<Record<string, BoundDeclaration>>,
  K extends keyof T & string,
  Prepared,
  Answer,
  R,
  E extends Refused<T[K]>,
>(
  _declarations: T,
  id: K,
  body: BoundBody<T[K], Prepared, Answer, R, E>,
): Bound<InputOf<T[K]>, Prepared, Answer, R, E> => ({ ...body, id });

export const refusing = <A, R>(work: Effect.Effect<A, GateRefusal | StoreFailure | RefusalBody, R>): Effect.Effect<A, RefusalBody, R> =>
  Effect.catch(work, (error) =>
    error instanceof Error && !(error instanceof GateRefusal) ? Effect.die(error) : Effect.fail<RefusalBody>(error),
  );

export const refusingStream = <A, R>(stream: Stream.Stream<A, GateRefusal | StoreFailure, R>): Stream.Stream<A, RefusalBody, R> =>
  Stream.catch(stream, (error) => (error instanceof GateRefusal ? Stream.fail<RefusalBody>(error) : Stream.die(error)));
