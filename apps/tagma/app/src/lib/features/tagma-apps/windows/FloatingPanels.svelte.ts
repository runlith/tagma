import { Service } from '@runlith/layer/key';
import { type WindowAddress, type WindowPort, windowKey } from './ViewWindows.js';

export type OpenPanel = { readonly address: WindowAddress; readonly raised: number };

export class FloatingPanels extends Service<FloatingPanels>()('FloatingPanels', { tier: 'app' }) implements WindowPort {
  static *make() {
    return new FloatingPanels();
  }

  panels = $state.raw<readonly OpenPanel[]>([]);

  private clock = 0;

  open(address: WindowAddress): void {
    const key = windowKey(address);
    this.panels = this.panels.some((panel) => windowKey(panel.address) === key)
      ? this.panels.map((panel) => (windowKey(panel.address) === key ? { address, raised: ++this.clock } : panel))
      : [...this.panels, { address, raised: ++this.clock }];
  }

  raise(address: WindowAddress): void {
    const key = windowKey(address);
    const top = Math.max(...this.panels.map((panel) => panel.raised));
    if (this.panels.some((panel) => windowKey(panel.address) === key && panel.raised === top)) return;
    this.open(address);
  }

  close(address: WindowAddress): void {
    const key = windowKey(address);
    this.panels = this.panels.filter((panel) => windowKey(panel.address) !== key);
  }
}
