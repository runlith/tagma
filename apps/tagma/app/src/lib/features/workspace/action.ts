import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import type { Host } from '@runlith/layer/Host';
import { type KeyClass, Service } from '@runlith/layer/key';
import { type Keyed, type Place, WINDOW } from '$lib/app/keys/resolve.js';
import { Point } from '@runlith/layer/Point';
import type { Component } from 'svelte';
import type { Surface } from '$lib/features/workspace/surface.js';

export const TAB_CLOSE = 'tab.close';

export const TAB_REOPEN = 'tab.reopen';

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
  readonly claims?: true;
  readonly by?: ActionOwner;
  available?(env: ActionEnv): boolean;
  listed?(env: ActionEnv): boolean;
  disabled?(env: ActionEnv): boolean;
  note?(env: ActionEnv): string | null;
};

export type Action = Common &
  (
    | { readonly region?: undefined; run?(env: ActionEnv): void | Promise<void> }
    | { readonly region: Place; readonly where: string; readonly run?: undefined }
  );

export type ActionList = readonly Action[] | (() => readonly Action[]);

export type ActionSet = {
  readonly id: string;
  readonly area: string;
  readonly actions: ActionList;
  readonly settled?: () => boolean;
};

export type Listed = { readonly area: string; readonly action: Action };

const forHost = (keys: DefaultKeys | undefined, mac: boolean): readonly DefaultKey[] =>
  keys === undefined ? [] : 'mac' in keys ? (mac ? keys.mac : keys.other) : keys;

export const keyedOf = (actions: readonly Action[], host: Host): readonly Keyed[] =>
  actions.map((action) => ({
    id: action.id,
    place: action.region ?? WINDOW,
    hold: action.hold === true,
    rank: action.by?.rank ?? null,
    defaults: forHost(host.kind !== 'desktop' && action.tabKeys !== undefined ? action.tabKeys : action.keys, host.apple).flatMap((key) => {
      const chord = hostChordOf(typeof key === 'string' ? key : key.keys, host.apple);
      return chord === null ? [] : [{ chord, global: typeof key !== 'string' }];
    }),
  }));

export interface Catalog {
  readonly listed: readonly Listed[];
  readonly settled: boolean;
  titleOf(action: string): string;
}

export class ActionCatalog extends Service<Catalog>()('ActionCatalog', { tier: 'app' }) {}

export const Actions = Point.define<ActionSet>()('Actions', {
  tier: 'app',
  key: (set) => set.id,
  claims: (set) => (typeof set.actions === 'function' ? [] : set.actions.map((action) => `Action "${action.id}"`)),
});
