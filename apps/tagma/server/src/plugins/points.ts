import { jsonCodec } from '@runlith/utils/codec';
import { Effect, Result, Schema } from 'effect';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import { type PluginChecked, PluginPointRefused, PluginPoints, type PluginRegister } from './contract/service/points.js';

type Declared = {
  readonly point: PluginFaced<any>;
  readonly input: Schema.Codec<unknown, unknown>;
  readonly register: PluginRegister<any>;
};

export const makePoints = () => {
  const points = new Map<string, Declared>();
  const claimed = new Map<string, Map<string, string>>();

  const taken = ({ point }: Declared, value: unknown, plugin: string): string | null => {
    for (const key of point.plugin.claims?.(value) ?? []) {
      const holder = claimed.get(point.plugin.name)?.get(key);
      if (holder !== undefined && holder !== plugin)
        return `contributes.${point.plugin.name} claims ${key}, which the plugin ${holder} holds`;
    }
    return null;
  };

  const claim = ({ point }: Declared, value: unknown, plugin: string): (() => void) => {
    const keys = point.plugin.claims?.(value) ?? [];
    if (keys.length === 0) return () => undefined;
    const held = claimed.get(point.plugin.name) ?? new Map<string, string>();
    claimed.set(point.plugin.name, held);
    for (const key of keys) held.set(key, plugin);
    return () => {
      for (const key of keys) if (held.get(key) === plugin) held.delete(key);
    };
  };

  return PluginPoints.of({
    declare: Effect.fnUntraced(function* (point, register) {
      const { name, schema } = point.plugin;
      const standing = points.get(name);
      if (standing !== undefined) {
        return yield* Effect.die(new Error(`the plugin point ${name} is declared by ${standing.point.id} and again by ${point.id}`));
      }
      const declared: Declared = { point, input: jsonCodec(Schema.optional(schema)), register };
      points.set(name, declared);
      return () => {
        if (points.get(name) === declared) points.delete(name);
      };
    }),
    check: (plugin, contributes) => {
      const named = Object.entries(contributes);
      const unknown = named.filter(([name]) => !points.has(name)).map(([name]) => name);
      if (unknown.length > 0) {
        return Result.fail(
          `${unknown.join(', ')} ${unknown.length === 1 ? 'is a point' : 'are points'} no owner of this server declares; the points are ${[...points.keys()].join(', ')}`,
        );
      }
      const checked: Record<string, unknown> = {};
      for (const [name, raw] of named) {
        const declared = points.get(name)!;
        const decoded = Schema.decodeUnknownResult(declared.input)(raw, { onExcessProperty: 'error' });
        if (Result.isFailure(decoded)) return Result.fail(`contributes.${name}: ${decoded.failure.message}`);
        if (decoded.success === undefined) continue;
        const held = taken(declared, decoded.success, plugin);
        if (held !== null) return Result.fail(held);
        checked[name] = decoded.success;
      }
      return Result.succeed(checked satisfies PluginChecked);
    },
    title: (name) => points.get(name)?.point.plugin.title,
    publish: Effect.fn('PluginPoints.publish')(function* (plugin, checked, caller) {
      const entries = Object.entries(checked).flatMap(([name, value]) => {
        const declared = points.get(name);
        return declared === undefined ? [] : [{ declared, value }];
      });
      const releases: (() => void)[] = [];
      const withdraw = (): void => {
        for (const release of releases.splice(0).reverse()) release();
      };
      for (const { declared, value } of entries) {
        const held = taken(declared, value, plugin.id);
        if (held !== null) {
          withdraw();
          return yield* new PluginPointRefused({ point: declared.point.plugin.name, reason: held });
        }
        releases.push(claim(declared, value, plugin.id));
      }
      const byPoint = new Map(entries.map((entry) => [entry.declared.point, entry.value]));
      const sibling = <B>(point: PluginFaced<B>): B | undefined => byPoint.get(point) as B | undefined;
      for (const { declared, value } of entries) {
        releases.push(yield* declared.register({ plugin, value, sibling, caller }).pipe(Effect.tapError(() => Effect.sync(withdraw))));
      }
      return withdraw;
    }),
  });
};
