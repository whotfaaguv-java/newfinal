/**
 * Studio environment & two-pass glass refraction/TIR shaders.
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.),
 * apps/docs/app/[lang]/(home)/components/prism-background.
 */

const SHARED_COLOR_GLSL = /* glsl */ `
vec3 prismSrgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

vec3 prismLinearToSrgb(vec3 c) {
  vec3 clamped = max(c, vec3(0.0));
  vec3 lo = clamped * 12.92;
  vec3 hi = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), clamped));
}

float prismLuminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 prismSoftShoulder(vec3 c) {
  vec3 excess = max(c - vec3(0.8), vec3(0.0));
  vec3 compressed = vec3(0.8) + excess / (1.0 + excess * 5.0);
  return mix(c, compressed, step(vec3(0.8), c));
}

float prismSchlickFresnel(float cosTheta, float f0) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  float m2 = m * m;
  return f0 + (1.0 - f0) * (m2 * m2 * m);
}
`;

const STUDIO_ENV_GLSL = /* glsl */ `
float rectPanelMask(vec3 dir, vec3 panelDir, vec2 size, float feather) {
  vec3 w = normalize(panelDir);
  vec3 up = abs(w.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 u = normalize(cross(up, w));
  vec3 v = cross(w, u);

  float d = dot(dir, w);
  if (d <= 0.001) return 0.0;

  vec2 uv = vec2(dot(dir, u), dot(dir, v)) / d;
  vec2 halfSize = size * 0.5;
  float dx = 1.0 - smoothstep(halfSize.x - feather, halfSize.x + feather, abs(uv.x));
  float dy = 1.0 - smoothstep(halfSize.y - feather, halfSize.y + feather, abs(uv.y));
  return dx * dy;
}

vec3 sampleStudioEnv(vec3 dir) {
  vec3 d = normalize(dir);
  // Deep wine-obsidian studio room with darker back wall (-z) and subtle floor (-y)
  vec3 c = vec3(0.016, 0.005, 0.014);
  c = mix(c, vec3(0.006, 0.002, 0.007), smoothstep(0.1, -0.7, d.z));
  c = mix(c, vec3(0.040, 0.010, 0.024), smoothstep(0.05, -0.8, d.y));

  // Back-left wall panel (sculpts left bevel & back face)
  c += vec3(0.95, 0.82, 0.88) * 0.045 *
       rectPanelMask(d, vec3(-0.82, 0.14, 0.56), vec2(1.45, 1.25), 0.25);

  // Soft bottom fill (warm champagne under-bevel glow)
  c += vec3(1.0, 0.90, 0.94) * 0.42 *
       rectPanelMask(d, vec3(0.0, -0.72, 0.69), vec2(0.58, 0.68), 0.22);

  // Upper-left champagne rim strip (catches left-top edge bevel)
  c += vec3(1.0, 0.88, 0.94) * 2.2 *
       rectPanelMask(d, vec3(-0.68, 0.48, 0.55), vec2(0.42, 0.12), 0.06);

  // Crisp champagne-white right key panel + thin crimson bevel rim
  c += vec3(1.0, 0.94, 0.97) * 18.5 *
       rectPanelMask(d, vec3(0.612, 0.354, 0.707), vec2(0.48, 0.15), 0.035);
  c += vec3(1.0, 0.16, 0.44) * 3.8 *
       rectPanelMask(d, vec3(0.80, -0.34, 0.49), vec2(0.32, 0.10), 0.04);

  c = c / (1.0 + c);
  c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  c = prismSrgbToLinear(c);
  return c * 2.25;
}
`;

const IDEAL_PLANES_GLSL = /* glsl */ `
uniform vec4 uPlanes[5];

int findNextPlane(vec3 origin, vec3 dir, int excludeIdx, out float outT) {
  float minT = 1e9;
  int hitIdx = -1;
  for (int i = 0; i < 5; i++) {
    if (i == excludeIdx) continue;
    vec3 pn = uPlanes[i].xyz;
    float po = uPlanes[i].w;
    float denom = dot(dir, pn);
    if (denom > 1e-5) {
      float t = (po - dot(origin, pn)) / denom;
      if (t > 1e-3 && t < minT) {
        minT = t;
        hitIdx = i;
      }
    }
  }
  outT = minT;
  return hitIdx;
}
`;

export const BG_BLEND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BG_BLEND_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uFxTex;
uniform vec3 uBgSrgb;
varying vec2 vUv;
${SHARED_COLOR_GLSL}

