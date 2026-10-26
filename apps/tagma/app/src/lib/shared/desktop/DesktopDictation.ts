import type { DesktopDictation as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopDictation extends Service<Bridge>()('DesktopDictation', { tier: 'app' }) {}
