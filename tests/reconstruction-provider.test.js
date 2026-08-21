const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function providers() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('reconstruction-provider.js', 'utf8'), context);
  vm.runInNewContext(fs.readFileSync('circumference-measurement.js', 'utf8'), context);
  return { reconstruction: context.window.tailorScanReconstruction.createProvider(), circumference: context.window.tailorScanCircumference.createProvider() };
}

function syntheticFrames(angles = [0, 45, 90, 135, 180, 225, 270, 315]) {
  const dimension = 64;
  const data = new Float32Array(dimension * dimension);
  for (let y = 0; y < dimension; y += 1) for (let x = 0; x < dimension; x += 1) {
    const horizontal = (x / (dimension - 1) - .5) / .18;
    const vertical = (y / (dimension - 1) - .5) / .49;
    data[y * dimension + x] = horizontal ** 2 + vertical ** 2 <= 1 ? 1 : 0;
  }
  const joints = {
    leftShoulder: { x: .4, y: .25, z: 0 }, rightShoulder: { x: .6, y: .25, z: 0 },
    leftElbow: { x: .36, y: .4, z: 0 }, rightElbow: { x: .64, y: .4, z: 0 },
    leftWrist: { x: .34, y: .55, z: 0 }, rightWrist: { x: .66, y: .55, z: 0 },
    leftHip: { x: .43, y: .55, z: 0 }, rightHip: { x: .57, y: .55, z: 0 },
    leftKnee: { x: .43, y: .75, z: 0 }, rightKnee: { x: .57, y: .75, z: 0 },
    leftAnkle: { x: .43, y: .95, z: 0 }, rightAnkle: { x: .57, y: .95, z: 0 }
  };
  return angles.map((orientationDeg, index) => ({
    id: `synthetic-${index}`, orientationDeg,
    segmentationMaskRef: { width: dimension, height: dimension, data },
    segmentation: { boundingBox: { x: 0, y: 0, width: 1, height: 1 } },
    landmarks: joints, worldLandmarks: joints,
    quality: { landmarkReliability: .95, segmentationQuality: .95, bodyVisibility: .95 }
  }));
}

test('creates a populated, physically scaled dense mesh from valid silhouettes', async () => {
  const { reconstruction } = providers();
  const result = await reconstruction.reconstruct({ frames: syntheticFrames(), calibration: { height: { tapeValue: 72 } } });
  assert.equal(result.mesh.coordinateUnit, 'in');
  assert.equal(result.scale.inchesPerReconstructionHeightUnit, 72);
  assert.ok(result.vertices.length > 0);
  assert.ok(result.faces.length > 0);
  assert.ok(result.vertices.every(Number.isFinite));
  assert.ok(result.faces.every(index => Number.isInteger(index) && index >= 0 && index < result.vertices.length / 3));
  assert.equal(result.mesh.nearWatertight, true);
});

test('fails honestly for incomplete angular coverage and missing masks', async () => {
  const { reconstruction } = providers();
  await assert.rejects(reconstruction.reconstruct({ frames: syntheticFrames([0, 45, 90, 135, 180, 225]) }), /Required silhouette viewpoints/);
  const missingMasks = syntheticFrames().map(frame => ({ ...frame, segmentationMaskRef: null }));
  await assert.rejects(reconstruction.reconstruct({ frames: missingMasks }), /segmentation mask/);
});

test('measures closed torso and limb cross-sections from the mesh, not a 2D width', async () => {
  const { reconstruction, circumference } = providers();
  const result = await reconstruction.reconstruct({ frames: syntheticFrames(), calibration: { height: { tapeValue: 72 } } });
  const measured = circumference.measure({ mesh: result.mesh, joints: result.joints, reconstructionConfidence: result.confidence });
  for (const name of ['chest', 'waist', 'hip', 'bicep', 'calf']) {
    const measurement = measured.measurements[name];
    assert.match(measurement.status, /^success/);
    assert.ok(measurement.valueInches > 0);
    assert.equal(measurement.curve.closed, true);
    assert.ok(measurement.curve.pointCount >= 6);
  }
  assert.equal(measured.measurements.chest.plane.anatomicalAxis, 'torso axis');
  assert.equal(measured.measurements.hip.plane.anatomicalAxis, 'pelvic/thigh axis');
  assert.match(measured.measurements.bicep.plane.anatomicalAxis, /upper-arm axis/);
  assert.match(measured.measurements.calf.plane.anatomicalAxis, /lower-leg axis/);
});

test('does not fabricate a circumference when anatomy or a mesh is unavailable', async () => {
  const { circumference } = providers();
  assert.throws(() => circumference.measure({ mesh: null, joints: {} }), /populated reconstructed mesh/);
  const { reconstruction } = providers();
  const result = await reconstruction.reconstruct({ frames: syntheticFrames(), calibration: { height: { tapeValue: 72 } } });
  const measured = circumference.measure({ mesh: result.mesh, joints: { anatomical: {} }, reconstructionConfidence: result.confidence });
  assert.match(measured.measurements.chest.status, /^failed: required anatomical landmarks unavailable/);
});
