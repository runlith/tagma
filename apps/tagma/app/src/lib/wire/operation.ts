import { declarationsOf, type WireModule } from '@tagma/server/platform/contract/wire/manifest';
import { knownAnswer, type DeclaredAnswer, type OperationDeclaration } from '@tagma/server/platform/contract/wire/operation';
import { Service } from '@runlith/layer/key';
import type { Point } from '@runlith/layer/Point';
import { toJson } from '@runlith/utils/json';
import { Data, Effect, Schema } from 'effect';
import { createSubscriber } from 'svelte/reactivity';
import { WireCatalog } from './WireCatalog.js';

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

type Table = {
  readonly modules: readonly WireModule[];
  readonly declared: ReadonlyMap<string, OperationDeclaration>;
  readonly ownedBy: (module: string) => readonly string[];
};

type Decode = (answered: unknown) => Effect.Effect<unknown, Schema.SchemaError>;

type OperationCodec<Id extends CatalogOperationId> = {
  readonly payload: (input: OperationInput<Id>) => Effect.Effect<unknown, Schema.SchemaError>;
  readonly answer: (answered: unknown) => Effect.Effect<OperationAnswer<Id>, Schema.SchemaError>;
};

export class OperationTable extends Service<OperationTable>()('OperationTable', { tier: 'app' }) {
  static *make() {
    return new OperationTable(yield* WireCatalog);
  }

  private loading: { readonly modules: readonly WireModule[]; readonly table: Promise<Table> } | null = null;
  private loaded: Table | null = null;
  private loadedNotice: (() => void) | null = null;
  private readonly answers = new Map<OperationDeclaration, Decode>();
  private readonly subscribe = createSubscriber((update) => {
    this.loadedNotice = update;
    void this.load().then(update, update);
    return () => {
      this.loadedNotice = null;
    };
  });

  constructor(private readonly catalog: Point<WireModule>) {
    super();
  }

  load(): Promise<Table> {
    const modules = this.catalog.items;
    if (this.loading?.modules === modules) return this.loading.table;
    const table = declarationsOf(modules).then(
      (catalog): Table | Promise<Table> => {
        if (this.catalog.items !== modules) return this.load();
        const declared: ReadonlyMap<string, OperationDeclaration> = new Map(Object.entries(catalog.declarations));
        const read = { modules, declared, ownedBy: catalog.ownedBy };
        this.loaded = read;
        this.loadedNotice?.();
        return read;
      },
      (failure: unknown) => {
        if (this.loading?.table === table) this.loading = null;
        throw failure;
      },
    );
    this.loading = { modules, table };
    return table;
  }

  declared(id: string): OperationDeclaration | undefined {
    this.subscribe();
    return this.loaded?.declared.get(id);
  }

  ownedBy(module: string): readonly string[] {
    this.subscribe();
    return this.loaded?.ownedBy(module) ?? [];
  }

  of<Id extends CatalogOperationId>(id: Id): Effect.Effect<OperationCodec<Id>, OperationUndeclared> {
    const loaded = this.loaded;
    const table = loaded !== null && loaded.modules === this.catalog.items ? Effect.succeed(loaded) : Effect.promise(() => this.load());
    return Effect.flatMap(table, ({ declared }) => {
      const declaration = declared.get(id);
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
