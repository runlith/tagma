import type { DesktopSurface as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopSurface extends Service<Bridge>()('DesktopSurface', { tier: 'app' }) {}
