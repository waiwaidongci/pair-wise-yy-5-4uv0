// 样片档案：登记、持久化、基准判定。不管计算细节（交给 Shrinkage），也不管页面。
window.SampleArchive = (() => {
  const KEY = "zfl31Samples";
  let samples = JSON.parse(localStorage.getItem(KEY) || "[]");

  function persist() {
    localStorage.setItem(KEY, JSON.stringify(samples));
  }

  // 方案指纹：画布行列 + 经纬密。任一变化，旧样片即失效。
  function signatureOf(state) {
    return [state.cols, state.rows, state.warpDensity, state.weftDensity].join("/");
  }

  function list() {
    return [...samples].sort((a, b) => b.createdAt - a.createdAt);
  }

  function find(createdAt) {
    return samples.find(s => s.createdAt === createdAt) || null;
  }

  // 同一方案只认最近一次“通过”的样片为基准。
  function baselineFor(signature) {
    const passed = samples.filter(s => s.signature === signature && s.status === "passed");
    if (!passed.length) return null;
    return passed.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
  }

  // 登记样片：算出缩率；无基准直接通过，有基准且偏差超两成则停在待复测。
  function register({ id, greigeWidth, greigeLength, washedWidth, washedLength }, state) {
    const signature = signatureOf(state);
    const shrink = Shrinkage.computeShrinkage(greigeWidth, greigeLength, washedWidth, washedLength);
    const base = baselineFor(signature);
    const status = base && Shrinkage.beyondTolerance(shrink, base.shrink) ? "pending" : "passed";
    const sample = {
      id,
      signature,
      status,
      shrink,
      cols: state.cols,
      rows: state.rows,
      warpDensity: state.warpDensity,
      weftDensity: state.weftDensity,
      greigeWidth,
      greigeLength,
      washedWidth,
      washedLength,
      createdAt: Date.now()
    };
    samples.push(sample);
    persist();
    return { sample, base };
  }

  // 重排前校验基准：必须是通过样、指纹与当前一致、且是该方案最近一次通过。
  function validateBaseline(sample, state) {
    if (!sample) return "未选择样片，请在历史样片中选择有效基准。";
    if (sample.status !== "passed") return "样片 " + sample.id + " 停在待复测，不能作基准。";
    if (sample.signature !== signatureOf(state)) return "画布行列或经纬密已变化，样片 " + sample.id + " 的基准已失效。";
    const latest = baselineFor(sample.signature);
    if (!latest || latest.createdAt !== sample.createdAt) return "同一方案只认最近一次通过的样片，样片 " + sample.id + " 已被取代。";
    return null;
  }

  return { list, find, register, baselineFor, validateBaseline, signatureOf };
})();
