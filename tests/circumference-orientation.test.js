const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function provider() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('circumference-measurement.js', 'utf8'), context);
  return context.window.tailorScanCircumference.createProvider();
}
const add = (a, b) => a.map((value, index) => value + b[index]);
const rotateX = (point, radians) => [point[0], point[1] * Math.cos(radians) - point[2] * Math.sin(radians), point[1] * Math.sin(radians) + point[2] * Math.cos(radians)];
const rotateZ = (point, radians) => [point[0] * Math.cos(radians) - point[1] * Math.sin(radians), point[0] * Math.sin(radians) + point[1] * Math.cos(radians), point[2]];
const rotate3D = (point, degrees) => rotateZ(rotateX(point, 23 * Math.PI / 180), degrees * Math.PI / 180);
const transformJoint = (joint, degrees) => {
  const [x, y, z] = rotate3D([joint.x, joint.y, joint.z], degrees);
  return { x, y, z };
};

function ellipticalCylinder(radiusX, radiusZ, height = 3, sides = 160, rotation = 0) {
  const vertices = [], faces = [];
  for (const y of [-height / 2, height / 2]) for (let index = 0; index < sides; index += 1) {
    const angle = index / sides * Math.PI * 2;
    vertices.push(...rotate3D([radiusX * Math.cos(angle), y, radiusZ * Math.sin(angle)], rotation));
  }
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    faces.push(index, next, sides + next, index, sides + next, sides + index);
  }
  return { vertices, faces, coordinateUnit: 'in' };
}
function circumferenceOf(type, mesh, rotation) {
  const torsoJoints = {
    leftShoulder: { x: -.1, y: .34, z: 0 }, rightShoulder: { x: .1, y: .34, z: 0 },
    leftHip: { x: -.1, y: -.66, z: 0 }, rightHip: { x: .1, y: -.66, z: 0 },
    leftKnee: { x: -.1, y: -1.1, z: 0 }, rightKnee: { x: .1, y: -1.1, z: 0 }
  };
  const armJoints = {
    rightShoulder: { x: 0, y: .5, z: 0 }, rightElbow: { x: 0, y: -.5, z: 0 },
    rightWrist: { x: 0, y: -1, z: 0 }
  };
  const legJoints = {
    rightKnee: { x: 0, y: .5, z: 0 }, rightAnkle: { x: 0, y: -.5, z: 0 },
    leftKnee: { x: -.1, y: .5, z: 0 }, leftAnkle: { x: -.1, y: -.5, z: 0 }
  };
  const source = type === 'torso' ? torsoJoints : type === 'upperArm' ? armJoints : legJoints;
  const anatomical = Object.fromEntries(Object.entries(source).map(([name, joint]) => [name, transformJoint(joint, rotation)]));
  const name = type === 'torso' ? 'chest' : type === 'upperArm' ? 'bicep' : 'calf';
  const result = provider().measure({ mesh, joints: { anatomical }, reconstructionConfidence: 1 }).measurements[name];
  assert.match(result.status, /^success/, `${type} should have a valid closed curve at ${rotation}°`);
  return result.valueInches;
}
function ellipseCircumference(a, b) {
  const h = ((a - b) ** 2) / ((a + b) ** 2);
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

for (const [label, type, radiusX, radiusZ] of [
  ['torso-like circular segment', 'torso', 5, 5],
  ['upper-arm-like elliptical segment', 'upperArm', 3.25, 2.5],
  ['lower-leg-like elliptical segment', 'lowerLeg', 3.6, 2.2]
]) {
  test(`${label} circumference is invariant under global 3D rotation`, () => {
    const expected = ellipseCircumference(radiusX, radiusZ);
    const results = [0, 15, 30, 45, 60, 75, 90].map(rotation => circumferenceOf(type, ellipticalCylinder(radiusX, radiusZ, 3, 160, rotation), rotation));
    results.forEach(value => assert.ok(Math.abs(value - expected) < .03, `${label} should remain near its known perimeter`));
    results.forEach(value => assert.ok(Math.abs(value - results[0]) < 1e-7, `${label} changed after a global rotation`));
  });
}
