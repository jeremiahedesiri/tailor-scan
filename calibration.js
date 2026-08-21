(function exposeCalibration(root) {
  function createHeightInput(height_inches) {
    if (!Number.isFinite(height_inches)) throw new TypeError('Standing height must be a finite number of inches.');
    if (height_inches <= 0) throw new RangeError('Standing height must be greater than zero.');
    return Object.freeze({ height_inches, unit: 'in', purpose: 'known_standing_height' });
  }
  root.tailorScanCalibration = Object.freeze({ createHeightInput });
})(typeof window === 'undefined' ? globalThis : window);
