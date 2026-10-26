const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function stepRadio(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
  const by = ARROW_STEP[event.key];
  if (by === undefined) return;
  event.preventDefault();
  const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = options.findIndex((option) => option.getAttribute('aria-checked') === 'true');
  const next = options[((at === -1 ? 0 : at) + by + options.length) % options.length];
  if (next === undefined || (next as HTMLButtonElement).disabled) return;
  next.focus();
  next.click();
}
