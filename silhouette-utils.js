(function exposeSilhouetteUtils(root) {
  function validate(mask) {
    if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width <= 0 || mask.height <= 0 || !mask.data || mask.data.length !== mask.width * mask.height) throw new TypeError('A rectangular person mask is required.');
  }
  function get_mask_row_intersections(mask, y, threshold = .5) {
    validate(mask);
    if (!Number.isInteger(y) || y < 0 || y >= mask.height) throw new RangeError('Mask row is outside the image.');
    const runs = []; let start = null;
    for (let x = 0; x <= mask.width; x += 1) {
      const foreground = x < mask.width && mask.data[y * mask.width + x] >= threshold;
      if (foreground && start === null) start = x;
      if (!foreground && start !== null) { runs.push({ left: start, right: x - 1 }); start = null; }
    }
    return runs;
  }
  function boundary(mask, y, side, threshold) {
    const runs = get_mask_row_intersections(mask, y, threshold);
    if (!runs.length) return null;
    const x = side === 'left' ? runs[0].left : runs[runs.length - 1].right;
    return { x, y };
  }
  const get_left_boundary = (mask, y, threshold = .5) => boundary(mask, y, 'left', threshold);
  const get_right_boundary = (mask, y, threshold = .5) => boundary(mask, y, 'right', threshold);
  function extreme(mask, fromTop, threshold = .5) {
    validate(mask);
    for (let offset = 0; offset < mask.height; offset += 1) {
      const y = fromTop ? offset : mask.height - 1 - offset;
      const runs = get_mask_row_intersections(mask, y, threshold);
      if (runs.length) return { x: (runs[0].left + runs[runs.length - 1].right) / 2, y };
    }
    return null;
  }
  const get_topmost_subject_point = (mask, threshold = .5) => extreme(mask, true, threshold);
  const get_bottommost_subject_point = (mask, threshold = .5) => extreme(mask, false, threshold);
  root.tailorScanSilhouetteUtils = Object.freeze({ get_topmost_subject_point, get_bottommost_subject_point, get_left_boundary, get_right_boundary, get_mask_row_intersections });
})(typeof window === 'undefined' ? globalThis : window);
