// How the village looks: tone mapping, a painted sky with sun, clouds and stars, image-based
// light taken from that sky, the sun and its shadows, fog, and the post-processing chain
// (ambient occlusion, bloom for lit windows, a soft vignette). Time of day and weather drive it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export type Weather = 'clear' | 'cloudy' | 'drizzle' | 'rain' | 'fog';

/** Sky, light and fog at an hour of a clear day. */
interface Key {
  h: number;
  top: string;
  horizon: string;
  sun: string;
  sunI: number;
  env: number;
}
const KEYS: Key[] = [
  { h: 0, top: '#08102a', horizon: '#1d2c58', sun: '#9fb6ff', sunI: 0.7, env: 0.42 },
  { h: 4.8, top: '#0a1230', horizon: '#22305c', sun: '#9fb6ff', sunI: 0.65, env: 0.42 },
  { h: 5.9, top: '#34477e', horizon: '#e9a888', sun: '#ffa774', sunI: 0.7, env: 0.45 },
  { h: 7.2, top: '#5d9fe0', horizon: '#f3dcc0', sun: '#ffe2b8', sunI: 2.4, env: 0.85 },
  { h: 9.5, top: '#4f97de', horizon: '#d6ebf5', sun: '#fff2df', sunI: 3.0, env: 1.0 },
  { h: 15.5, top: '#4f97de', horizon: '#dcecf2', sun: '#fff1da', sunI: 3.0, env: 1.0 },
  { h: 17.6, top: '#5b95d4', horizon: '#f2dcbc', sun: '#ffd9a6', sunI: 2.5, env: 0.9 },
  { h: 19.0, top: '#475a98', horizon: '#f6a26f', sun: '#ff9550', sunI: 1.4, env: 0.6 },
  { h: 20.2, top: '#1d2853', horizon: '#6b5687', sun: '#b48ad0', sunI: 0.45, env: 0.32 },
  { h: 21.4, top: '#08102a', horizon: '#1d2c58', sun: '#9fb6ff', sunI: 0.7, env: 0.42 },
  { h: 24, top: '#08102a', horizon: '#1d2c58', sun: '#9fb6ff', sunI: 0.7, env: 0.42 },
];
const WEATHER_LIGHT: Record<Weather, number> = { clear: 1, cloudy: 0.55, fog: 0.5, drizzle: 0.45, rain: 0.32 };
const WEATHER_CLOUDS: Record<Weather, number> = { clear: 0.32, cloudy: 0.8, fog: 0.6, drizzle: 0.9, rain: 1 };
const WEATHER_FOG: Record<Weather, number> = { clear: 0.0042, cloudy: 0.006, fog: 0.04, drizzle: 0.011, rain: 0.016 };

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunVisible;
uniform float uStars;
uniform float uClouds;
uniform float uCloudLight;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.75, h), 0.65));
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * uSunVisible * (pow(sd, 900.0) * 6.0 + pow(sd, 40.0) * 0.35 + pow(sd, 4.0) * 0.12);

  if (uStars > 0.0 && h > 0.0) {
    vec3 p = d * 260.0;
    vec3 c = floor(p);
    float r = hash3(c);
    float star = step(0.9965, r) * smoothstep(0.55, 0.0, length(fract(p) - 0.5));
    float tw = 0.7 + 0.3 * sin(uTime * 2.0 + r * 80.0);
    col += vec3(0.9, 0.95, 1.0) * star * tw * uStars * smoothstep(0.02, 0.25, h) * 1.6;
  }

  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv);
    float cover = smoothstep(1.0 - uClouds * 0.62, 1.12 - uClouds * 0.4, n + 0.18);
    float shade = fbm(uv * 1.7 + 3.0);
    vec3 lit = mix(uHorizon, vec3(1.0), 0.55) * uCloudLight + uSunColor * uSunVisible * pow(sd, 6.0) * 0.4;
    vec3 cloud = mix(lit, lit * 0.62 + uTop * 0.08, smoothstep(0.35, 0.8, shade));
    col = mix(col, cloud, cover * smoothstep(0.0, 0.12, h) * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 }, uWarm: { value: 0.03 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.25, 0.85, length(q * vec2(1.25, 1.0)));
      c.rgb *= v;
      c.rgb += vec3(uWarm, uWarm * 0.45, -uWarm * 0.4) * (1.0 - c.rgb);
      gl_FragColor = c;
    }`,
};

export interface Look {
  sun: THREE.DirectionalLight;
  /** 0 at night, 1 in full daylight (after weather). */
  daylight: number;
  /** Real seconds, for anything that sways or twinkles. */
  time: number;
  wind: number;
  update(gameMinutes: number, weather: Weather, focus: THREE.Vector3, dt: number): void;
  render(): void;
  resize(): void;
  /** Whether ambient occlusion and multisampling are still on (web/main.ts turns them off when frames are slow). */
  readonly ao: boolean;
  readonly msaa: boolean;
  dropAO(): void;
  dropMSAA(): void;
  setPixelRatio(ratio: number): void;
}

export function createLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { ao?: boolean; quality?: number } = {}): Look {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---------- sky ----------
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color('#5b6b4a') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVisible: { value: 1 },
    uStars: { value: 0 },
    uClouds: { value: 0.3 },
    uCloudLight: { value: 1 },
    uTime: { value: 0 },
  };
  const skyMat = new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // The same sky, alone, is what lights everything softly (and shows in Khina's eyes).
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;
  let envAge = 99;

  const fog = new THREE.FogExp2('#cfe0ea', 0.005);
  scene.fog = fog;

  // ---------- light ----------
  const sun = new THREE.DirectionalLight('#fff1da', 3);
  sun.castShadow = true;
  const q = opts.quality ?? 1;
  sun.shadow.mapSize.set(q >= 1 ? 4096 : 2048, q >= 1 ? 4096 : 2048);
  const S = 26;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -S;
  sun.shadow.camera.right = sun.shadow.camera.top = S;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;
  const hemi = new THREE.HemisphereLight('#dfefff', '#6a7d48', 0.25);
  scene.add(sun, sun.target, hemi);

  // ---------- post ----------
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  let gtao: GTAOPass | null = null;
  if (opts.ao !== false) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE);
  composer.addPass(grade);

  // ---------- per frame ----------
  const cA = new THREE.Color();
  const cB = new THREE.Color();
  const grey = new THREE.Color('#a9b3bb');
  const greyTop = new THREE.Color('#8f9ca8');
  const night = new THREE.Color('#0b1228');

  const look: Look = {
    sun,
    daylight: 1,
    time: 0,
    wind: 1,
    update(t, weather, focus, dt) {
      look.time += dt;
      uniforms.uTime.value = look.time;
      const hour = (((t % 1440) + 1440) % 1440) / 60;
      let i = 1;
      while (i < KEYS.length - 1 && KEYS[i]!.h < hour) i++;
      const k0 = KEYS[i - 1]!;
      const k1 = KEYS[i]!;
      const f = THREE.MathUtils.clamp((hour - k0.h) / Math.max(1e-6, k1.h - k0.h), 0, 1);
      const lightW = WEATHER_LIGHT[weather];
      const overcast = 1 - lightW;

      uniforms.uTop.value.copy(cA.set(k0.top)).lerp(cB.set(k1.top), f);
      uniforms.uHorizon.value.copy(cA.set(k0.horizon)).lerp(cB.set(k1.horizon), f);
      const sunI = THREE.MathUtils.lerp(k0.sunI, k1.sunI, f);
      const env = THREE.MathUtils.lerp(k0.env, k1.env, f);
      const dayness = THREE.MathUtils.smoothstep(sunI, 0.75, 2.4);
      // Grey weather pulls the sky toward grey, more by day than by night.
      uniforms.uTop.value.lerp(cA.copy(greyTop).lerp(night, 1 - dayness), overcast * 0.85);
      uniforms.uHorizon.value.lerp(cA.copy(grey).lerp(night, 1 - dayness), overcast * 0.8);
      uniforms.uSunColor.value.copy(cA.set(k0.sun)).lerp(cB.set(k1.sun), f);

      // The sun crosses from east (x+) to west, low in the south; at night the moon stands high.
      const a = (Math.PI * (hour - 6)) / 14;
      const el = hour > 5.6 && hour < 20.4 ? Math.sin(a) : 0;
      const dir = el > 0.02 ? new THREE.Vector3(Math.cos(a), Math.max(0.12, Math.sin(a)), 0.5).normalize() : new THREE.Vector3(-0.35, 0.85, 0.4).normalize();
      uniforms.uSunDir.value.copy(dir);
      uniforms.uSunVisible.value = el > 0.02 ? lightW * lightW : 0.15;
      uniforms.uStars.value = (1 - dayness) * (1 - overcast * 0.9);
      uniforms.uClouds.value = WEATHER_CLOUDS[weather];
      uniforms.uCloudLight.value = 0.25 + 0.75 * dayness;

      sun.position.copy(focus).addScaledVector(dir, 70);
      sun.target.position.copy(focus);
      sun.color.copy(uniforms.uSunColor.value);
      sun.intensity = sunI * (0.25 + 0.75 * lightW * lightW);
      sun.shadow.radius = 2 + overcast * 6;
      hemi.intensity = 0.2 + 0.25 * dayness;
      scene.environmentIntensity = env * (0.75 + 0.25 * lightW);
      look.daylight = dayness * lightW;
      look.wind = weather === 'rain' ? 2.2 : weather === 'drizzle' ? 1.6 : weather === 'cloudy' ? 1.3 : 1;

      fog.color.copy(uniforms.uHorizon.value).lerp(uniforms.uTop.value, 0.15);
      fog.density = THREE.MathUtils.damp(fog.density, WEATHER_FOG[weather], 1.5, dt);
      renderer.toneMappingExposure = 1.0 + 0.45 * (1 - dayness);

      sky.position.copy(camera.position);

      envAge += dt;
      if (envAge > 1.5) {
        envAge = 0;
        const next = pmrem.fromScene(envScene, 0, 0.1, 100);
        scene.environment = next.texture;
        envRT?.dispose();
        envRT = next;
      }
    },
    render() {
      composer.render();
    },
    resize() {
      const s = renderer.getDrawingBufferSize(new THREE.Vector2());
      composer.setSize(innerWidth, innerHeight);
      gtao?.setSize(s.x, s.y);
      bloom.setSize(s.x / 2, s.y / 2);
    },
    get ao() {
      return gtao !== null;
    },
    get msaa() {
      return composer.renderTarget1.samples > 0;
    },
    dropAO() {
      if (!gtao) return;
      composer.removePass(gtao);
      gtao.dispose();
      gtao = null;
    },
    dropMSAA() {
      // The targets are set up again, without samples, the next time they are drawn to.
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        rt.samples = 0;
        rt.dispose();
      }
    },
    setPixelRatio(ratio) {
      renderer.setPixelRatio(ratio);
      composer.setPixelRatio(ratio);
      look.resize();
    },
  };
  return look;
}
