import { Service } from '@runlith/layer/key';

export class GraphSelection extends Service<GraphSelection>()('GraphSelection', { tier: 'graph' }) {
  static *make() {
    return new GraphSelection();
  }

  name = $state<string | null>(null);
}
