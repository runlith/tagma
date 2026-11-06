import type { DesktopKeys as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopKeys extends Service<Bridge>()('DesktopKeys', { tier: 'app' }) {}
