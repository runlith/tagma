import { Service } from '../../key.js';
import { Scope } from '../../Scope.js';
import { Visitor, type VisitorInput } from '../../testing.js';

export const log: string[] = [];

export class Profile extends Service<Profile>()('Profile', { tier: 'user' }) {
  static *make() {
    return new Profile(yield* Visitor.Current, yield* Scope);
  }
  constructor(
    readonly session: VisitorInput,
    readonly scope: Scope,
  ) {
    super();
    scope.defer(() => {
      log.push(`profile-closed:${session.id}`);
    });
  }
}

export class Teaser extends Service<Teaser>()('Teaser', { tier: 'guest' }) {
  static *make() {
    return new Teaser(yield* Scope);
  }
  constructor(readonly scope: Scope) {
    super();
    scope.defer(() => {
      log.push('teaser-closed');
    });
  }
}
