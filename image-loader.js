(function exposeImageLoader(root) {
  function loadImage(source, ImageType = root.Image) {
    if (typeof source !== 'string' || !source.trim()) return Promise.reject(new TypeError('A non-empty image source is required.'));
    if (typeof ImageType !== 'function') return Promise.reject(new Error('Image decoding is unavailable in this environment.'));
    return new Promise((resolve, reject) => {
      const image = new ImageType();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to decode the selected image.'));
      image.src = source;
    });
  }
  root.tailorScanImages = Object.freeze({ loadImage });
})(typeof window === 'undefined' ? globalThis : window);
