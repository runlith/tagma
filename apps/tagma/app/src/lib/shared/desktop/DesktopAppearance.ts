import type { DesktopAppearance as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopAppearance extends Service<Bridge>()('DesktopAppearance', { tier: 'app' }) {}
