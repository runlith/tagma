export function messageElementTop(input: { root: HTMLElement; target: HTMLElement }): number {
  const targetRect = input.target.getBoundingClientRect();
  const rootRect = input.root.getBoundingClientRect();
  return Math.max(0, targetRect.top - rootRect.top + input.root.scrollTop - 12);
}

export function scrollMessageIntoView(input: { behavior: ScrollBehavior; root: HTMLElement; target: HTMLElement }): void {
  input.root.scrollTo({
    behavior: input.behavior,
    top: messageElementTop(input),
  });
}
