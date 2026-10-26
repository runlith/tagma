const OVERLAY_ROOT_ATTR = 'data-runlith-overlay-root';

export function getOverlayRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const existing = document.querySelector<HTMLElement>(`[${OVERLAY_ROOT_ATTR}]`);
  if (existing) return existing;

  const root = document.createElement('div');
  root.setAttribute(OVERLAY_ROOT_ATTR, 'true');
  document.body.appendChild(root);
  return root;
}
