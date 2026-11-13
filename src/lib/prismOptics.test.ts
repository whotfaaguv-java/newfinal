import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpectrum,
  cauchyIOR,
  computeLayout,
  computeLayoutForSlot,
  lampForIncidence,
  tracePrismOptics,
  WAVELENGTH_COUNT,
} from './prismOptics';
import { createPrismMeshData } from './prismMesh';

test('computeLayout computes desktop and mobile prism centroids accurately', () => {
  const desktop = computeLayout(1440, 900);
  assert.equal(desktop.mobile, false);
  assert.ok(Math.abs(desktop.cx - 0.66 * 1440) < 1e-6);
  assert.ok(Math.abs(desktop.cy - 0.53 * 900) < 1e-6);
  assert.ok(Math.abs(desktop.S - Math.min(1440 * 0.36, 900 * 0.62)) < 1e-6);

  const mobile = computeLayout(390, 844, 240);
  assert.equal(mobile.mobile, true);
  assert.equal(mobile.cx, 195);
  assert.ok(mobile.cy >= 240 + 30 + mobile.S * 0.62 - 1e-6);
});

test('computeLayoutForSlot centers equilateral triangle at measured DOM slot coordinates', () => {
  const slotLayout = computeLayoutForSlot(1200, 480, 920, 235, 240);
  assert.equal(slotLayout.mobile, false);
  assert.equal(slotLayout.cx, 920);
  assert.equal(slotLayout.cy, 235);
  assert.equal(slotLayout.S, 240);
  // Outward normal of right face (top -> right) points upper-right (+x, -y in y-down space)
  assert.ok(slotLayout.normals[0].x > 0 && slotLayout.normals[0].y < 0);
});

test('Cauchy IOR decreases monotonically from violet (410nm) to red (695nm)', () => {
  const nViolet = cauchyIOR(410);
  const nGreen = cauchyIOR(550);
  const nRed = cauchyIOR(695);
  assert.ok(nViolet > nGreen && nGreen > nRed);
  assert.ok(nViolet > 1.7 && nRed > 1.4);
});

test('buildSpectrum produces 72 wavelengths whose balanced weighted sum is neutral white', () => {
  const spectrum = buildSpectrum();
  assert.equal(spectrum.length, WAVELENGTH_COUNT);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (const s of spectrum) {
    sumR += s.balanced[0] * s.weight;
    sumG += s.balanced[1] * s.weight;
    sumB += s.balanced[2] * s.weight;
  }

  assert.ok(Math.abs(sumR - sumG) < 0.05, `R=${sumR} vs G=${sumG}`);
  assert.ok(Math.abs(sumG - sumB) < 0.05, `G=${sumG} vs B=${sumB}`);
});

test('lampForIncidence enters right face from outside and traces dispersed rainbow rays', () => {
  const layout = computeLayout(1440, 900);
  const spectrum = buildSpectrum();

  for (const aim0 of [0.1, 0.5, 0.9]) {
    const lamp = lampForIncidence(layout, aim0, 0.5);
    const nRightOut = layout.normals[0];
    // Incoming ray must move opposite to outward normal of right face
    const dot = lamp.dir.x * nRightOut.x + lamp.dir.y * nRightOut.y;
    assert.ok(dot < 0, `Expected ray to enter right face from outside, dot=${dot}`);

    const traced = tracePrismOptics(layout, spectrum, aim0, 0.5);
    assert.ok(traced.groups.length > 0, 'Expected traced ray path groups');
    const outgoingGroups = traced.groups.filter((g) => !g.inside);
    assert.ok(outgoingGroups.length > 0, 'Expected exiting rainbow rays');

    // Verify violet and red diverge in exit angle / endpoint
    const mainExit = outgoingGroups[0];
    const first = mainExit.segments[0];
    const last = mainExit.segments[mainExit.segments.length - 1];
    assert.ok(first && last, 'Expected full spectrum exit segments');
    const dist = Math.hypot(first.x1 - last.x1, first.y1 - last.y1);
    assert.ok(dist > 10, `Expected visible spectral spread, got ${dist}`);
  }
});

test('createPrismMeshData builds valid interleaved geometry, indices, and 5 ideal planes', () => {
  const mesh = createPrismMeshData(400);
  assert.equal(mesh.interleaved.length, mesh.vertexCount * 6);
  assert.ok(mesh.indices.length > 0);
  assert.equal(mesh.indices.length % 3, 0);
  assert.equal(mesh.planes.length, 5);

  for (let i = 0; i < mesh.indices.length; i++) {
    assert.ok(mesh.indices[i] < mesh.vertexCount);
  }

  // Verify unit normals on all vertices
  for (let v = 0; v < mesh.vertexCount; v++) {
    const nx = mesh.interleaved[v * 6 + 3];
    const ny = mesh.interleaved[v * 6 + 4];
    const nz = mesh.interleaved[v * 6 + 5];
    const len = Math.hypot(nx, ny, nz);
    assert.ok(Math.abs(len - 1) < 1e-4, `Non-unit normal at vertex ${v}: ${len}`);
  }
});
