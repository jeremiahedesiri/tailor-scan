(function exposeTorsoProfile(root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function axisX(axis, y) { const dy = axis.bottom.y - axis.top.y; return dy ? axis.top.x + (axis.bottom.x - axis.top.x) * ((y - axis.top.y) / dy) : axis.top.x; }
  function runsAt(component, y) {
    const runs = []; let start = null;
    for (let x = 0; x <= component.width; x += 1) { const on = x < component.width && component.data[y * component.width + x]; if (on && start === null) start = x; if (!on && start !== null) { runs.push({ left: start, right: x - 1 }); start = null; } }
    return runs;
  }
  function centerRun(component, y, centerX, maxHalfWidth = Infinity) {
    const runs = runsAt(component, y), containing = runs.find(run => run.left <= centerX && run.right >= centerX);
    if (!containing) return null;
    const left = Math.max(containing.left, Math.ceil(centerX - maxHalfWidth)), right = Math.min(containing.right, Math.floor(centerX + maxHalfWidth));
    return right > left ? { left, right, run_count: runs.length } : null;
  }
  function smooth(values, radius = 2) { return values.map((_, i) => { const slice = values.slice(Math.max(0, i - radius), i + radius + 1).filter(Number.isFinite); return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null; }); }
  function perpendicularSlice(component, rawPose, bodyAxis, imageY, maxHalfWidth) {
    const dx = bodyAxis.bottom.x - bodyAxis.top.x, dy = bodyAxis.bottom.y - bodyAxis.top.y, length = Math.hypot(dx, dy); if (!length) return null;
    const normal = { x: dy / length, y: -dx / length }, center = { x: axisX(bodyAxis, imageY), y: imageY }, sx = rawPose.image_width / component.width, sy = rawPose.image_height / component.height, samples = [];
    for (let offset = -Math.floor(maxHalfWidth); offset <= Math.floor(maxHalfWidth); offset += 1) { const point = { x: center.x + normal.x * offset, y: center.y + normal.y * offset }, mx = Math.round(point.x / sx), my = Math.round(point.y / sy), on = mx >= 0 && mx < component.width && my >= 0 && my < component.height && Boolean(component.data[my * component.width + mx]); samples.push({ offset, point, on }); }
    const centerIndex = samples.findIndex(s => s.offset === 0), runs = []; let start = null; for (let i = 0; i <= samples.length; i += 1) { const on = i < samples.length && samples[i].on; if (on && start === null) start = i; if (!on && start !== null) { runs.push({ start, end: i - 1 }); start = null; } }
    const run = runs.find(r => r.start <= centerIndex && r.end >= centerIndex); if (!run) return null; return { left: samples[run.start].point, right: samples[run.end].point, width: samples[run.end].offset - samples[run.start].offset + 1, run_count: runs.length, center };
  }
  function buildTorsoWidthProfile({ component, bodyAxis, rawPose, startY, endY, step = 1 }) {
    const sy = rawPose.image_height / component.height, shoulder = ['left_shoulder', 'right_shoulder'].map(n => rawPose.landmarks[n]).filter(Boolean), shoulderWidth = shoulder.length === 2 ? Math.hypot((shoulder[0].x - shoulder[1].x) * rawPose.image_width, (shoulder[0].y - shoulder[1].y) * rawPose.image_height) : rawPose.image_width * .3, maxHalf = shoulderWidth * .72;
    const samples = [], y0 = clamp(Math.round(startY / sy), 0, component.height - 1), y1 = clamp(Math.round(endY / sy), 0, component.height - 1);
    for (let y = y0; y <= y1; y += step) { const imageY = y * sy, slice = perpendicularSlice(component, rawPose, bodyAxis, imageY, maxHalf); if (!slice) { samples.push({ body_y: imageY, left_boundary: null, right_boundary: null, width_px: null, center_x: axisX(bodyAxis, imageY), confidence: 0, arm_separation_ambiguous: true }); continue; } const width = slice.width; samples.push({ body_y: imageY, left_boundary: slice.left, right_boundary: slice.right, width_px: width, center_x: slice.center.x, confidence: slice.run_count === 1 ? .9 : .72, arm_separation_ambiguous: slice.run_count === 1 && width >= shoulderWidth * 1.25 }); }
    const smoothed = smooth(samples.map(s => s.width_px)); return { samples: samples.map((sample, i) => ({ ...sample, smoothed_width_px: smoothed[i] })), unsmoothed_widths_px: samples.map(s => s.width_px), smoothing_radius_samples: 2, slice_method: 'center-connected silhouette run near tilted body axis', arm_exclusion_method: 'center-connected run with shoulder-width lateral bound' };
  }
  root.tailorScanTorsoProfile = Object.freeze({ axisX, runsAt, centerRun, perpendicularSlice, buildTorsoWidthProfile });
})(typeof window === 'undefined' ? globalThis : window);
