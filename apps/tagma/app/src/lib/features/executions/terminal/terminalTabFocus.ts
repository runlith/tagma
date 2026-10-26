export type FocusHelper = {
  focus(): void;
  blur(): void;
  readonly isConnected: boolean;
  readonly ownerDocument: { readonly activeElement: unknown; readonly body: unknown };
};

export type FrameDriver = (run: () => void) => void;

export function nextFrame(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export function refreshImeContext(
  helper: FocusHelper,
  options: {
    readonly isMac: boolean;
    readonly schedule?: FrameDriver;
    readonly onRefocusSkipped?: (active: unknown) => void;
  },
): boolean {
  if (!options.isMac || !helper.isConnected) return false;
  helper.blur();
  const schedule = options.schedule ?? nextFrame;
  const document_ = helper.ownerDocument;
  schedule(() => {
    if (!helper.isConnected) {
      options.onRefocusSkipped?.(document_.activeElement);
      return;
    }
    const active = document_.activeElement;
    if (active === (helper as unknown) || active === null || active === document_.body) {
      helper.focus();
      if (document_.activeElement !== (helper as unknown)) options.onRefocusSkipped?.(document_.activeElement);
      return;
    }
    options.onRefocusSkipped?.(active);
  });
  return true;
}

export function focusTabSurface(
  find: () => FocusHelper | null,
  options: {
    readonly frame?: FrameDriver;
    readonly renamingNow: () => boolean;
    readonly isMac: boolean;
    readonly scheduleRefocus?: FrameDriver;
    readonly onRefocusSkipped?: (active: unknown) => void;
  },
): void {
  const frame = options.frame ?? nextFrame;
  frame(() =>
    frame(() => {
      if (options.renamingNow()) return;
      const helper = find();
      if (helper === null) return;
      helper.focus();
      refreshImeContext(helper, {
        isMac: options.isMac,
        schedule: options.scheduleRefocus,
        onRefocusSkipped: options.onRefocusSkipped,
      });
    }),
  );
}
