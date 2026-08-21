// Experimental dense body-surface provider.
// It builds a visual hull from real MediaPipe person masks captured while the
// camera is stationary and the subject turns at guided angles. It does not use
// a parametric/research-only body model and it never fabricates a mesh when the
// selected silhouettes are inadequate.
(function exposeVisualHullProvider() {
  const REQUIRED_ANGLES = [0, 90, 180, 270];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const angularDistance = (first, second) => {
    const difference = Math.abs((((first - second) % 360) + 360) % 360);
    return Math.min(difference, 360 - difference);
  };

  function requireFrames(frames) {
    if (!Array.isArray(frames) || frames.length < 6) throw new Error('At least six valid, angularly separated silhouette frames are required.');
    const missing = REQUIRED_ANGLES.filter(angle => !frames.some(frame => Number.isFinite(frame.orientationDeg) && angularDistance(frame.orientationDeg, angle) <= 28));
    if (missing.length) throw new Error(`Required silhouette viewpoints are missing near ${missing.join('°, ')}°.`);
    frames.forEach(frame => {
      const mask = frame.segmentationMaskRef;
      if (!mask?.data || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.data.length !== mask.width * mask.height) throw new Error(`Frame ${frame.id || 'unknown'} has no valid person segmentation mask.`);
      if (!frame.landmarks || !frame.worldLandmarks) throw new Error(`Frame ${frame.id || 'unknown'} has no anatomical pose landmarks.`);
    });
  }

  function maskContains(frame, x, y, z) {
    const mask = frame.segmentationMaskRef;
    const box = frame.segmentation?.boundingBox || { x: 0, y: 0, width: 1, height: 1 };
    const aspect = mask.width / mask.height;
    const angle = (frame.orientationDeg * Math.PI) / 180;
    // The rotating person is treated as an equivalent rotating silhouette
    // camera. y is aligned to the detected full-body bounding box; horizontal
    // units use the actual mask pixel aspect ratio.
    const projected = x * Math.cos(angle) + z * Math.sin(angle);
    const u = box.x + box.width / 2 + projected / aspect;
    const v = box.y + y * box.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    const px = clamp(Math.round(u * (mask.width - 1)), 0, mask.width - 1);
    const py = clamp(Math.round(v * (mask.height - 1)), 0, mask.height - 1);
    return mask.data[py * mask.width + px] >= .5;
  }

  function carveVisualHull(frames, resolution) {
    const { x: widthCount, y: heightCount, z: depthCount, halfWidth } = resolution;
    const cells = new Uint8Array(widthCount * heightCount * depthCount);
    const indexOf = (x, y, z) => (y * depthCount + z) * widthCount + x;
    let occupied = 0;
    for (let y = 0; y < heightCount; y += 1) {
      const bodyY = (y + .5) / heightCount;
      for (let z = 0; z < depthCount; z += 1) {
        const bodyZ = ((z + .5) / depthCount * 2 - 1) * halfWidth;
        for (let x = 0; x < widthCount; x += 1) {
          const bodyX = ((x + .5) / widthCount * 2 - 1) * halfWidth;
          if (frames.every(frame => maskContains(frame, bodyX, bodyY, bodyZ))) {
            cells[indexOf(x, y, z)] = 1;
            occupied += 1;
          }
        }
      }
    }
    return { cells, occupied, indexOf };
  }

  function surfaceFromCells(carved, resolution, physicalScale) {
    const { cells, indexOf } = carved;
    const { x: widthCount, y: heightCount, z: depthCount, halfWidth } = resolution;
    const vertices = [], faces = [], vertexIndices = new Map();
    const dx = (halfWidth * 2) / widthCount, dy = 1 / heightCount, dz = (halfWidth * 2) / depthCount;
    const point = (x, y, z) => [x * physicalScale, y * physicalScale, z * physicalScale];
    const cellOrigin = (x, y, z) => [-halfWidth + x * dx, 1 - (y + 1) * dy, -halfWidth + z * dz];
    const addVertex = (coordinate) => {
      const key = coordinate.map(value => value.toFixed(8)).join(',');
      const known = vertexIndices.get(key);
      if (known != null) return known;
      const index = vertices.length / 3;
      vertices.push(...coordinate);
      vertexIndices.set(key, index);
      return index;
    };
    const directions = [
      { delta: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
      { delta: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
      { delta: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
      { delta: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
      { delta: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
      { delta: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] }
    ];
    for (let y = 0; y < heightCount; y += 1) for (let z = 0; z < depthCount; z += 1) for (let x = 0; x < widthCount; x += 1) {
      if (!cells[indexOf(x, y, z)]) continue;
      const origin = cellOrigin(x, y, z);
      directions.forEach(({ delta, corners }) => {
        const [nx, ny, nz] = [x + delta[0], y + delta[1], z + delta[2]];
        if (nx >= 0 && nx < widthCount && ny >= 0 && ny < heightCount && nz >= 0 && nz < depthCount && cells[indexOf(nx, ny, nz)]) return;
        const quad = corners.map(([cx, cy, cz]) => addVertex(point(origin[0] + cx * dx, origin[1] + cy * dy, origin[2] + cz * dz)));
        faces.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      });
    }
    return { vertices, faces };
  }

  function average(frames, key) { return frames.reduce((total, frame) => total + (frame.quality?.[key] || 0), 0) / frames.length; }
  function knownHeight(calibration) {
    const height = calibration?.height?.tapeValue ?? calibration?.height;
    return Number.isFinite(height) && height > 0 ? height : null;
  }
  function anatomicalJointsInMeshSpace(frames, physicalScale) {
    const names = [...new Set(frames.flatMap(frame => Object.keys(frame.landmarks || {})))];
    return Object.fromEntries(names.map(name => {
      const observations = frames.map(frame => {
        const point = frame.landmarks?.[name], box = frame.segmentation?.boundingBox, mask = frame.segmentationMaskRef;
        if (!point || !box || !mask || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        const angle = frame.orientationDeg * Math.PI / 180;
        return { c: Math.cos(angle), s: Math.sin(angle), projected: (point.x - box.x - box.width / 2) * (mask.width / mask.height), y: (point.y - box.y) / box.height };
      }).filter(Boolean);
      if (observations.length < 2) return [name, null];
      const coefficients = observations.reduce((sum, observation) => ({
        cc: sum.cc + observation.c ** 2, ss: sum.ss + observation.s ** 2, cs: sum.cs + observation.c * observation.s,
        cp: sum.cp + observation.c * observation.projected, sp: sum.sp + observation.s * observation.projected, y: sum.y + observation.y
      }), { cc: 0, ss: 0, cs: 0, cp: 0, sp: 0, y: 0 });
      const determinant = coefficients.cc * coefficients.ss - coefficients.cs ** 2;
      if (Math.abs(determinant) < 1e-6) return [name, null];
      return [name, {
        x: ((coefficients.cp * coefficients.ss - coefficients.sp * coefficients.cs) / determinant) * physicalScale,
        y: (1 - coefficients.y / observations.length) * physicalScale,
        z: ((coefficients.sp * coefficients.cc - coefficients.cp * coefficients.cs) / determinant) * physicalScale,
        confidence: observations.length / frames.length,
        sourceFrameCount: observations.length
      }];
    }));
  }

  class SilhouetteVisualHullReconstructionProvider {
    async reconstruct(input) {
      const frames = input?.frames || [];
      requireFrames(frames);
      // Kept deliberately modest for mobile browsers. The output is a dense,
      // closed voxel-surface mesh, not landmark tubes or a synthetic body.
      const resolution = { x: 28, y: 56, z: 28, halfWidth: .42 };
      const carved = carveVisualHull(frames, resolution);
      const occupancyRatio = carved.occupied / (resolution.x * resolution.y * resolution.z);
      if (carved.occupied < 250 || occupancyRatio > .62) throw new Error('Silhouette intersection did not converge to a plausible body volume.');
      const heightInches = knownHeight(input.calibration);
      const scale = heightInches || 1;
      const mesh = surfaceFromCells(carved, resolution, scale);
      const anatomicalJoints = anatomicalJointsInMeshSpace(frames, scale);
      if (!mesh.vertices.length || !mesh.faces.length || mesh.faces.some(index => index < 0 || index >= mesh.vertices.length / 3)) throw new Error('Generated surface failed mesh-integrity validation.');
      const landmarkConfidence = average(frames, 'landmarkReliability');
      const silhouetteConfidence = average(frames, 'segmentationQuality');
      const visibilityConfidence = average(frames, 'bodyVisibility');
      const confidence = clamp(.35 + landmarkConfidence * .25 + silhouetteConfidence * .25 + visibilityConfidence * .15, 0, 1);
      if (confidence < .7) throw new Error('Frame confidence is too low for dense reconstruction.');
      return {
        status: 'success: experimental silhouette visual-hull mesh',
        mesh: { ...mesh, coordinateUnit: heightInches ? 'in' : 'normalized body-height units', topology: 'closed voxel visual hull', nearWatertight: true },
        vertices: mesh.vertices,
        faces: mesh.faces,
        joints: { anatomical: anatomicalJoints, perFrameWorldLandmarks: frames.map(frame => ({ frameId: frame.id, worldLandmarks: frame.worldLandmarks })) },
        pose: { anatomicalJoints, perFrameWorldLandmarks: frames.map(frame => ({ frameId: frame.id, landmarks: frame.worldLandmarks })) },
        shape: { method: 'multi-view silhouette visual hull', resolution, occupiedCells: carved.occupied, occupancyRatio },
        scale: { source: heightInches ? 'tape-measured height' : 'unscaled reconstruction units', reconstructionHeightUnits: 1, inchesPerReconstructionHeightUnit: heightInches, transformAppliedToVertices: Boolean(heightInches) },
        confidence,
        diagnostics: { sourceFrameIds: frames.map(frame => frame.id), angularAssumption: 'stationary camera; subject rotates at guided orientations', silhouetteConfidence, landmarkConfidence, visibilityConfidence }
      };
    }
  }

  window.tailorScanReconstruction = {
    createProvider: () => new SilhouetteVisualHullReconstructionProvider(),
    license: { dependency: 'none', method: 'project-owned silhouette visual-hull implementation', commercialStatus: 'no external body-model license required' }
  };
}());
