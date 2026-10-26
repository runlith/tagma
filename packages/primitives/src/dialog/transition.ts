import type { DialogResolvedMotion, EasingFunction } from '../types.js';

const linear: EasingFunction = (t) => t;

export function dialogContentTransition(
  node: Element,
  params: DialogResolvedMotion['content'],
): { duration: number; easing: EasingFunction; css: (t: number) => string } {
  const computed = getComputedStyle(node);
  const baseTransform = computed.transform;
  const hasBaseTransform = baseTransform !== 'none';
  const easing = params.easing ?? linear;

  const inline = params.startInlinePercent;
  const startXPercent = inline === undefined ? params.startXPercent : computed.direction === 'rtl' ? -inline : inline;

  return {
    duration: params.durationMs,
    easing,
    css: (t) => {
      const opacity = params.startOpacity + (1 - params.startOpacity) * t;

      if (params.variant === 'sheet') {
        const translateXPercent = (1 - t) * startXPercent;
        const translateYPercent = (1 - t) * params.startYPercent;
        const transform = hasBaseTransform
          ? `${baseTransform} translate3d(${translateXPercent}%, ${translateYPercent}%, 0)`
          : `translate3d(${translateXPercent}%, ${translateYPercent}%, 0)`;
        return `opacity: ${opacity}; transform: ${transform};`;
      }

      const scale = params.startScale + (1 - params.startScale) * t;
      const transform = hasBaseTransform ? `${baseTransform} scale(${scale})` : `scale(${scale})`;
      return `opacity: ${opacity}; transform: ${transform};`;
    },
  };
}
