import { Service } from './key.js';
import { Layer } from './Layer.js';

export type HostKind = 'tab' | 'desktop' | 'mobile';

export type HostOs = 'macos' | 'ios' | 'windows' | 'linux' | 'unknown';

export interface HostInput {
  readonly kind: HostKind;
  readonly os?: HostOs;
  readonly touch?: boolean;
  readonly installed?: boolean;
  readonly framed?: boolean;
}

export interface HostOptions {
  readonly touch?: boolean;
  readonly installed?: boolean;
  readonly framed?: boolean;
}

export class Host extends Service<Host>()('Host', { tier: 'app' }) {
  static of(input: HostInput) {
    return Layer.of(
      Host,
      new Host(input.kind, input.os ?? 'unknown', { touch: input.touch, installed: input.installed, framed: input.framed }),
    );
  }

  static tab() {
    return Host.of({ kind: 'tab' });
  }

  readonly touch: boolean;
  readonly installed: boolean;
  //! The page draws its own window chrome, as a picture of the desktop window.
  readonly framed: boolean;

  constructor(
    readonly kind: HostKind,
    readonly os: HostOs,
    options: HostOptions = {},
  ) {
    super();
    this.touch = options.touch ?? false;
    this.installed = options.installed ?? false;
    this.framed = options.framed ?? false;
  }

  get isDesktop(): boolean {
    return this.kind === 'desktop';
  }

  get apple(): boolean {
    return this.os === 'macos' || this.os === 'ios';
  }
}
