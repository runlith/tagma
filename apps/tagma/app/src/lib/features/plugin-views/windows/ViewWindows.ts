import { Service } from '@runlith/layer/key';

export type WindowAddress = {
  readonly projectId: number;
  readonly project: string;
  readonly plugin: string;
  readonly view: string;
  readonly title: string;
};

export interface WindowPort {
  open(address: WindowAddress): void;
}

const VIEW_WINDOW_ROUTE = '/_desktop/view/';

export class ViewWindows extends Service<WindowPort>()('ViewWindows', { tier: 'app' }) {}

export const windowKey = (address: WindowAddress): string => `${address.projectId}/${address.plugin}/${address.view}`;

export const windowPath = ({ project, plugin, view }: WindowAddress): string =>
  `${VIEW_WINDOW_ROUTE}${encodeURIComponent(project)}/${encodeURIComponent(plugin)}/${encodeURIComponent(view)}`;
