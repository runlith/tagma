import { Scope } from '../../Scope.js';
import { Screen } from '../screen.svelte.js';

export class Pane extends Screen<Pane, Record<string, never>>()('Pane', { tier: 'room' }) {
  static override *make() {
    return new Pane(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
  }
}
