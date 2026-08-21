// Anatomically oriented circumference extraction from a reconstructed mesh.
// This module only measures actual closed mesh/plane intersections; it never
// substitutes a 2D width or a body-proportion estimate when a curve is absent.
(function exposeCircumferenceProvider() {
  const add = (a, b) => a.map((value, index) => value + b[index]);
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const multiply = (a, factor) => a.map(value => value * factor);
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const length = vector => Math.sqrt(dot(vector, vector));
  const normalize = vector => { const size = length(vector); return size > 1e-9 ? multiply(vector, 1 / size) : null; };
  const point = joint => joint && [joint.x, joint.y, joint.z].every(Number.isFinite) ? [joint.x, joint.y, joint.z] : null;
  const midpoint = (first, second) => first && second ? multiply(add(first, second), .5) : null;
  const lerp = (first, second, amount) => add(first, multiply(subtract(second, first), amount));
  const distance = (first, second) => length(subtract(first, second));
  const keyFor = coordinate => coordinate.map(value => Math.round(value * 1e7)).join(',');

  function joint(joints, name) { return point(joints?.[name]); }
  function torsoLandmarks(joints) {
    const shoulder = midpoint(joint(joints, 'leftShoulder'), joint(joints, 'rightShoulder'));
    const hip = midpoint(joint(joints, 'leftHip'), joint(joints, 'rightHip'));
    const knee = midpoint(joint(joints, 'leftKnee'), joint(joints, 'rightKnee'));
    return { shoulder, hip, torsoAxis: shoulder && hip ? normalize(subtract(hip, shoulder)) : null, pelvicAxis: hip && knee ? normalize(subtract(knee, hip)) : null };
  }
  function measurementPlane(name, joints) {
    const torso = torsoLandmarks(joints);
    if (name === 'chest' && torso.shoulder && torso.hip && torso.torsoAxis) return { point: lerp(torso.shoulder, torso.hip, .34), normal: torso.torsoAxis, anatomicalAxis: 'torso axis', region: 'chest_region' };
    if (name === 'waist' && torso.shoulder && torso.hip && torso.torsoAxis) return { point: lerp(torso.shoulder, torso.hip, .72), normal: torso.torsoAxis, anatomicalAxis: 'torso axis', region: 'waist_region' };
    if (name === 'hip' && torso.hip && torso.pelvicAxis) return { point: torso.hip, normal: torso.pelvicAxis, anatomicalAxis: 'pelvic/thigh axis', region: 'hip_region' };
    if (name === 'bicep') {
      for (const side of ['right', 'left']) {
        const shoulder = joint(joints, `${side}Shoulder`), elbow = joint(joints, `${side}Elbow`), axis = shoulder && elbow ? normalize(subtract(elbow, shoulder)) : null;
        if (axis) return { point: lerp(shoulder, elbow, .5), normal: axis, anatomicalAxis: `${side} upper-arm axis`, region: 'upper_arm_region', side };
      }
    }
    if (name === 'calf') {
      for (const side of ['right', 'left']) {
        const knee = joint(joints, `${side}Knee`), ankle = joint(joints, `${side}Ankle`), axis = knee && ankle ? normalize(subtract(ankle, knee)) : null;
        if (axis) return { point: lerp(knee, ankle, .52), normal: axis, anatomicalAxis: `${side} lower-leg axis`, region: 'lower_leg_region', side };
      }
    }
    return null;
  }

  function meshSegments(mesh, plane) {
    const segments = new Map(), epsilon = 1e-8;
    for (let i = 0; i < mesh.faces.length; i += 3) {
      const triangle = [mesh.faces[i], mesh.faces[i + 1], mesh.faces[i + 2]].map(index => mesh.vertices.slice(index * 3, index * 3 + 3));
      if (triangle.some(vertex => vertex.length !== 3)) continue;
      const intersections = [];
      [[0, 1], [1, 2], [2, 0]].forEach(([first, second]) => {
        const a = triangle[first], b = triangle[second], da = dot(subtract(a, plane.point), plane.normal), db = dot(subtract(b, plane.point), plane.normal);
        if ((da > epsilon && db < -epsilon) || (da < -epsilon && db > epsilon)) intersections.push(lerp(a, b, da / (da - db)));
      });
      const unique = intersections.filter((candidate, index, all) => all.findIndex(other => distance(candidate, other) < 1e-7) === index);
      if (unique.length !== 2) continue;
      const first = keyFor(unique[0]), second = keyFor(unique[1]);
      if (first === second) continue;
      const segmentKey = [first, second].sort().join('|');
      segments.set(segmentKey, { first, second, points: { [first]: unique[0], [second]: unique[1] } });
    }
    return [...segments.values()];
  }
  function closedCurves(segments) {
    const adjacency = new Map(), positions = new Map(), used = new Set();
    segments.forEach((segment, index) => {
      positions.set(segment.first, segment.points[segment.first]); positions.set(segment.second, segment.points[segment.second]);
      if (!adjacency.has(segment.first)) adjacency.set(segment.first, []); if (!adjacency.has(segment.second)) adjacency.set(segment.second, []);
      adjacency.get(segment.first).push({ key: segment.second, index }); adjacency.get(segment.second).push({ key: segment.first, index });
    });
    const curves = [];
    segments.forEach((segment, segmentIndex) => {
      if (used.has(segmentIndex)) return;
      const keys = [segment.first]; let previous = null, current = segment.first, closed = false;
      for (let steps = 0; steps <= segments.length + 1; steps += 1) {
        const options = (adjacency.get(current) || []).filter(option => option.key !== previous && !used.has(option.index));
        if (!options.length) break;
        const next = options[0]; used.add(next.index); previous = current; current = next.key;
        if (current === keys[0]) { closed = true; break; }
        keys.push(current);
      }
      if (closed && keys.length >= 6) {
        const points = keys.map(key => positions.get(key));
        const perimeter = points.reduce((sum, candidate, index) => sum + distance(candidate, points[(index + 1) % points.length]), 0);
        const centroid = multiply(points.reduce((sum, candidate) => add(sum, candidate), [0, 0, 0]), 1 / points.length);
        curves.push({ points, perimeter, centroid });
      }
    });
    return curves;
  }
  function selectCurve(curves, plane) {
    if (!curves.length) return null;
    if (plane.side) return curves.sort((first, second) => distance(first.centroid, plane.point) - distance(second.centroid, plane.point))[0];
    return curves.sort((first, second) => second.perimeter - first.perimeter)[0];
  }
  function confidenceFor(curve, plane, reconstructionConfidence) {
    if (!curve) return 0;
    const targetDistance = distance(curve.centroid, plane.point);
    return Math.max(0, Math.min(1, (reconstructionConfidence || .5) * Math.min(1, curve.points.length / 80) * Math.max(.1, 1 - targetDistance)));
  }

  class AnatomicalCircumferenceProvider {
    measure({ mesh, joints, reconstructionConfidence = 0 }) {
      if (!mesh?.vertices?.length || !mesh?.faces?.length) throw new Error('A populated reconstructed mesh is required for circumference measurement.');
      const anatomical = joints?.anatomical || joints;
      const valuesInInches = mesh.coordinateUnit === 'in';
      const results = {};
      ['chest', 'waist', 'hip', 'bicep', 'calf'].forEach(name => {
        const plane = measurementPlane(name, anatomical);
        if (!plane) { results[name] = { status: 'failed: required anatomical landmarks unavailable', confidence: 0 }; return; }
        const curve = selectCurve(closedCurves(meshSegments(mesh, plane)), plane);
        if (!curve || curve.perimeter <= 0) { results[name] = { status: 'failed: no valid closed mesh cross-section', confidence: 0, plane }; return; }
        const confidence = confidenceFor(curve, plane, reconstructionConfidence);
        if (confidence < .35) { results[name] = { status: 'low confidence: cross-section rejected', confidence, plane, curvePointCount: curve.points.length }; return; }
        results[name] = {
          status: valuesInInches ? 'success: mesh cross-section measured in inches' : 'blocked: mesh has no physical inch scale',
          rawPerimeter: curve.perimeter, valueInches: valuesInInches ? curve.perimeter : null,
          confidence, plane: { point: plane.point, normal: plane.normal, anatomicalAxis: plane.anatomicalAxis, region: plane.region, side: plane.side || null },
          curve: { closed: true, pointCount: curve.points.length, perimeter: curve.perimeter }
        };
      });
      return { method: 'anatomically oriented mesh-plane intersection', measurements: results };
    }
  }
  window.tailorScanCircumference = { createProvider: () => new AnatomicalCircumferenceProvider() };
}());
