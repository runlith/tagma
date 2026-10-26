import type { DesktopTabs as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopTabs extends Service<Bridge>()('DesktopTabs', { tier: 'app' }) {}
