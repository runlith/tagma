import type { Component } from 'svelte';
import type { Resolver } from '@runlith/layer/key';
import { Service } from '@runlith/layer/key';
import { Point } from '@runlith/layer/Point';

export type StagedItem = { readonly kind: string; readonly key: string; readonly title: string; readonly data: unknown };

export type StagedThread = { readonly id: string; readonly projectId: number };

export type StagedCardProps = { item: StagedItem; remove: () => void };

export interface StagedKind {
  readonly kind: string;
  readonly card: Component<StagedCardProps>;
  file(app: Resolver, item: StagedItem): Promise<File | null>;
  sent?(app: Resolver, item: StagedItem, thread: StagedThread): Promise<void>;
}

export const StagedKinds = Point.define<StagedKind>()('StagedKinds', {
  tier: 'app',
  key: (declared) => declared.kind,
  joins: 'start',
});

export type StagingDraft = {
  readonly canSend: boolean;
  readonly thread: StagedThread | null;
  stage(item: StagedItem): void;
  send(): Promise<boolean>;
};

export type StagingHost = { readonly host: StagingDraft | null };

export class DraftStaging extends Service<StagingHost>()('DraftStaging', { tier: 'app' }) {}
