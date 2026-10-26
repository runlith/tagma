import { getContext, setContext } from 'svelte';

import type { DialogHandle } from './types.js';

export interface DialogHandleContext {
  handle: DialogHandle;
  close: (result?: unknown) => void;
}

export const DIALOG_HANDLE_CONTEXT_KEY = Symbol.for('@runlith/primitives/dialog-handle');

export function provideDialogHandle(context: DialogHandleContext): DialogHandleContext {
  return setContext(DIALOG_HANDLE_CONTEXT_KEY, context);
}

export function useDialogHandle(): DialogHandleContext {
  const ctx = getContext<DialogHandleContext>(DIALOG_HANDLE_CONTEXT_KEY);
  if (!ctx) {
    throw new Error('useDialogHandle must be used within an opened dialog');
  }
  return ctx;
}
