import { Effect, Result } from 'effect';
import type { PluginFaced } from '../platform/contract/service/contribution.js';
import type { PluginFace } from '../platform/contract/wire/contribution.js';
import {
  type HeldContributions,
  type PluginContribution,
  PluginPointRefused,
  PluginPoints,
  type PluginRegister,
} from './contract/service/points.js';
import { contributionOf, contributionsRefusal } from './contract/wire/contributions.js';

type Declared = {
  readonly point: PluginFaced<any>;
  readonly register: PluginRegister<any>;
};

export const makePoints = () => {
  const points = new Map<string, Declared>();
  const faces = new Map<string, PluginFace<any>>();
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

  const declare = Effect.fnUntraced(function* <W>(point: PluginFaced<W>, register: PluginRegister<W>) {
    const { name } = point.plugin;
    const standing = points.get(name);
    if (standing !== undefined) {
      return yield* Effect.die(new Error(`the plugin point ${name} is declared by ${standing.point.id} and again by ${point.id}`));
    }
    const declared: Declared = { point, register };
    points.set(name, declared);
    faces.set(name, point.plugin);
    return () => {
      if (points.get(name) !== declared) return;
      points.delete(name);
      faces.delete(name);
    };
  });

  return PluginPoints.of({
    declare,
    hold: Effect.fnUntraced(function* <W>(point: PluginFaced<W>) {
      const held = new Map<string, PluginContribution<W>>();
      const listeners = new Set<(plugin: string) => void>();
      const told = (plugin: string): void => {
        for (const listener of listeners) listener(plugin);
      };
      const register: PluginRegister<W> = (contribution) =>
        Effect.sync(() => {
          const { id } = contribution.plugin;
          held.set(id, contribution);
          told(id);
          return () => {
            if (held.get(id) !== contribution) return;
            held.delete(id);
            told(id);
          };
        });
      yield* Effect.acquireRelease(declare(point, register), (withdraw) => Effect.sync(withdraw));
      return {
        of: (plugin) => held.get(plugin),
        all: () => held,
        changed: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      } satisfies HeldContributions<W>;
    }),
    check: (plugin, contributes) => {
      const checked = contributionsRefusal(plugin, faces, contributes);
      if (Result.isFailure(checked)) return checked;
      for (const [name, value] of Object.entries(checked.success)) {
        const held = taken(points.get(name)!, value, plugin);
        if (held !== null) return Result.fail(held);
      }
      return checked;
    },
    shown: (name, value) => {
      const face = faces.get(name);
      const decoded =
        face === undefined || (face.entries === undefined && face.uses === undefined) ? undefined : contributionOf(face, value);
      const read = decoded !== undefined && Result.isSuccess(decoded) ? decoded.success : undefined;
      return {
        title: face?.title,
        entries: read === undefined ? [] : (face?.entries?.(read) ?? []),
        uses: read === undefined ? null : (face?.uses?.(read) ?? null),
      };
    },
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
      for (const { declared, value } of entries) {
        releases.push(yield* declared.register({ plugin, value, caller }).pipe(Effect.tapError(() => Effect.sync(withdraw))));
      }
      return withdraw;
    }),
  });
};
