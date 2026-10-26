import { Service } from '@runlith/layer/key';

export class ContextPanelState extends Service<ContextPanelState>()('ContextPanelState', { tier: 'thread' }) {
  static *make() {
    return new ContextPanelState();
  }

  private opened = $state<readonly string[]>([]);

  isOpen(row: string): boolean {
    return this.opened.includes(row);
  }

  toggle(row: string): void {
    this.opened = this.opened.includes(row) ? this.opened.filter((open) => open !== row) : [...this.opened, row];
  }
}
