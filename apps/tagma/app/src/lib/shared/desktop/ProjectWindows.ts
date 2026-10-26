import type { ProjectWindows as Bridge } from '@tagma/desktop/bridge';
import { Service } from '@runlith/layer/key';

export class ProjectWindows extends Service<Bridge>()('ProjectWindows', { tier: 'app' }) {}
