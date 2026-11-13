/**
 * Rounded 3D triangular glass prism geometry & ideal plane uniforms.
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.),
 * apps/docs/app/[lang]/(home)/components/prism-background.
 */

export interface PrismPlane {
  nx: number;
  ny: number;
  nz: number;
  offset: number;
}

export interface PrismMeshData {
  /** Interleaved float32: [px, py, pz, nx, ny, nz] */
  interleaved: Float32Array;
  /** Triangle indices */
  indices: Uint16Array;
  vertexCount: number;
  side: number;
  depth: number;
  filletRadius: number;
  inradius: number;
  /** Five ideal planes: 3 side faces + front cap (+z) + back cap (-z) */
  planes: [PrismPlane, PrismPlane, PrismPlane, PrismPlane, PrismPlane];
}

interface ContourPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/**
 * Generates an equilateral triangular prism with tangent-arc corner fillets and
 * quarter-round bevels on all 9 edges, centered at origin with apex pointing +Y,
 * and z in [-depth/2, +depth/2].
 */
export function createPrismMeshData(S: number): PrismMeshData {
  const depth = S * (0.3 / 0.57);
  const r = S * (0.008 / 0.57);
  const cornerSegs = 4;
  const bevelSegs = 4;
  const edgeSegs = 16;

  const R = S / Math.sqrt(3);
  const inradius = S / (2 * Math.sqrt(3));
  const halfDepth = depth / 2;

  // Apex UP in 3D (+Y up): top (0, R), left (-S/2, -R/2), right (S/2, -R/2)
  // Counter-clockwise in XY: top -> left -> right
  const rawVerts: [number, number][] = [
    [0, R],
    [-S / 2, -R / 2],
    [S / 2, -R / 2],
  ];

  // For each corner of an equilateral triangle (interior angle 60°),
  // the tangent fillet arc center lies inset from the vertex by 2*r along the inward bisector.
  const arcCenters: [number, number][] = rawVerts.map(([vx, vy]) => {
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;
    return [vx - ux * 2 * r, vy - uy * 2 * r];
  });

  // Outward normals of the 3 side faces in CCW order (top->left, left->right, right->top):
  // Face A (left-upper: top->left): (-sqrt3/2, 1/2)
  // Face B (bottom: left->right): (0, -1)
  // Face C (right-upper: right->top): (sqrt3/2, 1/2)
  const sq3_2 = Math.sqrt(3) / 2;
  const faceNormals: [number, number][] = [
    [-sq3_2, 0.5],
    [0, -1],
    [sq3_2, 0.5],
  ];

  // Build skeleton contour on the inset core (radius 0) + 2D unit outward normals
  // Corner i sits between face (i+2)%3 (incoming) and face i (outgoing).
  // Wait: at vertex 0 (top), incoming edge is right->top (face 2: (+sq3_2, 0.5)), outgoing is top->left (face 0: (-sq3_2, 0.5)).
  // At vertex 1 (left), incoming is face 0 ((-sq3_2, 0.5)), outgoing is face 1 ((0, -1)).
  // At vertex 2 (right), incoming is face 1 ((0, -1)), outgoing is face 2 ((+sq3_2, 0.5)).
  const contour: ContourPoint[] = [];

  for (let i = 0; i < 3; i++) {
    const [cx, cy] = arcCenters[i];
    const [nInX, nInY] = faceNormals[(i + 2) % 3];
    const [nOutX, nOutY] = faceNormals[i];

    const aStart = Math.atan2(nInY, nInX);
    let aEnd = Math.atan2(nOutY, nOutX);
    if (aEnd <= aStart) aEnd += Math.PI * 2;

    // Corner arc from aStart to aEnd
    for (let s = 0; s <= cornerSegs; s++) {
      const a = aStart + ((aEnd - aStart) * s) / cornerSegs;
      contour.push({
        x: cx,
        y: cy,
        nx: Math.cos(a),
        ny: Math.sin(a),
      });
    }

    // Straight edge along face i to next corner's start
    const nextIdx = (i + 1) % 3;
    const [ncx, ncy] = arcCenters[nextIdx];
    for (let e = 1; e < edgeSegs; e++) {
      const t = e / edgeSegs;
      contour.push({
        x: cx + (ncx - cx) * t,
        y: cy + (ncy - cy) * t,
        nx: nOutX,
        ny: nOutY,
      });
    }
  }

  const ringCount = contour.length;

  // Build rings from back cap (-z) to front cap (+z).
  // Quarter-round rings: theta stops at PI/2 - 0.06 so cap fan connects cleanly.
  const thetaMax = Math.PI / 2 - 0.06;
  const rings: { z: number; rScale: number; nz: number; nxyScale: number }[] = [];

  // Back quarter-round: from cap edge (theta = thetaMax) down to side tangent (theta = 0)
  for (let b = 0; b <= bevelSegs; b++) {
    const theta = thetaMax * (1 - b / bevelSegs);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    rings.push({
      z: -(halfDepth - r) - r * sin,
      rScale: r * cos,
      nz: -sin,
      nxyScale: cos,
    });
  }

  // Front quarter-round: from side tangent (theta = 0) up to cap edge (theta = thetaMax)
  for (let b = 0; b <= bevelSegs; b++) {
    const theta = (thetaMax * b) / bevelSegs;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    rings.push({
      z: halfDepth - r + r * sin,
      rScale: r * cos,
      nz: sin,
      nxyScale: cos,
    });
  }

  const totalRingVerts = rings.length * ringCount;
  // +2 center vertices for back cap fan and front cap fan, plus duplicated boundary rings for crisp cap normals
  const capVertCount = (1 + ringCount) * 2;
  const vertexCount = totalRingVerts + capVertCount;
  const interleaved = new Float32Array(vertexCount * 6);

  let vOffset = 0;
  const writeVertex = (px: number, py: number, pz: number, nx: number, ny: number, nz: number) => {
    const idx = vOffset * 6;
    interleaved[idx] = px;
    interleaved[idx + 1] = py;
    interleaved[idx + 2] = pz;
    interleaved[idx + 3] = nx;
    interleaved[idx + 4] = ny;
    interleaved[idx + 5] = nz;
    return vOffset++;
  };

  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const ring = rings[rIdx];
    for (let c = 0; c < ringCount; c++) {
      const pt = contour[c];
      const px = pt.x + pt.nx * ring.rScale;
      const py = pt.y + pt.ny * ring.rScale;
      const nx = pt.nx * ring.nxyScale;
      const ny = pt.ny * ring.nxyScale;
      const len = Math.hypot(nx, ny, ring.nz) || 1;
      writeVertex(px, py, ring.z, nx / len, ny / len, ring.nz / len);
    }
  }

  const indicesList: number[] = [];

  // Connect consecutive rings (CCW outward winding)
  for (let rIdx = 0; rIdx < rings.length - 1; rIdx++) {
    const row0 = rIdx * ringCount;
    const row1 = (rIdx + 1) * ringCount;
    for (let c = 0; c < ringCount; c++) {
      const next = (c + 1) % ringCount;
      const a = row0 + c;
      const b = row0 + next;
      const d = row1 + c;
      const e = row1 + next;
      indicesList.push(a, d, e);
      indicesList.push(a, e, b);
    }
  }

  // Back cap fan (-Z outward)
  const backRing = rings[0];
  const backCenterIdx = writeVertex(0, 0, -halfDepth, 0, 0, -1);
  const backFanStart = vOffset;
  for (let c = 0; c < ringCount; c++) {
    const pt = contour[c];
    writeVertex(
      pt.x + pt.nx * backRing.rScale,
      pt.y + pt.ny * backRing.rScale,
      backRing.z,
      0,
      0,
      -1
    );
  }
  for (let c = 0; c < ringCount; c++) {
    const next = (c + 1) % ringCount;
    indicesList.push(backCenterIdx, backFanStart + next, backFanStart + c);
  }

  // Front cap fan (+Z outward)
  const frontRing = rings[rings.length - 1];
  const frontCenterIdx = writeVertex(0, 0, halfDepth, 0, 0, 1);
  const frontFanStart = vOffset;
  for (let c = 0; c < ringCount; c++) {
    const pt = contour[c];
    writeVertex(
      pt.x + pt.nx * frontRing.rScale,
      pt.y + pt.ny * frontRing.rScale,
      frontRing.z,
      0,
      0,
      1
    );
  }
  for (let c = 0; c < ringCount; c++) {
    const next = (c + 1) % ringCount;
    indicesList.push(frontCenterIdx, frontFanStart + c, frontFanStart + next);
  }

  // Five ideal planes (3 side faces + front + back) as (outward normal, offset)
  const planes: [PrismPlane, PrismPlane, PrismPlane, PrismPlane, PrismPlane] = [
    { nx: sq3_2, ny: 0.5, nz: 0, offset: inradius },
    { nx: 0, ny: -1, nz: 0, offset: inradius },
    { nx: -sq3_2, ny: 0.5, nz: 0, offset: inradius },
    { nx: 0, ny: 0, nz: 1, offset: halfDepth },
    { nx: 0, ny: 0, nz: -1, offset: halfDepth },
  ];

  return {
    interleaved,
    indices: new Uint16Array(indicesList),
    vertexCount,
    side: S,
    depth,
    filletRadius: r,
    inradius,
    planes,
  };
}
