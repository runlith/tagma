import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { KeyClass, Resolver } from '@runlith/layer/key';
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

export type PaletteAction = {
  readonly id: string;
  readonly title: string;
  readonly keywords?: readonly string[];
  readonly order?: number;
  readonly icon?: Component<{ class?: string }>;
  available?(env: ActionEnv): boolean;
  disabled?(env: ActionEnv): boolean;
  note?(env: ActionEnv): string | null;
  run(env: ActionEnv): void | Promise<void>;
};

export type PaletteActionList = readonly PaletteAction[] | ((app: Resolver) => readonly PaletteAction[]);

export type ActionSet = { readonly id: string; readonly actions: PaletteActionList };

export const PaletteActions = Point.define<ActionSet>()('PaletteActions', { tier: 'app', key: (set) => set.id });
