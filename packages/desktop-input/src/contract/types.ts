export type DesktopModifier = 'command' | 'option' | 'control' | 'shift' | 'fn';

export type ChordModifier = 'command' | 'option' | 'control' | 'shift';

export interface DesktopAccessibilityState {
  readonly trusted: boolean;
  readonly tapActive: boolean;
}

export type HoldBinding =
  | { readonly kind: 'modifier'; readonly keyCode: number; readonly modifier: DesktopModifier }
  | { readonly kind: 'key'; readonly keyCode: number; readonly modifiers: readonly ChordModifier[] };

export type HoldTransition = 'start' | 'end' | 'cancel';

export interface DesktopHold {
  readonly transition: HoldTransition;
  readonly shift: boolean;
}

export type PasteOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export type DesktopInputIssueCode = 'unsupported-platform' | 'native-binary-missing' | 'spawn-failed';

export interface DesktopInputIssue {
  readonly code: DesktopInputIssueCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string>>;
}

export type DesktopInputStartResult =
  | { readonly status: 'started'; readonly accessibility: DesktopAccessibilityState }
  | { readonly status: 'unsupported'; readonly issue: DesktopInputIssue };

export interface DesktopInputHost {
  start(): Promise<DesktopInputStartResult>;
  readonly accessibility: DesktopAccessibilityState;
  bind(binding: HoldBinding | null): void;
  swallow(on: boolean): void;
  watchEscape(on: boolean): void;
  onHold(listener: (hold: DesktopHold) => void): () => void;
  onEscape(listener: () => void): () => void;
  onAccessibilityChange(listener: (state: DesktopAccessibilityState) => void): () => void;
  onLost(listener: (reason: string) => void): () => void;
  paste(text: string, options?: { readonly restore?: boolean }): Promise<PasteOutcome>;
  promptAccessibility(): void;
  recheckAccessibility(): void;
  dispose(): Promise<void>;
}
