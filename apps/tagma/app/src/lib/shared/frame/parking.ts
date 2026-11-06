type Mover = Element & { moveBefore?: (node: Node, child: Node | null) => void };

let lot: Mover | null = null;

const lotOf = (): Mover => {
  if (lot?.isConnected === true) return lot;
  const made: Mover = document.createElement('div');
  made.setAttribute('aria-hidden', 'true');
  made.setAttribute('style', 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none');
  document.body.append(made);
  lot = made;
  return made;
};

export function park(frame: HTMLIFrameElement, closing: Promise<void>): Promise<void> | null {
  if (typeof (Element.prototype as Mover).moveBefore !== 'function') return null;
  lotOf().moveBefore!(frame, null);
  return closing.then(() => frame.remove());
}
