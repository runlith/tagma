import type { Resolver } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';
import type { Component } from 'svelte';

export type LinkFrom = {
  readonly thread?: string | undefined;
  readonly project?: number | undefined;
  readonly folder?: string | undefined;
  readonly quiet?: boolean | undefined;
};

export type Link<T = unknown> = { readonly kind: string; readonly target: T; readonly from?: LinkFrom | undefined };

export type LinkHow = 'beside' | 'full';

export type LinkIcon = Component<{ class?: string }>;

export type LinkWords<T> = string | ((app: Resolver, link: Link<T>) => string);

export type LinkPlace<T> = {
  readonly words: LinkWords<T>;
  readonly icon: LinkIcon;
  readonly open: (app: Resolver, link: Link<T>) => void | Promise<void>;
};

export type LinkAct = {
  readonly id: string;
  readonly words: string;
  readonly icon: LinkIcon;
  readonly run: () => void | Promise<void>;
};

export type LinkGroup = 'places' | 'copies';

export type LinkItems<T> = {
  readonly kind: string;
  readonly order: number;
  readonly group: LinkGroup;
  readonly acts: (app: Resolver, link: Link<T>) => readonly LinkAct[];
};

export type LinkTab<T> = {
  readonly kind: string;
  readonly link: (app: Resolver, id: string | null) => Link<T> | null;
};

export type LinkKind<T> = {
  readonly kind: string;
  readonly what: (app: Resolver, link: Link<T>) => string;
  readonly beside?: LinkPlace<T> | undefined;
  readonly full: LinkPlace<T>;
  readonly anchor?: (app: Resolver, href: string) => Link<T> | null;
  readonly route?: (app: Resolver, anchor: HTMLAnchorElement) => Link<T> | null;
  readonly tab?: LinkTab<T>;
};

export function linkKinds<const T extends readonly unknown[]>(
  ...kinds: { readonly [I in keyof T]: LinkKind<T[I]> }
): readonly LinkKind<never>[] {
  return kinds as unknown as readonly LinkKind<never>[];
}

export const LinkKinds = Point.define<LinkKind<never>>()('LinkKinds', {
  tier: 'app',
  key: (declared) => declared.kind,
  claims: (declared) => (declared.tab === undefined ? [] : [`The link of tab kind "${declared.tab.kind}"`]),
});

export const LinkMenuItems = Point.define<LinkItems<never>>()('LinkMenuItems', {
  tier: 'app',
  key: (items) => `${items.kind} ${items.group} ${items.order}`,
  order: (items) => items.order,
});
