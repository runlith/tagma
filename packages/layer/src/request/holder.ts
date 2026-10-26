import type { RouteData } from '../Router.js';
import type { Definition, MountedApp } from '../App.js';

export interface AppHolder {
  current(definition?: Definition): MountedApp | undefined;
  hold(definition: Definition, open: () => MountedApp): MountedApp;
  release(app: MountedApp): void;
  land(data: RouteData): void;
}

let tab: { readonly definition: Definition; readonly app: MountedApp } | undefined;

const tabHolder: AppHolder = {
  current(definition) {
    if (!tab) return undefined;
    return definition === undefined || tab.definition === definition ? tab.app : undefined;
  },
  hold(definition, open) {
    if (tab?.definition === definition) return tab.app;
    const previous = tab;
    tab = { definition, app: open() };
    void previous?.app.close();
    return tab.app;
  },
  release(app) {
    if (tab?.app === app) tab = undefined;
  },
  land() {},
};

let holder: AppHolder = tabHolder;

export function installAppHolder(next: AppHolder): void {
  holder = next;
}

export function currentApp(definition?: Definition): MountedApp | undefined {
  return holder.current(definition);
}

export function holdApp(definition: Definition, open: () => MountedApp): MountedApp {
  return holder.hold(definition, open);
}

export function releaseApp(app: MountedApp): void {
  holder.release(app);
}

export function landApp(data: RouteData): void {
  holder.land(data);
}
