(function exposeSilhouetteMeasurement() {
  const average = (a, b) => a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : (a || b || null);
  const between = (a, b, ratio) => a && b ? { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio } : null;
  const distance = (a, b) => a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null;
  const pathDistance = (points) => points.every(Boolean) ? points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0) : null;

  function anatomicalLandmarks(analysis) {
    const p = analysis.landmarks || {}, box = analysis.segmentation?.boundingBox;
    if (!box) throw new Error('A full-body silhouette bounding box is required.');
    const shoulderCenter = average(p.leftShoulder, p.rightShoulder), hipCenter = average(p.leftHip, p.rightHip);
    const ankleCenter = average(p.leftAnkle, p.rightAnkle), kneeCenter = average(p.leftKnee, p.rightKnee);
    const waistCenter = between(shoulderCenter, hipCenter, .62);
    const crotch = hipCenter && kneeCenter ? between(hipCenter, kneeCenter, .12) : hipCenter;
    return { ...p, headTop: { x: shoulderCenter?.x ?? box.x + box.width / 2, y: box.y }, floor: { x: ankleCenter?.x ?? box.x + box.width / 2, y: box.y + box.height }, shoulderCenter, hipCenter, waistCenter, crotch, ankleCenter, kneeCenter };
  }

  const definitions = [
    ['shoulder', 'front', l => distance(l.leftShoulder, l.rightShoulder)],
    ['shoulderToWaist', 'side', l => distance(l.shoulderCenter, l.waistCenter)],
    ['shoulderToHip', 'side', l => distance(l.shoulderCenter, l.hipCenter)],
    ['shoulderToElbow', 'front', l => pathDistance([l.leftShoulder, l.leftElbow])],
    ['shoulderToWrist', 'front', l => pathDistance([l.leftShoulder, l.leftElbow, l.leftWrist])],
    ['elbowToWrist', 'front', l => distance(l.leftElbow, l.leftWrist)],
    ['sleeve', 'front', l => pathDistance([l.leftShoulder, l.leftElbow, l.leftWrist])],
    ['waistToHip', 'side', l => distance(l.waistCenter, l.hipCenter)],
    ['waistToKnee', 'side', l => distance(l.waistCenter, l.kneeCenter)],
    ['waistToAnkle', 'side', l => distance(l.waistCenter, l.floor)],
    ['trouserLength', 'side', l => distance(l.waistCenter, l.floor)],
    ['outseam', 'side', l => distance(l.waistCenter, l.floor)],
    ['inseam', 'front', l => distance(l.crotch, l.ankleCenter)]
  ];

  function outline(mask, threshold = .5) {
    const { width, height, data } = mask, points = [];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (data[i] < threshold) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || data[i - 1] < threshold || data[i + 1] < threshold || data[i - width] < threshold || data[i + width] < threshold) points.push({ x: x / width, y: y / height });
    }
    return points;
  }

  function measure({ front, side = null, heightInches }) {
    if (!Number.isFinite(heightInches) || heightInches <= 0) throw new Error('A valid height is required for scale.');
    side ||= front;
    const analyses = { front, side }, landmarks = { front: anatomicalLandmarks(front), side: anatomicalLandmarks(side) };
    const scales = Object.fromEntries(Object.entries(analyses).map(([view, analysis]) => [view, heightInches / analysis.segmentation.boundingBox.height]));
    const measurements = { height: heightInches };
    const diagnostics = {};
    definitions.forEach(([name, view, calculate]) => {
      const raw = calculate(landmarks[view]);
      measurements[name] = Number.isFinite(raw) ? Math.round(raw * scales[view] * 1000) / 1000 : null;
      diagnostics[name] = { view, method: '2D anatomical landmark distance', scaleSource: 'imputed height ÷ detected head-to-floor silhouette height', landmarks: landmarks[view], rawNormalizedDistance: raw };
    });
    return { measurements, landmarks, outlines: { front: outline(front.segmentationMaskRef), side: outline(side.segmentationMaskRef) }, diagnostics, scale: scales };
  }
  window.tailorScanSilhouette = { measure, outline, anatomicalLandmarks };
})();
