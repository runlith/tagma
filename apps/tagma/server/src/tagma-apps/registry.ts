import { jsonCodec } from '@runlith/utils/codec';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Effect, Result, Schema } from 'effect';
import type { AppFaced } from '../platform/contract/service/contribution.js';
import { TagmaAppPointRefused, TagmaAppPoints, type TagmaAppRef, type TagmaAppRegister } from './contract/service/points.js';
import { TagmaAppEnvelope } from './contract/wire/manifest.js';

type Declared = {
  readonly point: AppFaced<any>;
  readonly input: Schema.Codec<unknown, unknown>;
  readonly register: TagmaAppRegister<any>;
};

export type Checked = readonly { readonly declared: Declared; readonly value: unknown }[];

export const contributesOf = (checked: Checked): Readonly<Record<string, unknown>> =>
  Object.fromEntries(checked.map(({ declared, value }) => [declared.point.app.name, value]));

export type PointRegistry = TagmaAppPoints['Service'] & {
  check(app: string, contributes: Readonly<Record<string, unknown>> | undefined): Result.Result<Checked, string>;
  publish(
    app: TagmaAppRef,
    checked: Checked,
    tools: readonly McpToolDescriptor[] | null,
    caller: McpToolCaller,
  ): Effect.Effect<() => void, TagmaAppPointRefused>;
};

export const makeRegistry = (): PointRegistry => {
  const points = new Map<string, Declared>();
  const claimed = new Map<string, Map<string, string>>();

  const taken = ({ point }: Declared, value: unknown, app: string): string | null => {
    for (const key of point.app.claims?.(value) ?? []) {
      const holder = claimed.get(point.app.name)?.get(key);
      if (holder !== undefined && holder !== app) return `contributes.${point.app.name} claims ${key}, which the app ${holder} holds`;
    }
    return null;
  };

  const claim = ({ point }: Declared, value: unknown, app: string): (() => void) => {
    const keys = point.app.claims?.(value) ?? [];
    if (keys.length === 0) return () => undefined;
    const held = claimed.get(point.app.name) ?? new Map<string, string>();
    claimed.set(point.app.name, held);
    for (const key of keys) held.set(key, app);
    return () => {
      for (const key of keys) if (held.get(key) === app) held.delete(key);
    };
  };

  return {
    ...TagmaAppPoints.of({
      declare: Effect.fnUntraced(function* (point, register) {
        const { name, schema } = point.app;
        const standing = points.get(name);
        if (standing !== undefined) {
          return yield* Effect.die(new Error(`the app point ${name} is declared by ${standing.point.id} and again by ${point.id}`));
        }
        const declared: Declared = { point, input: jsonCodec(Schema.optional(schema)), register };
        points.set(name, declared);
        return () => {
          if (points.get(name) === declared) points.delete(name);
        };
      }),
      schema: () => {
        const contributes = Object.fromEntries([...points].map(([name, declared]) => [name, declared.input]));
        const manifest = Schema.Struct({ ...TagmaAppEnvelope.fields, contributes: Schema.optional(Schema.Struct(contributes)) });
        const document = Schema.toJsonSchemaDocument(jsonCodec(manifest), { onExcessProperty: 'error' });
        return Object.keys(document.definitions).length === 0 ? document.schema : { ...document.schema, $defs: document.definitions };
      },
    }),
    check: (app, contributes) => {
      const named = Object.entries(contributes ?? {});
      const unknown = named.filter(([name]) => !points.has(name)).map(([name]) => name);
      if (unknown.length > 0) {
        return Result.fail(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is a point' : 'are points'} no owner of this server declares; the points are ${[...points.keys()].join(', ')}`,
        );
      }
      const checked: { readonly declared: Declared; readonly value: unknown }[] = [];
      for (const [name, raw] of named) {
        const declared = points.get(name)!;
        const decoded = Schema.decodeUnknownResult(declared.input)(raw, { onExcessProperty: 'error' });
        if (Result.isFailure(decoded)) return Result.fail(`contributes.${name}: ${decoded.failure.message}`);
        if (decoded.success === undefined) continue;
        const held = taken(declared, decoded.success, app);
        if (held !== null) return Result.fail(held);
        checked.push({ declared, value: decoded.success });
      }
      return Result.succeed(checked);
    },
    publish: Effect.fn('TagmaAppPoints.publish')(function* (app, checked, tools, caller) {
      const releases: (() => void)[] = [];
      const withdraw = (): void => {
        for (const release of releases.splice(0).reverse()) release();
      };
      for (const { declared, value } of checked) {
        const held = taken(declared, value, app.id);
        if (held !== null) {
          withdraw();
          return yield* new TagmaAppPointRefused({ point: declared.point.app.name, reason: held });
        }
        releases.push(claim(declared, value, app.id));
      }
      const byPoint = new Map(checked.map((entry) => [entry.declared.point, entry.value]));
      const sibling = <B>(point: AppFaced<B>): B | undefined => byPoint.get(point) as B | undefined;
      for (const { declared, value } of checked) {
        releases.push(yield* declared.register({ app, value, sibling, tools, caller }).pipe(Effect.tapError(() => Effect.sync(withdraw))));
      }
      return withdraw;
    }),
  };
};
