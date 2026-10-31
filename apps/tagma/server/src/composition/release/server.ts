import { serve } from '../server.js';
import { RELEASE } from './build.js';
import { PARTS } from './parts.js';

await serve(RELEASE, PARTS);
