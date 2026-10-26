export type FilesCommand =
  | { readonly kind: 'column'; readonly view: 'files' | 'search' | 'git' }
  | { readonly kind: 'close' }
  | { readonly kind: 'reopen' }
  | { readonly kind: 'step'; readonly direction: 1 | -1 }
  | { readonly kind: 'nth'; readonly place: number }
  | { readonly kind: 'preview' }
  | { readonly kind: 'keep' };

export type Stroke = {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

const COLUMNS = { KeyF: 'search', KeyE: 'files', KeyG: 'git' } as const;

export function commandOf(stroke: Stroke): FilesCommand | null {
  const mod = stroke.metaKey || stroke.ctrlKey;
  if (stroke.altKey) return null;
  if (stroke.ctrlKey && !stroke.metaKey && stroke.code === 'Tab') return { kind: 'step', direction: stroke.shiftKey ? -1 : 1 };
  if (stroke.ctrlKey && !stroke.metaKey && !stroke.shiftKey && /^Digit[1-9]$/.test(stroke.code)) {
    return { kind: 'nth', place: Number(stroke.code.slice(5)) };
  }
  if (!mod) return null;
  if (stroke.shiftKey) {
    if (stroke.code in COLUMNS) return { kind: 'column', view: COLUMNS[stroke.code as keyof typeof COLUMNS] };
    if (stroke.code === 'KeyT') return { kind: 'reopen' };
    if (stroke.code === 'KeyV') return { kind: 'preview' };
    if (stroke.code === 'BracketRight') return { kind: 'step', direction: 1 };
    if (stroke.code === 'BracketLeft') return { kind: 'step', direction: -1 };
    return null;
  }
  if (stroke.code === 'KeyS') return { kind: 'keep' };
  return stroke.code === 'KeyW' ? { kind: 'close' } : null;
}

const FLOATING = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const TYPING = 'input, textarea, select, [contenteditable], [role="textbox"]';

export const underOverlay = (target: EventTarget | null): boolean => target instanceof Element && target.closest(FLOATING) !== null;

export const typingIn = (target: EventTarget | null): boolean =>
  target instanceof Element && !target.classList.contains('cm-content') && target.closest(TYPING) !== null;
