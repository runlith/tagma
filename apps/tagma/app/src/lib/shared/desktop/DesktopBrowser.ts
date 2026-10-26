import type { DesktopBrowser as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopBrowser extends Service<Bridge>()('DesktopBrowser', { tier: 'app' }) {}
