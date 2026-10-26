import { jsonCodec } from '@runlith/utils/codec';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Effect, Result, Schema } from 'effect';
import { type PluginPoint, PluginPointRefused, PluginPoints, type PluginRef } from './contract/service/points.js';
import { PluginEnvelope } from './contract/wire/manifest.js';

type Declared = PluginPoint<any>;

export type Checked = readonly { readonly point: Declared; readonly value: unknown }[];

export const contributesOf = (checked: Checked): Readonly<Record<string, unknown>> =>
  Object.fromEntries(checked.map(({ point, value }) => [point.name, value]));

export type PointRegistry = PluginPoints['Service'] & {
  check(plugin: string, contributes: Readonly<Record<string, unknown>> | undefined): Result.Result<Checked, string>;
  publish(
    plugin: PluginRef,
    checked: Checked,
    tools: readonly McpToolDescriptor[] | null,
    caller: McpToolCaller,
  ): Effect.Effect<() => void, PluginPointRefused>;
};

export const makeRegistry = (): PointRegistry => {
  const points = new Map<string, Declared>();
  const inputs = new WeakMap<Declared, Schema.Codec<unknown, unknown>>();
  const claimed = new Map<string, Map<string, string>>();

  const taken = (point: Declared, value: unknown, plugin: string): string | null => {
    for (const key of point.claims?.(value) ?? []) {
      const holder = claimed.get(point.name)?.get(key);
      if (holder !== undefined && holder !== plugin) return `contributes.${point.name} claims ${key}, which the plugin ${holder} holds`;
    }
    return null;
  };

  const claim = (point: Declared, value: unknown, plugin: string): (() => void) => {
    const keys = point.claims?.(value) ?? [];
    if (keys.length === 0) return () => undefined;
    const held = claimed.get(point.name) ?? new Map<string, string>();
    claimed.set(point.name, held);
    for (const key of keys) held.set(key, plugin);
    return () => {
      for (const key of keys) if (held.get(key) === plugin) held.delete(key);
    };
  };

  return {
    ...PluginPoints.of({
      declare: Effect.fnUntraced(function* (point) {
        const standing = points.get(point.name);
        if (standing !== undefined) {
          return yield* Effect.die(
            new Error(`the plugin point ${point.name} is declared by ${standing.owner} and again by ${point.owner}`),
          );
        }
        inputs.set(point, jsonCodec(Schema.optional(point.schema)));
        points.set(point.name, point);
        return () => {
          if (points.get(point.name) === point) points.delete(point.name);
        };
      }),
      schema: () => {
        const contributes = Object.fromEntries([...points].map(([name, point]) => [name, inputs.get(point)!]));
        const manifest = Schema.Struct({ ...PluginEnvelope.fields, contributes: Schema.optional(Schema.Struct(contributes)) });
        const document = Schema.toJsonSchemaDocument(jsonCodec(manifest), { onExcessProperty: 'error' });
        return Object.keys(document.definitions).length === 0 ? document.schema : { ...document.schema, $defs: document.definitions };
      },
    }),
    check: (plugin, contributes) => {
      const named = Object.entries(contributes ?? {});
      const unknown = named.filter(([name]) => !points.has(name)).map(([name]) => name);
      if (unknown.length > 0) {
        return Result.fail(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is a point' : 'are points'} no owner of this server declares; the points are ${[...points.keys()].join(', ')}`,
        );
      }
      const checked: { readonly point: Declared; readonly value: unknown }[] = [];
      for (const [name, raw] of named) {
        const point = points.get(name)!;
        const decoded = Schema.decodeUnknownResult(inputs.get(point)!)(raw, { onExcessProperty: 'error' });
        if (Result.isFailure(decoded)) return Result.fail(`contributes.${name}: ${decoded.failure.message}`);
        if (decoded.success === undefined) continue;
        const held = taken(point, decoded.success, plugin);
        if (held !== null) return Result.fail(held);
        checked.push({ point, value: decoded.success });
      }
      return Result.succeed(checked);
    },
    publish: Effect.fn('PluginPoints.publish')(function* (plugin, checked, tools, caller) {
      const releases: (() => void)[] = [];
      const withdraw = (): void => {
        for (const release of releases.splice(0).reverse()) release();
      };
      for (const { point, value } of checked) {
        const held = taken(point, value, plugin.id);
        if (held !== null) {
          withdraw();
          return yield* new PluginPointRefused({ point: point.name, reason: held });
        }
        releases.push(claim(point, value, plugin.id));
      }
      const byName = new Map(checked.map((entry) => [entry.point.name, entry]));
      const sibling = <B>(name: string, schema: Schema.Codec<B, unknown>): B | undefined => {
        const entry = byName.get(name);
        return entry !== undefined && entry.point.schema === schema ? (entry.value as B) : undefined;
      };
      for (const { point, value } of checked) {
        releases.push(yield* point.register({ plugin, value, sibling, tools, caller }).pipe(Effect.tapError(() => Effect.sync(withdraw))));
      }
      return withdraw;
    }),
  };
};
