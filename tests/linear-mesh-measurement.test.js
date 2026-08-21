const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function provider() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('linear-mesh-measurement.js', 'utf8'), context);
  return context.window.tailorScanLinearMesh.createProvider();
}
function cylinder(radius = 5, height = 3, sides = 160, rings = 12) {
  const vertices = [], faces = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const y = -height / 2 + ring / (rings - 1) * height;
    for (let side = 0; side < sides; side += 1) { const angle = side / sides * Math.PI * 2; vertices.push(radius * Math.cos(angle), y, radius * Math.sin(angle)); }
  }
  for (let ring = 0; ring < rings - 1; ring += 1) for (let side = 0; side < sides; side += 1) {
    const next = (side + 1) % sides, base = ring * sides, upper = (ring + 1) * sides;
    faces.push(base + side, base + next, upper + next, base + side, upper + next, upper + side);
  }
  return { vertices, faces, coordinateUnit: 'in' };
}

test('measures shoulder breadth from mesh surface points in inches', () => {
  const measurement = provider().measure({
    mesh: cylinder(), reconstructionConfidence: 1,
    joints: { anatomical: { leftShoulder: { x: -4.9, y: 0, z: 0, confidence: 1 }, rightShoulder: { x: 4.9, y: 0, z: 0, confidence: 1 } } }
  }).shoulder;
  assert.match(measurement.status, /^success/);
  assert.ok(Math.abs(measurement.valueInches - 10) < .03);
  assert.equal(measurement.scaleSource, 'height-scaled reconstructed mesh');
});

test('does not use a default shoulder value when mesh scale or landmarks are missing', () => {
  assert.throws(() => provider().measure({ mesh: { ...cylinder(), coordinateUnit: 'normalized body-height units' }, joints: {} }), /inch-scaled/);
  const result = provider().measure({ mesh: cylinder(), joints: { anatomical: {} }, reconstructionConfidence: 1 }).shoulder;
  assert.match(result.status, /^failed: left\/right shoulder landmarks unavailable/);
});
