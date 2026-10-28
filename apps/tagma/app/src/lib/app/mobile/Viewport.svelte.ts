const KEYBOARD_PX = 120;
const ZOOMED = 1.01;

export class Viewport {
  watch(shell: HTMLElement): () => void {
    const seen = window.visualViewport;
    let applied = '';
    const measure = (): void => {
      if ((seen?.scale ?? 1) > ZOOMED) return;
      const height = seen?.height ?? window.innerHeight;
      const top = seen?.offsetTop ?? 0;
      const keyboard = document.documentElement.clientHeight - height > KEYBOARD_PX;
      const next = `${height}:${top}:${keyboard}`;
      if (next === applied) return;
      applied = next;
      shell.style.height = `${height}px`;
      shell.style.transform = top > 0 ? `translateY(${top}px)` : '';
      shell.classList.toggle('safe-bottom', !keyboard);
      shell.toggleAttribute('data-keyboard', keyboard);
    };
    measure();
    seen?.addEventListener('resize', measure);
    seen?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      seen?.removeEventListener('resize', measure);
      seen?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }
}