void main() {
  vec4 fx = texture2D(uFxTex, vUv);
  vec3 bgLin = prismSrgbToLinear(uBgSrgb);
  vec3 fxLin = prismSrgbToLinear(fx.rgb) * fx.a;
  vec3 blended = 1.0 - (1.0 - bgLin) * (1.0 - fxLin);
  gl_FragColor = vec4(blended, 1.0);
}
`;

export const COPY_TO_SCREEN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uTargetTex;
varying vec2 vUv;
${SHARED_COLOR_GLSL}

void main() {
  vec3 lin = texture2D(uTargetTex, vUv).rgb;
  gl_FragColor = vec4(prismLinearToSrgb(lin), 1.0);
}
`;

export const GLASS_VERT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const GLASS_BACK_FRAG = /* glsl */ `
precision highp float;
uniform float uIor;
uniform float uF0;
uniform float uReflectionStrength;
${IDEAL_PLANES_GLSL}
${SHARED_COLOR_GLSL}
${STUDIO_ENV_GLSL}

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 dir = normalize(vWorldPos - cameraPosition);
  vec3 n = -normalize(vWorldNormal);
  if (dot(dir, n) > 0.0) n = -n;

  float cosI = clamp(-dot(dir, n), 0.0, 1.0);
  float F = prismSchlickFresnel(cosI, uF0);

  vec3 refr = refract(dir, n, uIor);
  bool escapedDirect = length(refr) > 0.001;

  vec3 accumEnv = vec3(0.0);
  vec3 rayPos = vWorldPos;
  vec3 rayDir = reflect(dir, n);
  int lastPlane = -1;
  float throughput = 1.0;

  for (int bounce = 0; bounce < 3; bounce++) {
    float tHit = 0.0;
    int hitPlane = findNextPlane(rayPos, rayDir, lastPlane, tHit);
    if (hitPlane < 0) {
      accumEnv += sampleStudioEnv(rayDir) * throughput;
      break;
    }

    vec3 nextPos = rayPos + rayDir * tHit;
    vec3 pn = -uPlanes[hitPlane].xyz;
    float cI = clamp(-dot(rayDir, pn), 0.0, 1.0);
    float fExit = prismSchlickFresnel(cI, uF0);
    vec3 outDir = refract(rayDir, pn, uIor);

    if (length(outDir) > 0.001) {
      accumEnv += sampleStudioEnv(outDir) * (1.0 - fExit) * throughput;
      throughput *= fExit;
    }

    rayPos = nextPos;
    rayDir = reflect(rayDir, pn);
    lastPlane = hitPlane;
  }

  float weight = escapedDirect ? F : 1.0;
  vec3 outCol = accumEnv * uReflectionStrength * weight;
  gl_FragColor = vec4(outCol, weight);
}
`;

export const GLASS_FRONT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uBgTex;
uniform mat4 uViewProj;
uniform float uIor;
uniform float uF0;
uniform float uReflectionStrength;
uniform float uSide;
uniform vec3 uAbsorption;
${IDEAL_PLANES_GLSL}
${SHARED_COLOR_GLSL}
${STUDIO_ENV_GLSL}

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec3 I = normalize(vWorldPos - cameraPosition);
  vec3 N = normalize(vWorldNormal);
  if (dot(I, N) > 0.0) N = -N;

  float facing = clamp(-dot(I, N), 0.0, 1.0);
  float F = prismSchlickFresnel(facing, uF0);

  vec3 R = reflect(I, N);
  vec3 env = sampleStudioEnv(R);
  vec3 reflected = env * uReflectionStrength;

  vec3 T = refract(I, N, 1.0 / uIor);
  if (length(T) < 0.001) T = R;

  float tExit = 0.0;
  int hitPlane = findNextPlane(vWorldPos, T, -1, tExit);
  if (hitPlane < 0) tExit = uSide * 0.5;

  vec3 exitPos = vWorldPos + T * tExit;
  vec4 clip = uViewProj * vec4(exitPos, 1.0);
  vec2 uv = clamp((clip.xy / max(clip.w, 1e-4)) * 0.5 + 0.5, vec2(0.001), vec2(0.999));

  vec3 bgSample = texture2D(uBgTex, uv).rgb;
  vec3 absorb = exp(-uAbsorption * tExit * (0.57 / max(uSide, 1.0)));
  vec3 transmitted = bgSample * absorb;

  float panelHighlight =
    smoothstep(0.5, 0.82, prismLuminance(env)) *
    clamp(uReflectionStrength * 0.4, 0.0, 0.7) *
    (0.65 + 0.35 * pow(1.0 - facing, 1.5));

  vec3 col = transmitted * (1.0 - F) + reflected * F + vec3(panelHighlight);
  col = prismSoftShoulder(col);

  gl_FragColor = vec4(prismLinearToSrgb(col), 1.0);
}
`;
