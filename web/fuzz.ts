// Felt fuzz: every mesh whose material name starts with "Fur" gets a stack of shells, each a
// copy of the mesh pushed out a little along its normals, drawing only where a fibre passes
// through. Together the shells read as the soft, hairy surface of a needle-felted toy.
// The per-vertex fuzz length comes from the first UV channel's U (art/khina.py writes it; it is
// 0 next to the eyes and the mouth). Meshes without UVs get full-length fuzz.

import * as THREE from 'three';

const LENGTH: Record<string, number> = { Fur: 0.024, 'Fur.Ear': 0.012, 'Fur.Nose': 0.007, 'Fur.Feet': 0.012, 'Fur.Pink': 0.008, 'Fur.White': 0.02 };

export function addFuzz(root: THREE.Object3D, opts: { layers?: number; density?: number; scale?: number } = {}): void {
  const layers = opts.layers ?? 20;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && (o.material as THREE.Material).name.startsWith('Fur')) meshes.push(o);
  });
  for (const mesh of meshes) {
    const base = mesh.material as THREE.MeshStandardMaterial;
    const len = (LENGTH[base.name] ?? 0.014) * (opts.scale ?? 1);
    const geo = mesh.geometry;
    if (!geo.getAttribute('fuzzLen')) {
      const n = geo.getAttribute('position').count;
      const uv = geo.getAttribute('uv');
      const arr = new Float32Array(n);
      for (let i = 0; i < n; i++) arr[i] = uv ? uv.getX(i) : 1;
      geo.setAttribute('fuzzLen', new THREE.BufferAttribute(arr, 1));
    }
    const mat = base.clone();
    mat.name = `${base.name}.shells`;
    const uniforms = { uLen: { value: len }, uLayers: { value: layers }, uDensity: { value: opts.density ?? 190 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float fuzzLen;
          uniform float uLen;
          uniform float uLayers;
          varying float vShell;
          varying vec3 vFuzzPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vShell = (float(gl_InstanceID) + 1.0) / uLayers;
          float fl = uLen * fuzzLen;
          vFuzzPos = position;
          transformed += normalize(objectNormal) * fl * vShell;
          transformed.y -= fl * vShell * vShell * 0.3;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uDensity;
          varying float vShell;
          varying vec3 vFuzzPos;
          vec3 fzHash(vec3 p) {
            p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
            return fract(sin(p) * 43758.5453123);
          }`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            // Nearest fibre (a jittered point per cell); each fibre has its own length and thins to its tip.
            vec3 q = vFuzzPos * uDensity;
            vec3 ci = floor(q);
            vec3 cf = fract(q);
            float best = 9.0;
            float id = 0.0;
            for (int x = -1; x <= 1; x++)
              for (int y = -1; y <= 1; y++)
                for (int z = -1; z <= 1; z++) {
                  vec3 c = vec3(float(x), float(y), float(z));
                  vec3 h = fzHash(ci + c);
                  float d = length(c + h - cf);
                  if (d < best) { best = d; id = h.x; }
                }
            float fibreLen = 0.45 + 0.55 * id;
            if (vShell > fibreLen) discard;
            if (best > 0.55 * (1.0 - 0.8 * vShell / fibreLen)) discard;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= mix(0.62, 1.08, vShell);`,
        );
    };
    mat.customProgramCacheKey = () => `fuzz-${layers}`;
    const shells = new THREE.InstancedMesh(geo, mat, layers);
    shells.name = `${mesh.name}.fuzz`;
    shells.castShadow = false;
    shells.receiveShadow = true;
    shells.frustumCulled = false;
    mesh.add(shells);
  }
}
