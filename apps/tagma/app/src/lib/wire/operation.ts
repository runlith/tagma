import { declarationsOf, type WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { knownAnswer, type DeclaredAnswer, type OperationDeclaration } from '@tagma/server/platform/contract/wire/operation';
import type { Point } from '@runlith/layer/Point';
import { toJson } from '@runlith/utils/json';
import { Data, Effect, Schema } from 'effect';

export interface Operations {}

export type CatalogOperationId = keyof Operations & string;

export type OperationInput<Id extends CatalogOperationId> = Operations[Id]['input']['Type'];

export type OperationAnswer<Id extends CatalogOperationId> = Operations[Id] extends { readonly answer: infer Answer extends Schema.Top }
  ? DeclaredAnswer<Answer>
  : unknown;

type SocketOnlyOperationId = {
  [K in CatalogOperationId]: Operations[K] extends { readonly doors: { readonly socket: true; readonly http: false } } ? K : never;
}[CatalogOperationId];

export type HttpOperationId = Exclude<CatalogOperationId, SocketOnlyOperationId>;

class OperationUndeclared extends Data.TaggedError('OperationUndeclared')<{ readonly id: string }> {
  override get message(): string {
    return `No module of this window's catalog declares the operation ${this.id}.`;
  }
}

type Declared = ReadonlyMap<string, OperationDeclaration>;

type Decode = (answered: unknown) => Effect.Effect<unknown, Schema.SchemaError>;

type OperationCodec<Id extends CatalogOperationId> = {
  readonly payload: (input: OperationInput<Id>) => Effect.Effect<unknown, Schema.SchemaError>;
  readonly answer: (answered: unknown) => Effect.Effect<OperationAnswer<Id>, Schema.SchemaError>;
};

export class OperationCodecs {
  private loading: { readonly modules: readonly WireModule[]; readonly declared: Promise<Declared> } | null = null;
  private loaded: { readonly modules: readonly WireModule[]; readonly declared: Declared } | null = null;
  private readonly answers = new Map<OperationDeclaration, Decode>();

  constructor(private readonly catalog: Point<WireModule>) {}

  load(): Promise<Declared> {
    const modules = this.catalog.items;
    if (this.loading?.modules === modules) return this.loading.declared;
    const declared = declarationsOf(modules).then(
      (catalog) => {
        const read: Declared = new Map(Object.entries(catalog.declarations));
        if (this.catalog.items === modules) this.loaded = { modules, declared: read };
        return read;
      },
      (failure: unknown) => {
        if (this.loading?.declared === declared) this.loading = null;
        throw failure;
      },
    );
    this.loading = { modules, declared };
    return declared;
  }

  of<Id extends CatalogOperationId>(id: Id): Effect.Effect<OperationCodec<Id>, OperationUndeclared> {
    const loaded = this.loaded;
    const declared =
      loaded !== null && loaded.modules === this.catalog.items ? Effect.succeed(loaded.declared) : Effect.promise(() => this.load());
    return Effect.flatMap(declared, (table) => {
      const declaration = table.get(id);
      if (declaration === undefined) return Effect.fail(new OperationUndeclared({ id }));
      const decode = this.decodeOf(declaration);
      return Effect.succeed({
        payload: (input) => Effect.map(Schema.encodeUnknownEffect(declaration.input)(input), toJson),
        answer: (answered) => decode(answered) as Effect.Effect<OperationAnswer<Id>, Schema.SchemaError>,
      });
    });
  }

  private decodeOf(declaration: OperationDeclaration): Decode {
    const held = this.answers.get(declaration);
    if (held !== undefined) return held;
    const decode: Decode = Schema.decodeUnknownEffect(Schema.toCodecJson(knownAnswer(declaration.answer)));
    this.answers.set(declaration, decode);
    return decode;
  }
}
