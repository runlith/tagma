import type { DesktopFolders as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class DesktopFolders extends Service<Bridge>()('DesktopFolders', { tier: 'app' }) {}
