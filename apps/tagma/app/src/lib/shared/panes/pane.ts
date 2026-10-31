import { Data } from 'effect';
import type { Component } from 'svelte';
import type { Resolver } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';
import type { Holder } from './holder.js';

export type PaneContent = { readonly kind: string; readonly id: string | null };

export type SidePane = PaneContent & { readonly key: string; readonly agent?: true };

export type PaneView = Component<{ pane: SidePane; close: () => void }>;

export type PaneTitle = Component<{ pane: SidePane }>;

export type PaneStands = (app: Resolver, id: string | null, holder: Holder) => boolean | null;

export type PaneClose = (app: Resolver, id: string | null) => boolean;

export type PaneAdmits = (id: string | null, holder: Holder) => boolean;

export type PaneOffer = { readonly order: number; readonly view: Component };

export type PaneHold = Component<{ pane: SidePane }>;

export type PaneKind = {
  readonly kind: string;
  readonly formerly?: string;
  readonly noun: string;
  readonly view: () => Promise<{ readonly default: PaneView }>;
  readonly title: PaneTitle;
  readonly portable?: true;
  readonly admits?: PaneAdmits;
  readonly stands?: PaneStands;
  readonly close?: PaneClose;
  readonly keep?: true;
  readonly hold?: PaneHold;
  readonly moves?: true;
  readonly offer?: PaneOffer;
};

export type PaneRefusal = 'undeclared' | 'inadmissible' | 'nowhere';

export type PaneOpening =
  | { readonly kind: 'opened' | 'revealed'; readonly key: string }
  | { readonly kind: 'refused'; readonly reason: PaneRefusal };

export class PaneUndeclared extends Data.TaggedError('PaneUndeclared')<{
  readonly kind: string;
  readonly message: string;
}> {}

export const Panes = Point.define<PaneKind>()('Panes', {
  tier: 'app',
  key: (declared) => declared.kind,
  claims: (declared) => [`Pane kind "${declared.kind}"`, ...(declared.formerly === undefined ? [] : [`Pane kind "${declared.formerly}"`])],
});

export type ProjectScoped = { readonly project: number; readonly rest: string };

export const projectScopedId = (project: number, rest: string): string => `${project}:${rest}`;

export function projectScopedOf(id: string | null): ProjectScoped | null {
  const at = id?.indexOf(':') ?? -1;
  if (id === null || at < 1) return null;
  const project = Number(id.slice(0, at));
  return Number.isInteger(project) && project > 0 ? { project, rest: id.slice(at + 1) } : null;
}

export const sameContent = (one: PaneContent, two: PaneContent): boolean => one.kind === two.kind && one.id === two.id;
