import type { DesktopSwipe as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopSwipe extends Service<Bridge>()('DesktopSwipe', { tier: 'app' }) {}
