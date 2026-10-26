import type { Piece } from '@tagma/server/speech/contract/wire/listening';
import { Service } from '@runlith/layer/key';

export type CallDraft = {
  readonly canSend: boolean;
  readonly thread: { readonly id: string; readonly projectId: number } | null;
  stage(piece: Piece): void;
  send(): Promise<boolean>;
};

export type CallHost = { readonly host: CallDraft | null };

export class CallScreen extends Service<CallHost>()('SpeechCallScreen', { tier: 'app' }) {}
