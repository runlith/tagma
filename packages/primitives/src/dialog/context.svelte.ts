import { getContext, setContext } from 'svelte';

import type { OverlayLayer } from '../layer.svelte.js';
import type { DialogResolvedMotion, InteractOutsideBehavior } from '../types.js';

export type DialogRootContext = {
  get open(): boolean;
  get present(): boolean;
  readonly layer: OverlayLayer;
  setOpen: (open: boolean) => void;

  get contentEl(): HTMLElement | null;
  setContentEl: (el: HTMLElement | null) => void;

  get titleId(): string | undefined;
  setTitleId: (id: string | undefined) => void;

  get descriptionId(): string | undefined;
  setDescriptionId: (id: string | undefined) => void;

  get interactOutsideBehavior(): InteractOutsideBehavior;
  get motion(): DialogResolvedMotion;
};

export const DIALOG_CONTEXT_KEY = Symbol.for('@runlith/primitives/dialog');

export function provideDialogRootContext(ctx: DialogRootContext): DialogRootContext {
  return setContext(DIALOG_CONTEXT_KEY, ctx);
}

export function useDialogRootContext(): DialogRootContext {
  const ctx = getContext<DialogRootContext>(DIALOG_CONTEXT_KEY);
  if (!ctx) {
    throw new Error('useDialogRootContext must be used within <Dialog.Root>');
  }
  return ctx;
}
