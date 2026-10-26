import { Context } from 'effect';
import type { Installation } from '../../../installation/contract/wire/manifest.js';

export class InstallationLabel extends Context.Service<InstallationLabel, { readonly id: string }>()('tagma/sandbox/InstallationLabel') {}

export class GuestInstallation extends Context.Service<GuestInstallation, { readonly installation: Installation | undefined }>()(
  'tagma/sandbox/GuestInstallation',
) {}
