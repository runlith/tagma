import { Context } from 'effect';

export class ManagedPlace extends Context.Service<
  ManagedPlace,
  {
    readonly profiles: string;
    readonly builds: string;
    readonly downloads: string;
  }
>()('tagma/managed-browser/ManagedPlace') {}
