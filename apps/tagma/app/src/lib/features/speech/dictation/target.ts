export type Unplaced = string;

export interface Target {
  begin(): boolean;
  show(stable: string, guess: string): boolean;
  commit(text: string, send: boolean): Promise<Unplaced>;
  revert(): boolean;
  leave(): void;
}
