const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function providers() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('circumference-measurement.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('mesh-refinement.js', 'utf8'), context);
  return { circumference: context.window.tailorScanCircumference.createProvider(), refinement: context.window.tailorScanRefinement.createProvider() };
}
function cylinder(radius = 5, height = 3, sides = 160, rings = 24) {
  const vertices = [], faces = [];
  for (let ring = 0; ring < rings; ring += 1) {
    const y = -height / 2 + ring / (rings - 1) * height;
    for (let index = 0; index < sides; index += 1) {
    const angle = index / sides * Math.PI * 2;
    vertices.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
  }
  }
  for (let ring = 0; ring < rings - 1; ring += 1) for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides, base = ring * sides, upper = (ring + 1) * sides;
    faces.push(base + index, base + next, upper + next, base + index, upper + next, upper + index);
  }
  return { vertices, faces, coordinateUnit: 'in', topology: 'closed cylinder', nearWatertight: true };
}
const joints = { anatomical: {
  leftShoulder: { x: -.1, y: .34, z: 0 }, rightShoulder: { x: .1, y: .34, z: 0 },
  leftHip: { x: -.1, y: -.66, z: 0 }, rightHip: { x: .1, y: -.66, z: 0 },
  leftKnee: { x: -.1, y: -1.1, z: 0 }, rightKnee: { x: .1, y: -1.1, z: 0 }
} };

test('locally refines a mesh region toward tape circumference without altering raw mesh', () => {
  const { circumference, refinement } = providers();
  const rawMesh = cylinder();
  const rawVertices = [...rawMesh.vertices];
  const rawChest = circumference.measure({ mesh: rawMesh, joints, reconstructionConfidence: 1 }).measurements.chest.valueInches;
  const tapeChest = rawChest * .9;
  const result = refinement.refine({
    rawMesh, joints, reconstructionConfidence: 1,
    constraints: { chest: { tapeValue: tapeChest, initialReconstructedValue: rawChest, geometryStatus: 'success: mesh cross-section measured in inches', geometryConfidence: 1 } }
  });
  assert.ok(result.mesh);
  assert.deepEqual(rawMesh.vertices, rawVertices);
  assert.notDeepEqual(result.mesh.vertices, rawVertices);
  assert.ok(Math.abs(result.constraints.chest.refinedValue - tapeChest) <= .1);
  assert.ok(Math.abs(result.constraints.chest.remainingError) <= .1);
  assert.equal(result.constraints.chest.status, 'measured');
});

test('refuses constraints that need implausibly large deformation', () => {
  const { circumference, refinement } = providers();
  const rawMesh = cylinder();
  const rawChest = circumference.measure({ mesh: rawMesh, joints, reconstructionConfidence: 1 }).measurements.chest.valueInches;
  const result = refinement.refine({
    rawMesh, joints, reconstructionConfidence: 1,
    constraints: { chest: { tapeValue: rawChest * 1.6, initialReconstructedValue: rawChest, geometryStatus: 'success: mesh cross-section measured in inches', geometryConfidence: 1 } }
  });
  assert.ok(result.mesh);
  assert.match(result.constraints.chest.status, /withheld: required local deformation/);
});
