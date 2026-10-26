const KEYBOARD_PX = 120;

export class Viewport {
  height = $state(0);
  top = $state(0);
  keyboard = $state(false);

  watch(): () => void {
    const seen = window.visualViewport;
    const measure = (): void => {
      const layout = document.documentElement.clientHeight;
      this.height = seen?.height ?? window.innerHeight;
      this.top = seen?.offsetTop ?? 0;
      this.keyboard = layout - this.height > KEYBOARD_PX;
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
