export type ModelPanel = {
  readonly mode: 'model' | 'compact';
  readonly query: string;
  readonly opening: number;
};

export class ModelPanelState {
  current = $state.raw<ModelPanel | null>(null);
  private openings = 0;

  open(mode: ModelPanel['mode'], query = ''): void {
    this.openings += 1;
    this.current = { mode, query, opening: this.openings };
  }

  close(): void {
    this.current = null;
  }
}
