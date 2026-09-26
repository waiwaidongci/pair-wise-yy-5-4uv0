// 洗缩计算规则：只负责缩率与网格换算，不碰存储和页面。
window.Shrinkage = (() => {
  // 新样片与基准缩率允许的相对偏差：两成。
  const TOLERANCE = 0.2;

  // 缩率 = (坯布尺寸 - 洗后尺寸) / 坯布尺寸，正值表示收缩。
  function rate(greige, washed) {
    return (greige - washed) / greige;
  }

  // 宽向对应经向列（幅宽），长向对应纬向行（织长）。
  function computeShrinkage(greigeWidth, greigeLength, washedWidth, washedLength) {
    return {
      width: rate(greigeWidth, washedWidth),
      length: rate(greigeLength, washedLength)
    };
  }

  // 相对偏差判定；基准缩率接近 0 时退化为绝对差，避免除零。
  function deviates(next, base, tolerance = TOLERANCE) {
    const diff = Math.abs(next - base);
    const scale = Math.abs(base);
    return diff > (scale < 1e-9 ? tolerance : scale * tolerance);
  }

  // 宽、长任一方向缩率偏差超过两成即视为超差。
  function beyondTolerance(next, base, tolerance = TOLERANCE) {
    return deviates(next.width, base.width, tolerance) ||
           deviates(next.length, base.length, tolerance);
  }

  // 按成品尺寸反推织造网格：织造尺寸 = 成品尺寸 / (1 - 缩率)，再乘密度得行列数。
  function gridFromFinished(finishedWidth, finishedLength, warpDensity, weftDensity, shrink) {
    const greigeWidth = finishedWidth / (1 - shrink.width);
    const greigeLength = finishedLength / (1 - shrink.length);
    return {
      cols: Math.round(greigeWidth * warpDensity),
      rows: Math.round(greigeLength * weftDensity),
      greigeWidth,
      greigeLength
    };
  }

  return { TOLERANCE, computeShrinkage, beyondTolerance, gridFromFinished };
})();
