export class HeldOrder<T> {
  private held = $state.raw<T | null>(null);
  private pointed = false;
  private menus = 0;

  constructor(private readonly live: () => T) {}

  get shown(): T {
    return this.held ?? this.live();
  }

  enter(): void {
    this.pointed = true;
    this.hold();
  }

  leave(): void {
    this.pointed = false;
    this.release();
  }

  menu(open: boolean): void {
    this.menus += open ? 1 : -1;
    if (open) this.hold();
    else this.release();
  }

  private hold(): void {
    this.held ??= this.live();
  }

  private release(): void {
    if (!this.pointed && this.menus === 0) this.held = null;
  }
}
