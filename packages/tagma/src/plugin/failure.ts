type BuildStep = 'package' | 'types' | 'definition' | 'bundle' | 'providers' | 'views' | 'check';

export class BuildFailed extends Error {
  constructor(
    readonly step: BuildStep,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'BuildFailed';
  }
}
