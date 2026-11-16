// npm run layout: writes art/layout.json for the Blender scripts from src/world/layout.ts.
import { writeFileSync } from 'node:fs';
import { layoutJson } from './world/layout.ts';

writeFileSync('art/layout.json', `${JSON.stringify(layoutJson(), null, 2)}\n`);
console.log('Wrote art/layout.json');
