(function exposeImageResolution(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.imageResolutionModel = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  const PROXY_TIERS = Object.freeze([1024, 2048, 4096]);
  const ORIGINAL_TIER = 'original';
  const CLARITY_MARGIN = 1.25;
  const MIN_PREFERRED_TIER_COVERAGE = 0.85;

  function sourceLongEdge(width, height) {
    const values = [Number(width), Number(height)].filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : 0;
  }

  function availableTiers(width, height) {
    const longEdge = sourceLongEdge(width, height);
    return [
      ...PROXY_TIERS.filter((tier) => longEdge > tier),
      ORIGINAL_TIER
    ];
  }

  function chooseTier(width, height, requiredLongEdge) {
    const preferred = Number.isFinite(requiredLongEdge) && requiredLongEdge > 0
      ? requiredLongEdge
      : 1;
    const tiers = availableTiers(width, height);
    const preferredIndex = tiers.findIndex(
      (tier) => tier === ORIGINAL_TIER || tier >= preferred
    );
    const selectedIndex = preferredIndex < 0 ? tiers.length - 1 : preferredIndex;
    const immediatelyLowerTier = tiers[selectedIndex - 1];
    const physical = preferred / CLARITY_MARGIN;
    if (typeof immediatelyLowerTier === 'number'
      && immediatelyLowerTier >= physical
      && immediatelyLowerTier >= preferred * MIN_PREFERRED_TIER_COVERAGE) {
      return immediatelyLowerTier;
    }
    return tiers[selectedIndex] || ORIGINAL_TIER;
  }

  function physicalLongEdge(object, canvasScale, devicePixelRatio = 1) {
    const displayedLongEdge = sourceLongEdge(object?.width, object?.height)
      * (Number.isFinite(canvasScale) && canvasScale > 0 ? canvasScale : 1);
    const pixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
    return displayedLongEdge * pixelRatio;
  }

  function requiredLongEdge(object, canvasScale, devicePixelRatio = 1) {
    return physicalLongEdge(object, canvasScale, devicePixelRatio) * CLARITY_MARGIN;
  }

  function tierRank(tier) {
    if (tier === ORIGINAL_TIER) return PROXY_TIERS.length + 1;
    const index = PROXY_TIERS.indexOf(Number(tier));
    return index < 0 ? 0 : index + 1;
  }

  return {
    CLARITY_MARGIN,
    MIN_PREFERRED_TIER_COVERAGE,
    ORIGINAL_TIER,
    PROXY_TIERS,
    availableTiers,
    chooseTier,
    physicalLongEdge,
    requiredLongEdge,
    sourceLongEdge,
    tierRank
  };
}));
