export type InteractOutsideBehavior = 'close' | 'ignore';
export type EscapeKeydownBehavior = 'close' | 'ignore';

export type EasingFunction = (t: number) => number;

export type DialogContentMotionVariant = 'scale' | 'sheet';

export type DialogMotion = {
  overlay?: {
    durationMs?: number;
    easing?: EasingFunction;
  };
  content?: {
    variant?: DialogContentMotionVariant;
    durationMs?: number;
    easing?: EasingFunction;
    startScale?: number;
    startOpacity?: number;
    startYpx?: number;
    startXPercent?: number;
    startYPercent?: number;
    startInlinePercent?: number;
  };
};

export type DialogResolvedMotion = {
  overlay: {
    durationMs: number;
    easing?: EasingFunction;
  };
  content: {
    variant: DialogContentMotionVariant;
    durationMs: number;
    easing?: EasingFunction;
    startScale: number;
    startOpacity: number;
    startYpx: number;
    startXPercent: number;
    startYPercent: number;
    startInlinePercent?: number;
  };
};

export interface DialogOpenOptions {
  key?: string;
  interactOutsideBehavior?: InteractOutsideBehavior | (() => InteractOutsideBehavior);
  escapeKeydownBehavior?: EscapeKeydownBehavior | (() => EscapeKeydownBehavior);
  onEscapeIgnored?: () => void;
  motion?: DialogMotion;
  overlayClass?: string;
  scrim?: boolean;
}

export type OverlayHandle<Result = unknown> = {
  presented: Promise<void>;
  closed: Promise<Result>;
  close: (result?: unknown) => void;
};

export interface DialogHandle extends OverlayHandle {
  id: string;
  key?: string;
  update: (props: Record<string, unknown>) => void;
  reopen: () => boolean;
  apply: (options: Omit<DialogOpenOptions, 'key'>) => void;
}

export type LauncherHandle = OverlayHandle & {
  id: string;
  key?: string;
  update: (props: Record<string, unknown>) => void;
};

export type LauncherOpenOptions = {
  key?: string;
};
