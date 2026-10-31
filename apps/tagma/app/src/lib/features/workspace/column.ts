import type { KeyClass, Resolver } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';
import type { Component } from 'svelte';

export type ColumnState = {
  readonly open: boolean;
  toggle(): void;
};

export type ColumnFrame = () => Promise<{ readonly default: Component }>;

export type ColumnDeclaration = {
  readonly id: string;
  readonly label: string;
  readonly state: KeyClass<string, ColumnState>;
  readonly frame?: ColumnFrame;
  readonly stands?: 'tile';
  readonly search?: boolean;
  readonly routes?: readonly string[];
  readonly room?: (app: Resolver) => boolean;
};

export const Columns = Point.define<ColumnDeclaration>()('Columns', {
  tier: 'app',
  key: (declaration) => declaration.id,
  claims: (declaration) => (declaration.routes ?? []).map((route) => `Column route "${route}"`),
});
