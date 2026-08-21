// 3D landmark-to-surface linear measurements. These measurements use the
// inch-scaled reconstructed mesh, never a fixed UI default or image width.
(function exposeLinearMeshProvider() {
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const magnitude = vector => Math.sqrt(dot(vector, vector));
  const normalize = vector => { const size = magnitude(vector); return size > 1e-8 ? vector.map(value => value / size) : null; };
  const distance = (first, second) => magnitude(subtract(first, second));
  const asPoint = joint => joint && [joint.x, joint.y, joint.z].every(Number.isFinite) ? [joint.x, joint.y, joint.z] : null;
  function meshHeight(mesh) {
    const vertical = mesh.vertices.filter((_, index) => index % 3 === 1);
    return Math.max(...vertical) - Math.min(...vertical);
  }
  function shoulderSurfacePoint(mesh, landmark, outward, height) {
    const searchRadius = height * .14;
    let best = null;
    for (let index = 0; index < mesh.vertices.length; index += 3) {
      const vertex = [mesh.vertices[index], mesh.vertices[index + 1], mesh.vertices[index + 2]];
      const offset = subtract(vertex, landmark), landmarkDistance = magnitude(offset);
      if (landmarkDistance > searchRadius) continue;
      const lateralDistance = dot(offset, outward);
      if (lateralDistance <= 0) continue;
      // Prefer the actual outer shoulder surface close to the anatomical
      // landmark, rather than a distant arm/hand surface.
      const score = lateralDistance - .3 * landmarkDistance;
      if (!best || score > best.score) best = { point: vertex, score, landmarkDistance };
    }
    return best;
  }
  class LinearMeshMeasurementProvider {
    measure({ mesh, joints, reconstructionConfidence = 0 }) {
      if (!mesh?.vertices?.length || mesh.coordinateUnit !== 'in') throw new Error('An inch-scaled reconstructed mesh is required for shoulder measurement.');
      const anatomical = joints?.anatomical || joints;
      const leftLandmark = asPoint(anatomical?.leftShoulder), rightLandmark = asPoint(anatomical?.rightShoulder);
      if (!leftLandmark || !rightLandmark) return { shoulder: { status: 'failed: left/right shoulder landmarks unavailable', confidence: 0 } };
      const across = normalize(subtract(rightLandmark, leftLandmark));
      if (!across) return { shoulder: { status: 'failed: shoulder landmarks are coincident', confidence: 0 } };
      const height = meshHeight(mesh);
      const leftTip = shoulderSurfacePoint(mesh, leftLandmark, across.map(value => -value), height);
      const rightTip = shoulderSurfacePoint(mesh, rightLandmark, across, height);
      if (!leftTip || !rightTip) return { shoulder: { status: 'failed: shoulder surface points unavailable', confidence: 0 } };
      const valueInches = distance(leftTip.point, rightTip.point);
      const landmarkConfidence = Math.min(anatomical.leftShoulder?.confidence ?? 0, anatomical.rightShoulder?.confidence ?? 0);
      const confidence = Math.max(0, Math.min(1, reconstructionConfidence * Math.max(.5, landmarkConfidence) * Math.min(1, 1 - (leftTip.landmarkDistance + rightTip.landmarkDistance) / Math.max(height * .28, 1e-6))));
      return { shoulder: {
        status: confidence >= .45 ? 'success: 3D shoulder-tip surface distance measured in inches' : 'low confidence: shoulder surface measurement',
        rawDistance: valueInches, valueInches, confidence,
        landmarks: { left: leftLandmark, right: rightLandmark }, surfacePoints: { left: leftTip.point, right: rightTip.point },
        scaleSource: 'height-scaled reconstructed mesh'
      } };
    }
  }
  window.tailorScanLinearMesh = { createProvider: () => new LinearMeshMeasurementProvider() };
}());
