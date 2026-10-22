(function exposeZoomControls(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.zoomControls = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const MIN_ZOOM_SENSITIVITY = 0.5;
  const MAX_ZOOM_SENSITIVITY = 5;
  const DEFAULT_ZOOM_SENSITIVITY = 1;
  const ZOOM_SENSITIVITY_STEP = 0.1;
  const BASE_WHEEL_ZOOM_COEFFICIENT = 0.002;

  function normalizeZoomSensitivity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value < MIN_ZOOM_SENSITIVITY || value > MAX_ZOOM_SENSITIVITY) {
      return DEFAULT_ZOOM_SENSITIVITY;
    }
    return Number((Math.round(value / ZOOM_SENSITIVITY_STEP) * ZOOM_SENSITIVITY_STEP).toFixed(1));
  }

  function formatZoomSensitivity(value) {
    return `${normalizeZoomSensitivity(value).toFixed(1)}×`;
  }

  function wheelZoomFactor(deltaY, deltaUnit, sensitivity) {
    return Math.exp(
      -deltaY
      * deltaUnit
      * BASE_WHEEL_ZOOM_COEFFICIENT
      * normalizeZoomSensitivity(sensitivity)
    );
  }

  function gestureZoomFactor(scale, sensitivity) {
    const gestureScale = typeof scale === 'number' && Number.isFinite(scale) && scale > 0
      ? scale
      : 1;
    return Math.pow(gestureScale, normalizeZoomSensitivity(sensitivity));
  }

  return Object.freeze({
    BASE_WHEEL_ZOOM_COEFFICIENT,
    DEFAULT_ZOOM_SENSITIVITY,
    MAX_ZOOM_SENSITIVITY,
    MIN_ZOOM_SENSITIVITY,
    ZOOM_SENSITIVITY_STEP,
    formatZoomSensitivity,
    gestureZoomFactor,
    normalizeZoomSensitivity,
    wheelZoomFactor
  });
}));
