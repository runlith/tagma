import type { Process } from '../hosted/cycle.js';

export type Machine = {
  readonly claude: string;
  readonly version: () => string | null;
  readonly stderr: (text: string) => void;
};

export type Runner = Machine & Process;
