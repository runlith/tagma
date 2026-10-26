/// <reference types="bun" />

import { serve } from './inspecting.js';

declare const self: Worker;

serve(self, 'reach');
