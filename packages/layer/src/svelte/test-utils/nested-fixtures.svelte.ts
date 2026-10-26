import { Service } from '../../key.js';
import { Scope } from '../../Scope.js';
import { trace } from './flagged-fixtures.svelte.js';

export class Gate extends Service<Gate>()('Gate', { tier: 'app' }) {
  data: { readonly open: boolean };

  constructor(open: boolean) {
    super();
    this.data = $state({ open });
  }
}

export class UserVendor extends Service<UserVendor>()('UserVendor', { tier: 'user', eager: true }) {
  static *make() {
    const scope = yield* Scope;
    return new UserVendor(scope);
  }

  constructor(scope: Scope) {
    super();
    trace.push('user-start');
    scope.defer(() => void trace.push('user-stop'));
  }
}
