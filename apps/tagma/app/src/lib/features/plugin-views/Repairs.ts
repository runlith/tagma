import { Service } from '@runlith/layer/key';

interface RepairPort {
  fix(projectId: number, request: string): Promise<void>;
}

export class ViewRepairs extends Service<RepairPort>()('ViewRepairs', { tier: 'app' }) {}

export const repairRequest = (plugin: string, view: string, problem: string): string =>
  `The view ${view} of the plugin ${plugin} does not work in Tagma: ${problem}\n\nFix it in the plugin's sources, build it again with tagma-plugin build, and check that the view prepares.`;
