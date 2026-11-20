// npm run pack: compresses the models in art/export with gltfpack (meshopt), in place, so the page
// downloads about a fifth of the bytes (web/main.ts sets the meshopt decoder on its GLTFLoader).
// `npm run art` runs it after Blender. A model that is already packed is left alone, so running it
// twice is safe. GLTFPACK=/path/to/gltfpack/cli.js uses another copy of the tool.
//
//   -cc        meshopt compression, the stronger setting
//   -kn -km    keep named nodes and materials: the page finds BodyPivot, HeadPivot, Ear.L, Foot.*,
//              Glow.burrow, Flag.letterbox, Villager.* and materials like Fur, Eye, Shine, Water by name
//   -ke        keep extras
//   -kv        keep every vertex attribute, used or not: web/fuzz.ts reads each vertex's fur length
//              from TEXCOORD_0 on meshes that have no texture, which gltfpack would otherwise drop
//   -vpf -vtf  positions and UVs stay floats: no quantization offsets on the named nodes the page
//              moves, and the fur lengths stay exact
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MODELS = ['khina', 'visitor', 'villagers', 'train', 'village'];
const FLAGS = ['-cc', '-kn', '-km', '-ke', '-kv', '-vpf', '-vtf'];
const cli = process.env.GLTFPACK ?? fileURLToPath(import.meta.resolve('gltfpack/cli.js'));

/** Whether a .glb already uses meshopt compression (read from its JSON chunk). */
function isPacked(file: string): boolean {
  const buf = readFileSync(file);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8')) as { extensionsUsed?: string[] };
  return (json.extensionsUsed ?? []).includes('EXT_meshopt_compression');
}

const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
for (const m of MODELS) {
  const file = `art/export/${m}.glb`;
  if (isPacked(file)) {
    console.log(`${file}: already packed (${mb(statSync(file).size)})`);
    continue;
  }
  const before = statSync(file).size;
  const tmp = `art/export/${m}.packing.glb`;
  try {
    execFileSync(process.execPath, [cli, '-i', file, '-o', tmp, ...FLAGS], { stdio: 'inherit' });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
  console.log(`${file}: ${mb(before)} -> ${mb(statSync(file).size)}`);
}
