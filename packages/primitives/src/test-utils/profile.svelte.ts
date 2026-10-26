import { Condition } from '@runlith/layer/condition';
import { Service } from '@runlith/layer/key';

export class Profile extends Service<Profile>()('Profile', { tier: 'app' }) {
  static make(): Profile {
    return new Profile();
  }

  isOpen = $state(false);
  readonly open = Condition.of(() => this.isOpen);
}
