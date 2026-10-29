export function deliver(update: () => void): void {
  if ($effect.tracking()) queueMicrotask(update);
  else update();
}
