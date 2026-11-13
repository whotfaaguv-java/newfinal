/**
 * 2D plane ray-tracing and dispersion optics engine for the glass prism hero.
 * Ported / adapted from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.),
 * apps/docs/app/[lang]/(home)/components/prism-background.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface PrismLayout {
  W: number;
  H: number;
  S: number;
  cx: number;
  cy: number;
  R: number;
  mobile: boolean;
  /** [top, right, left] in y-down CSS px */
  vertices: [Vec2, Vec2, Vec2];
  /** [0: top->right, 1: right->left, 2: left->top] */
  edges: [[Vec2, Vec2], [Vec2, Vec2], [Vec2, Vec2]];
  /** Outward unit normals for edges 0, 1, 2 */
  normals: [Vec2, Vec2, Vec2];
  far: number;
}

export interface SpectrumSample {
  index: number;
  lambdaNm: number;
  n: number;
  vivid: [number, number, number];
  balanced: [number, number, number];
  weight: number;
}

export interface TracedSegment {
  index: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  energy: number;
}

export interface PathGroup {
  pathKey: string;
  inside: boolean;
  segments: (TracedSegment | undefined)[];
}

export interface EdgeGlint {
  edgeIndex: number;
  x: number;
  y: number;
  energy: number;
}

export interface OpticsTraceResult {
  incoming: { x0: number; y0: number; x1: number; y1: number };
  groups: PathGroup[];
  glints: EdgeGlint[];
}

export const WAVELENGTH_COUNT = 72;
export const WAVELENGTH_MIN = 410;
export const WAVELENGTH_MAX = 695;

function buildLayoutFromCenter(
  safeW: number,
  safeH: number,
  cx: number,
  cy: number,
  S: number,
  mobile: boolean
): PrismLayout {
  const R = S / Math.sqrt(3);
  const top: Vec2 = { x: cx, y: cy - R };
  const right: Vec2 = { x: cx + S / 2, y: cy + R / 2 };
  const left: Vec2 = { x: cx - S / 2, y: cy + R / 2 };

  const edges: [[Vec2, Vec2], [Vec2, Vec2], [Vec2, Vec2]] = [
    [top, right],
    [right, left],
    [left, top],
  ];

  // In y-down screen coordinates with clockwise winding (top -> right -> left),
  // outward normal of edge (v0 -> v1) is (ey, -ex) normalized.
  const normals = edges.map(([a, b]) => {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    return { x: ey / len, y: -ex / len };
  }) as [Vec2, Vec2, Vec2];

  return {
    W: safeW,
    H: safeH,
    S,
    cx,
    cy,
    R,
    mobile,
    vertices: [top, right, left],
    edges,
    normals,
    far: 1.5 * Math.hypot(safeW, safeH),
  };
}

export function computeLayoutForSlot(
  W: number,
  H: number,
  cx: number,
  cy: number,
  side: number
): PrismLayout {
  const safeW = Math.max(1, W);
  const safeH = Math.max(1, H);
  const safeS = Math.max(60, side);
  const mobile = safeW < 768;
  return buildLayoutFromCenter(safeW, safeH, cx, cy, safeS, mobile);
}

export function computeLayout(W: number, H: number, copyBottom = 0): PrismLayout {
  const safeW = Math.max(1, W);
  const safeH = Math.max(1, H);
  const mobile = safeW < 820;

  let S: number;
  let cx: number;
  let cy: number;

  if (!mobile) {
    S = Math.min(safeW * 0.36, safeH * 0.62);
    cx = 0.66 * safeW;
    cy = 0.53 * safeH;
  } else {
    S = Math.min(safeW * 0.72, safeH * 0.4, 400);
    cx = safeW / 2;
    cy = Math.max(copyBottom + 30 + S * 0.62, (copyBottom + 30 + safeH) / 2);
  }

  return buildLayoutFromCenter(safeW, safeH, cx, cy, S, mobile);
}

/** Cauchy dispersion: n(λ) = 1.2 + 0.1 / λ² (λ in µm) */
export function cauchyIOR(lambdaNm: number): number {
  const um = lambdaNm / 1000;
  return 1.2 + 0.1 / (um * um);
}

