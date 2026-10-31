import { serve } from '../server.js';
import { RELEASE } from './build.js';

await serve(RELEASE);
