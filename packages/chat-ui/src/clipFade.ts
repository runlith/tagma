let observer: ResizeObserver | null = null;

function measure(element: Element): void {
  element.toggleAttribute('data-clipped', element.scrollWidth > element.clientWidth);
}

export function clampFade(report: (clipped: boolean) => void): (element: HTMLElement) => () => void {
  return (element) => {
    const measure = () => {
      const clipped = element.scrollHeight > element.clientHeight;
      element.toggleAttribute('data-clipped', clipped);
      report(clipped);
    };
    measure();
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    sized?.observe(element);
    const content = element.firstElementChild;
    if (content !== null) sized?.observe(content);
    return () => {
      sized?.disconnect();
      element.removeAttribute('data-clipped');
    };
  };
}

export function clipFade(element: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') {
    measure(element);
    return () => undefined;
  }
  observer ??= new ResizeObserver((entries) => {
    const clipped = entries.map((entry) => entry.target.scrollWidth > entry.target.clientWidth);
    entries.forEach((entry, index) => entry.target.toggleAttribute('data-clipped', clipped[index]));
  });
  const sized = observer;
  sized.observe(element);
  const changes =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          sized.unobserve(element);
          sized.observe(element);
        });
  changes?.observe(element, { childList: true, characterData: true, subtree: true });
  return () => {
    observer?.unobserve(element);
    changes?.disconnect();
  };
}
