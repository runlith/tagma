import { serve } from '../server.js';
import { DEVELOPER } from './build.js';
import { PARTS } from './parts.js';

await serve(DEVELOPER, PARTS);
