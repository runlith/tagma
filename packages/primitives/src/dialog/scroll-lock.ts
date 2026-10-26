type LockedStylesSnapshot = {
  body: {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
    overflowY: string;
    paddingRight: string;
  };
  html: {
    overflow: string;
    overflowY: string;
    scrollbarCompensation: string;
  };
};

let held = 0;
let baseline: LockedStylesSnapshot | undefined;
let fixedScrollY: number | undefined;

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  const isAppleDevice = /iP(ad|hone|od)/.test(ua);
  const isIpadOs = navigator.maxTouchPoints > 2 && /Macintosh/.test(ua);

  return isAppleDevice || isIpadOs;
}

function snapshotStyles(): LockedStylesSnapshot {
  const bodyStyle = document.body.style;
  const htmlStyle = document.documentElement.style;

  return {
    body: {
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width,
      overflow: bodyStyle.overflow,
      overflowY: bodyStyle.overflowY,
      paddingRight: bodyStyle.paddingRight,
    },
    html: {
      overflow: htmlStyle.overflow,
      overflowY: htmlStyle.overflowY,
      scrollbarCompensation: htmlStyle.getPropertyValue('--runlith-scrollbar-compensation'),
    },
  };
}

function restoreStyles(snapshot: LockedStylesSnapshot): void {
  const bodyStyle = document.body.style;
  const htmlStyle = document.documentElement.style;

  bodyStyle.position = snapshot.body.position;
  bodyStyle.top = snapshot.body.top;
  bodyStyle.left = snapshot.body.left;
  bodyStyle.right = snapshot.body.right;
  bodyStyle.width = snapshot.body.width;
  bodyStyle.overflow = snapshot.body.overflow;
  bodyStyle.overflowY = snapshot.body.overflowY;
  bodyStyle.paddingRight = snapshot.body.paddingRight;

  htmlStyle.overflow = snapshot.html.overflow;
  htmlStyle.overflowY = snapshot.html.overflowY;
  if (snapshot.html.scrollbarCompensation) {
    htmlStyle.setProperty('--runlith-scrollbar-compensation', snapshot.html.scrollbarCompensation);
  } else {
    htmlStyle.removeProperty('--runlith-scrollbar-compensation');
  }
}

function applyLockStyles(): void {
  const bodyStyle = document.body.style;
  const htmlStyle = document.documentElement.style;
  const scrollbarWidth = Math.max(0, innerWidth - document.documentElement.clientWidth);

  htmlStyle.overflow = 'hidden';
  htmlStyle.overflowY = 'hidden';
  htmlStyle.setProperty('--runlith-scrollbar-compensation', `${scrollbarWidth}px`);
  if (scrollbarWidth > 0) bodyStyle.paddingRight = `${scrollbarWidth}px`;
  if (!isIosDevice()) return;

  fixedScrollY = scrollY;
  bodyStyle.position = 'fixed';
  bodyStyle.top = `-${fixedScrollY}px`;
  bodyStyle.left = '0';
  bodyStyle.right = '0';
  bodyStyle.width = '100%';
  bodyStyle.overflow = 'hidden';
  bodyStyle.overflowY = 'hidden';
}

export function lockDialogScroll(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  held += 1;
  if (held === 1) {
    baseline = snapshotStyles();
    fixedScrollY = undefined;
    applyLockStyles();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    held -= 1;
    if (held > 0) return;

    const scrollYToRestore = fixedScrollY;
    if (baseline) restoreStyles(baseline);
    baseline = undefined;
    fixedScrollY = undefined;
    if (typeof scrollYToRestore === 'number') scrollTo(0, scrollYToRestore);
  };
}