/** Piecewise visible-spectrum RGB approximation (0..1) */
export function wavelengthToSpectrum(lambdaNm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;

  if (lambdaNm < 440) {
    r = -(lambdaNm - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (lambdaNm < 490) {
    r = 0;
    g = (lambdaNm - 440) / (490 - 440);
    b = 1;
  } else if (lambdaNm < 510) {
    r = 0;
    g = 1;
    b = -(lambdaNm - 510) / (510 - 490);
  } else if (lambdaNm < 580) {
    r = (lambdaNm - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (lambdaNm < 645) {
    r = 1;
    g = -(lambdaNm - 645) / (645 - 580);
    b = 0;
  } else {
    r = 1;
    g = 0;
    b = 0;
  }

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function buildSpectrum(count = WAVELENGTH_COUNT): SpectrumSample[] {
  const raw: { lambdaNm: number; n: number; vivid: [number, number, number] }[] = [];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const lambdaNm = WAVELENGTH_MIN + (WAVELENGTH_MAX - WAVELENGTH_MIN) * t;
    const vivid = wavelengthToSpectrum(lambdaNm);
    sumR += vivid[0];
    sumG += vivid[1];
    sumB += vivid[2];
    raw.push({
      lambdaNm,
      n: cauchyIOR(lambdaNm),
      vivid,
    });
  }

  // Balance channels so sum across all wavelengths equals neutral white
  const avgSum = (sumR + sumG + sumB) / 3 || 1;
  const kR = avgSum / (sumR || 1);
  const kG = avgSum / (sumG || 1);
  const kB = avgSum / (sumB || 1);

  return raw.map((item, index) => {
    const r = item.vivid[0] * kR;
    const g = item.vivid[1] * kG;
    const b = item.vivid[2] * kB;
    const lum = Math.max(r, g, b, 1e-4);
    const balanced: [number, number, number] = [r / lum, g / lum, b / lum];
    const weight = (lum / count) * 1.15;
    return {
      index,
      lambdaNm: item.lambdaNm,
      n: item.n,
      vivid: item.vivid,
      balanced,
      weight,
    };
  });
}

/**
 * Lamp (vgpu lampForIncidence): always from the RIGHT, aimed at a point on the right face.
 * aim0 in [0,1] -> piecewise incidence -35° (top) -> 60° (middle) -> 75° (bottom).
 * aim1 in [0,1] -> entry point lerped along right face from 0.08 to 0.92.
 */
export function lampForIncidence(
  layout: PrismLayout,
  aim0: number,
  aim1: number
): { origin: Vec2; dir: Vec2; entry: Vec2; incidenceDeg: number } {
  const y = Math.max(0, Math.min(1, aim0));
  const x = Math.max(0, Math.min(1, aim1));

  const incidenceDeg =
    y <= 0.5 ? -35 + (60 - -35) * (y / 0.5) : 60 + (75 - 60) * ((y - 0.5) / 0.5);
  const theta = (incidenceDeg * Math.PI) / 180;

  // Inward normal of right face (edge 0)
  const nRightOut = layout.normals[0];
  const inX = -nRightOut.x;
  const inY = -nRightOut.y;

  // Rotate inward normal by +incidence in y-down space
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dir: Vec2 = {
    x: inX * cos - inY * sin,
    y: inX * sin + inY * cos,
  };

  const [top, right] = layout.edges[0];
  const u = 0.08 + (0.92 - 0.08) * x;
  const entry: Vec2 = {
    x: top.x + (right.x - top.x) * u,
    y: top.y + (right.y - top.y) * u,
  };

  const origin: Vec2 = {
    x: entry.x - dir.x * layout.far,
    y: entry.y - dir.y * layout.far,
  };

  return { origin, dir, entry, incidenceDeg };
}

function intersectRayEdge(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  a: Vec2,
  b: Vec2
): { t: number; u: number; x: number; y: number } | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-9) return null;

  const qx = a.x - ox;
  const qy = a.y - oy;
  const t = (qx * ey - qy * ex) / denom;
  const u = (qx * dy - qy * dx) / denom;

  if (t > 1e-4 && u >= -1e-4 && u <= 1 + 1e-4) {
    return {
      t,
      u,
      x: ox + dx * t,
      y: oy + dy * t,
    };
  }
  return null;
}

export function tracePrismOptics(
  layout: PrismLayout,
  spectrum: SpectrumSample[],
  aim0: number,
  aim1: number
): OpticsTraceResult {
  const lamp = lampForIncidence(layout, aim0, aim1);
  const incoming = {
    x0: lamp.origin.x,
    y0: lamp.origin.y,
    x1: lamp.entry.x,
    y1: lamp.entry.y,
  };

  const groupMap = new Map<string, PathGroup>();
  const glintMap = new Map<number, { x: number; y: number; energy: number; count: number }>();

  const recordSegment = (
    pathKey: string,
    inside: boolean,
    wavelengthIndex: number,
    seg: TracedSegment
  ) => {
    const mapKey = `${inside ? 'I' : 'O'}:${pathKey}`;
    let group = groupMap.get(mapKey);
    if (!group) {
      group = {
        pathKey,
        inside,
        segments: new Array(spectrum.length),
      };
      groupMap.set(mapKey, group);
    }
    const existing = group.segments[wavelengthIndex];
    if (!existing || seg.energy > existing.energy) {
      group.segments[wavelengthIndex] = seg;
    }
  };

  const addGlint = (edgeIndex: number, x: number, y: number, energy: number) => {
    const cur = glintMap.get(edgeIndex);
    if (!cur) {
      glintMap.set(edgeIndex, { x: x * energy, y: y * energy, energy, count: 1 });
    } else {
      cur.x += x * energy;
      cur.y += y * energy;
      cur.energy += energy;
      cur.count += 1;
    }
  };

  const traceRay = (
    sample: SpectrumSample,
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    energy: number,
    inside: boolean,
    lastEdge: number,
    depth: number,
    pathKey: string
  ) => {
    if (depth >= 7) return;

    let bestHit: { t: number; x: number; y: number; edgeIndex: number } | null = null;
    for (let e = 0; e < 3; e++) {
      if (e === lastEdge && depth > 0) continue;
      const [a, b] = layout.edges[e];
      const hit = intersectRayEdge(ox, oy, dx, dy, a, b);
      if (hit && (!bestHit || hit.t < bestHit.t)) {
        bestHit = { t: hit.t, x: hit.x, y: hit.y, edgeIndex: e };
      }
    }

    if (!bestHit) {
      if (depth > 0 && !inside) {
        recordSegment(pathKey, false, sample.index, {
          index: sample.index,
          x0: ox,
          y0: oy,
          x1: ox + dx * layout.far,
          y1: oy + dy * layout.far,
          energy,
        });
      }
      return;
    }

    if (depth > 0) {
      recordSegment(pathKey, inside, sample.index, {
        index: sample.index,
        x0: ox,
        y0: oy,
        x1: bestHit.x,
        y1: bestHit.y,
        energy,
      });
    }

    addGlint(bestHit.edgeIndex, bestHit.x, bestHit.y, energy);

    // Orient normal against incoming ray
    const outN = layout.normals[bestHit.edgeIndex];
    let nx = inside ? -outN.x : outN.x;
    let ny = inside ? -outN.y : outN.y;
    if (dx * nx + dy * ny > 0) {
      nx = -nx;
      ny = -ny;
    }

    const n1 = inside ? sample.n : 1.0;
    const n2 = inside ? 1.0 : sample.n;
    const eta = n1 / n2;
    const cosI = Math.max(0, Math.min(1, -(dx * nx + dy * ny)));
    const sin2T = eta * eta * (1 - cosI * cosI);

    // Reflection direction
    const dotDN = dx * nx + dy * ny;
    const rx = dx - 2 * dotDN * nx;
    const ry = dy - 2 * dotDN * ny;
    const rLen = Math.hypot(rx, ry) || 1;
    const rdx = rx / rLen;
    const rdy = ry / rLen;

    let R = 1.0;
    let tdx = 0;
    let tdy = 0;
    const tir = sin2T >= 1.0;

    if (!tir) {
      const cosT = Math.sqrt(1 - sin2T);
      const tx = eta * dx + (eta * cosI - cosT) * nx;
      const ty = eta * dy + (eta * cosI - cosT) * ny;
      const tLen = Math.hypot(tx, ty) || 1;
      tdx = tx / tLen;
      tdy = ty / tLen;

      const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
      const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
      R = 0.5 * (rs * rs + rp * rp);
    }

    const T = 1.0 - R;

    if (!tir && energy * T > 0.08) {
      traceRay(
        sample,
        bestHit.x,
        bestHit.y,
        tdx,
        tdy,
        energy * T,
        !inside,
        bestHit.edgeIndex,
        depth + 1,
        `${pathKey}T${bestHit.edgeIndex}`
      );
    }

    if (energy * R > 0.12) {
      traceRay(
        sample,
        bestHit.x,
        bestHit.y,
        rdx,
        rdy,
        energy * R,
        inside,
        bestHit.edgeIndex,
        depth + 1,
        `${pathKey}R${bestHit.edgeIndex}`
      );
    }
  };

  for (let i = 0; i < spectrum.length; i++) {
    traceRay(
      spectrum[i],
      lamp.origin.x,
      lamp.origin.y,
      lamp.dir.x,
      lamp.dir.y,
      1.0,
      false,
      -1,
      0,
      ''
    );
  }

  const glints: EdgeGlint[] = [];
  glintMap.forEach((v, edgeIndex) => {
    if (v.energy > 0) {
      glints.push({
        edgeIndex,
        x: v.x / v.energy,
        y: v.y / v.energy,
        energy: v.energy / spectrum.length,
      });
    }
  });

  return {
    incoming,
    groups: Array.from(groupMap.values()),
    glints,
  };
}
