import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import type { Host } from '@runlith/layer/Host';
import { type KeyClass, type Resolver, Service } from '@runlith/layer/key';
import type { Keyed } from '$lib/app/keys/resolve.js';
import { Point } from '@runlith/layer/Point';
import type { Component } from 'svelte';
import type { Surface } from '$lib/features/workspace/surface.js';

export type ActionEnv = {
  readonly project: Project | null;
  readonly routeProject: string | null;
  readonly surface: Surface | null;
  goto(href: string): void;
  resolve<Self>(key: KeyClass<string, Self>): Self;
};

type DefaultKey = string | { readonly keys: string; readonly global: true };

export type DefaultKeys = readonly DefaultKey[] | { readonly mac: readonly DefaultKey[]; readonly other: readonly DefaultKey[] };

type ActionOwner = { readonly plugin: string; readonly title: string; readonly rank: number };

type Common = {
  readonly id: string;
  readonly title: string;
  readonly keywords?: readonly string[];
  readonly order?: number;
  readonly icon?: Component<{ class?: string }>;
  readonly palette?: false;
  readonly keys?: DefaultKeys;
  readonly tabKeys?: DefaultKeys;
  readonly hold?: boolean;
  readonly by?: ActionOwner;
  available?(env: ActionEnv): boolean;
  listed?(env: ActionEnv): boolean;
  disabled?(env: ActionEnv): boolean;
  note?(env: ActionEnv): string | null;
};

export type Action = Common &
  ({ readonly region?: undefined; run?(env: ActionEnv): void | Promise<void> } | { readonly region: 'terminal'; readonly run?: undefined });

export type ActionList = readonly Action[] | ((app: Resolver) => readonly Action[]);

export type ActionSet = { readonly id: string; readonly area: string; readonly actions: ActionList };

export type Listed = { readonly area: string; readonly action: Action };

const forHost = (keys: DefaultKeys | undefined, mac: boolean): readonly DefaultKey[] =>
  keys === undefined ? [] : 'mac' in keys ? (mac ? keys.mac : keys.other) : keys;

export const keyedOf = (actions: readonly Action[], host: Host): readonly Keyed[] =>
  actions.map((action) => ({
    id: action.id,
    place: action.region ?? 'window',
    hold: action.hold === true,
    rank: action.by?.rank ?? null,
    defaults: forHost(host.kind !== 'desktop' && action.tabKeys !== undefined ? action.tabKeys : action.keys, host.apple).flatMap((key) => {
      const chord = hostChordOf(typeof key === 'string' ? key : key.keys, host.apple);
      return chord === null ? [] : [{ chord, global: typeof key !== 'string' }];
    }),
  }));

export class ActionCatalog extends Service<{ readonly listed: readonly Listed[] }>()('ActionCatalog', { tier: 'app' }) {}

export const Actions = Point.define<ActionSet>()('Actions', {
  tier: 'app',
  key: (set) => set.id,
  claims: (set) => (typeof set.actions === 'function' ? [] : set.actions.map((action) => `Action "${action.id}"`)),
});
