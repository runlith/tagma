import { Service } from '@runlith/layer/key';

export type PickDocument = { readonly id: string; readonly title: string; readonly text: string };

export type PickDraft = {
  stageDocument(document: PickDocument): void;
  attach(files: readonly File[]): Promise<{ readonly notice?: string }>;
};

export type PickHost = { readonly host: PickDraft | null };

export class PickScreen extends Service<PickHost>()('BrowserPickScreen', { tier: 'app' }) {}
