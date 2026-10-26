import { cycleTab } from './focus.js';
import type { DismissReason, OverlayLayer } from './layer.svelte.js';
import type { OverlayLayers } from './OverlayLayers.svelte.js';

export function listen(stack: OverlayLayers): () => void {
  let tap: readonly OverlayLayer[] | undefined;

  const pass = (among: readonly OverlayLayer[], target: Node, reason: DismissReason): void => {
    const held = stack.holding(target);
    for (let at = among.length - 1; at >= 0; at -= 1) {
      const layer = among[at]!;
      if (!layer.isOpen) continue;
      if (held.has(layer) || layer.modal) return;
      if (layer.dismissable) layer.dismiss(reason);
    }
  };

  const press = (event: PointerEvent): void => {
    tap = undefined;
    if (!(event.target instanceof Node)) return;
    if (event.pointerType === 'touch') tap = stack.layers();
    else pass(stack.layers(), event.target, 'outside');
  };

  const cancel = (): void => {
    tap = undefined;
  };

  const click = (event: MouseEvent): void => {
    const among = tap;
    tap = undefined;
    if (among === undefined || event.detail === 0 || !(event.target instanceof Node)) return;
    pass(among, event.target, 'outside');
  };

  const key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
    const top = stack.top();
    if (top === undefined) return;
    event.preventDefault();
    top.dismiss('escape');
  };

  const tab = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const from = document.activeElement ?? event.target;
    const held = from instanceof Node ? stack.holding(from) : new Set<OverlayLayer>();
    const keeper = stack.layers().findLast((layer) => layer.modal || (layer.traps && held.has(layer)));
    if (keeper !== undefined) cycleTab(event, [...keeper.elements, ...keeper.descendantElements()]);
  };

  const focus = (event: FocusEvent): void => {
    if (!stack.restoring && event.target instanceof Node) pass(stack.layers(), event.target, 'focus');
  };

  const blur = (event: FocusEvent): void => {
    const active = document.activeElement;
    if (event.target === window && active instanceof HTMLIFrameElement) pass(stack.layers(), active, 'focus');
  };

  document.addEventListener('pointerdown', press, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key);
  document.addEventListener('keydown', tab);
  document.addEventListener('focusin', focus);
  window.addEventListener('blur', blur);
  return () => {
    document.removeEventListener('pointerdown', press, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key);
    document.removeEventListener('keydown', tab);
    document.removeEventListener('focusin', focus);
    window.removeEventListener('blur', blur);
  };
}
