import { cubicOut } from 'svelte/easing';

import type { DialogMotion, DialogResolvedMotion } from '../types.js';

export const DEFAULT_DIALOG_MOTION: DialogResolvedMotion = {
  overlay: { durationMs: 160, easing: cubicOut },
  content: {
    variant: 'scale',
    durationMs: 180,
    easing: cubicOut,
    startScale: 0.95,
    startOpacity: 0,
    startYpx: 0,
    startXPercent: 0,
    startYPercent: 0,
  },
};

export function resolveDialogMotion(motion?: DialogMotion): DialogResolvedMotion {
  const overlay = motion?.overlay;
  const content = motion?.content;
  const variant = content?.variant ?? DEFAULT_DIALOG_MOTION.content.variant;
  const sheetY = content?.startInlinePercent === undefined ? 100 : 0;

  return {
    overlay: {
      durationMs: overlay?.durationMs ?? DEFAULT_DIALOG_MOTION.overlay.durationMs,
      easing: overlay?.easing ?? DEFAULT_DIALOG_MOTION.overlay.easing,
    },
    content: {
      variant,
      durationMs: content?.durationMs ?? (variant === 'sheet' ? 300 : DEFAULT_DIALOG_MOTION.content.durationMs),
      easing: content?.easing ?? DEFAULT_DIALOG_MOTION.content.easing,
      startScale: content?.startScale ?? DEFAULT_DIALOG_MOTION.content.startScale,
      startOpacity: content?.startOpacity ?? (variant === 'sheet' ? 1 : DEFAULT_DIALOG_MOTION.content.startOpacity),
      startYpx: content?.startYpx ?? (variant === 'sheet' ? 0 : DEFAULT_DIALOG_MOTION.content.startYpx),
      startXPercent: content?.startXPercent ?? (variant === 'sheet' ? 0 : DEFAULT_DIALOG_MOTION.content.startXPercent),
      startYPercent: content?.startYPercent ?? (variant === 'sheet' ? sheetY : DEFAULT_DIALOG_MOTION.content.startYPercent),
      startInlinePercent: content?.startInlinePercent,
    },
  };
}
