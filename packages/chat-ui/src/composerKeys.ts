export type ComposerPress = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
};

export type ComposerState = {
  readonly canSend: boolean;
  readonly running: boolean;
  readonly menuOpen: boolean;
  readonly menuQueues: boolean;
  readonly cyclesMode: boolean;
  readonly caretAtStart: boolean;
  readonly caretAtEnd: boolean;
  readonly browsing: boolean;
  readonly hasHistory: boolean;
  readonly empty?: boolean;
  readonly rewinds?: boolean;
  readonly touch?: boolean;
  readonly waiting?: boolean;
};

export type ComposerIntent =
  | 'send'
  | 'queue'
  | 'newline'
  | 'cycle-mode'
  | 'ignore'
  | 'none'
  | 'menu-next'
  | 'menu-previous'
  | 'menu-pick'
  | 'menu-queue'
  | 'menu-back'
  | 'history-previous'
  | 'history-next'
  | 'history-leave'
  | 'edit-last'
  | 'take-waiting';

export type RewindEscapeState = {
  readonly rewinds: boolean;
  readonly empty: boolean;
  readonly browsing: boolean;
  readonly armed: boolean;
};

export function rewindEscape(state: RewindEscapeState): 'arm' | 'pick' | 'none' {
  if (!state.rewinds || !state.empty || state.browsing) return 'none';
  return state.armed ? 'pick' : 'arm';
}

export function composerIntent(press: ComposerPress, state: ComposerState): ComposerIntent {
  if (press.isComposing) return 'none';
  if (state.menuOpen) {
    if (press.key === 'Escape') return 'menu-back';
    if (press.key === 'Enter' && press.shiftKey) return 'newline';
    if (state.running && state.menuQueues && !press.shiftKey) {
      if (press.key === 'Tab' && !press.metaKey && !press.ctrlKey) return 'menu-queue';
      if (press.key === 'Enter' && (press.metaKey || press.ctrlKey)) return 'menu-queue';
    }
    if (press.metaKey || press.ctrlKey || press.shiftKey) return 'none';
    if (press.key === 'ArrowDown') return 'menu-next';
    if (press.key === 'ArrowUp') return 'menu-previous';
    if (press.key === 'Enter' || press.key === 'Tab') return 'menu-pick';
    return 'none';
  }
  const rewinding = state.rewinds === true && state.empty === true && !state.running && !state.browsing;
  if (press.key === 'ArrowUp' || press.key === 'ArrowDown') {
    const alone = !press.shiftKey && !press.metaKey && !press.ctrlKey;
    if (press.key === 'ArrowUp' && press.altKey && alone && state.empty === true && state.waiting === true) return 'take-waiting';
    if (press.shiftKey || press.metaKey || press.ctrlKey || press.altKey) return 'none';
    if (press.key === 'ArrowUp' && rewinding) return 'edit-last';
    if (!state.hasHistory) return 'none';
    if (press.key === 'ArrowUp') return state.caretAtStart ? 'history-previous' : 'none';
    return state.browsing && state.caretAtEnd ? 'history-next' : 'none';
  }
  if (press.key === 'Escape') return state.browsing ? 'history-leave' : 'none';
  if (press.key === 'Tab') {
    if (press.shiftKey) return state.cyclesMode ? 'cycle-mode' : 'none';
    if (!state.canSend) return 'ignore';
    return state.running ? 'queue' : 'send';
  }
  if (press.key !== 'Enter' || press.isComposing) return 'none';
  if (press.shiftKey) return 'newline';
  if (state.touch === true && !press.metaKey && !press.ctrlKey) return 'newline';
  if (!state.canSend) return 'none';
  if (press.metaKey || press.ctrlKey) return state.running ? 'queue' : 'send';
  return 'send';
}
