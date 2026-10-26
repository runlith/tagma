import { Context } from 'effect';
import type { Channel } from '../wire/channel.js';

export class InstalledChannel extends Context.Service<InstalledChannel, Channel>()('tagma/installation/InstalledChannel') {}
