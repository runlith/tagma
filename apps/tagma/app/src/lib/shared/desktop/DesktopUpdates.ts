import type { DesktopUpdates as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopUpdates extends Service<Bridge>()('DesktopUpdates', { tier: 'app' }) {}
