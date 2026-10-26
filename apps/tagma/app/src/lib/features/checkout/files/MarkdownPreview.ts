import { Service } from '@runlith/layer/key';
import type { Component } from 'svelte';

export type MarkdownProps = { readonly text: string; readonly cacheKey?: string; readonly class?: string };

export interface PreviewPort {
  readonly Markdown: Component<MarkdownProps>;
}

export class MarkdownPreview extends Service<PreviewPort>()('CheckoutMarkdownPreview', { tier: 'app' }) {}
