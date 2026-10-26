import { Layer } from '../../Layer.js';
import { Service } from '../../key.js';
import { Scope } from '../../Scope.js';

export class Boot extends Service<Boot>()('Boot', { tier: 'app' }) {
  data: { readonly feature: boolean };

  constructor(feature: boolean) {
    super();
    this.data = $state({ feature });
  }
}

export const trace: string[] = [];

export const chunkLoads = { count: 0 };

export class Vendor extends Service<Vendor>()('Vendor', { tier: 'app', eager: true }) {
  static *make() {
    const scope = yield* Scope;
    return new Vendor(scope);
  }

  constructor(scope: Scope) {
    super();
    trace.push('start');
    scope.defer(() => void trace.push('stop'));
  }

  report(): string {
    return 'reported';
  }
}

export const VendorLayer = Layer.mergeAll(Vendor);
