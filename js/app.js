// 页面操作层：画布交互、色线统计与洗缩校准面板的 DOM 逻辑。
// 计算规则在 js/shrinkage.js，样片档案在 js/samples.js，本文件只做页面装配。
const colors = ["#f7e7c4","#a6322d","#1f5f78","#d6a437","#355b38","#713d7b","#1e1b18","#e98c52"];
const $ = s => document.querySelector(s);
const grid = $("#grid");
const palette = $("#palette");
const stats = $("#stats");
const preview = $("#preview");
const risk = $("#risk");
const baselineInfo = $("#baselineInfo");
const sampleList = $("#sampleList");
const registerMsg = $("#registerMsg");
const recalcMsg = $("#recalcMsg");

const MIN_COLS = 6, MAX_COLS = 36, MIN_ROWS = 6, MAX_ROWS = 32;
let cols = 18, rows = 14, active = 1, block = "dot", dragging = false;
let cells = [];
let undo = [], redo = [];

// 经纬密与成品尺寸随方案一起持久化，换密度即换方案指纹。
let calib = Object.assign(
  { warpDensity: 5, weftDensity: 4, finishedWidth: 40, finishedLength: 60 },
  JSON.parse(localStorage.getItem("zfl31Calib") || "{}")
);
let warpDensity = calib.warpDensity, weftDensity = calib.weftDensity;
let picked = null; // 历史样片里选中的基准（createdAt）

function init(loadSaved = true) {
  const saved = loadSaved && JSON.parse(localStorage.getItem("zfl31Pattern") || "null");
  if (saved) { cols = saved.cols; rows = saved.rows; cells = saved.cells; }
  else { cols = Number($("#cols").value); rows = Number($("#rows").value); cells = Array(cols * rows).fill(0); }
  $("#cols").value = cols; $("#rows").value = rows;
  render();
}

function render() {
  palette.innerHTML = colors.map((c, i) => '<button class="swatch '+(i===active?'active':'')+'" data-color="'+i+'" style="background:'+c+'"></button>').join("");
  palette.querySelectorAll("[data-color]").forEach(el => el.onclick = () => { active = Number(el.dataset.color); render(); });
  grid.style.gridTemplateColumns = "repeat("+cols+", 1fr)";
  grid.innerHTML = cells.map((v, i) => '<div class="cell" data-i="'+i+'" style="background:'+colors[v]+'"></div>').join("");
  grid.querySelectorAll(".cell").forEach(el => {
    el.onpointerdown = () => { dragging = true; paint(Number(el.dataset.i)); };
    el.onpointerenter = () => { if (dragging) paint(Number(el.dataset.i)); };
  });
  window.onpointerup = () => dragging = false;
  renderStats();
  renderCalib();
}

function snapshot() { undo.push([...cells]); redo = []; if (undo.length > 50) undo.shift(); }

function paint(i) {
  snapshot();
  const targets = pattern(i);
  targets.forEach(t => { if (t >= 0 && t < cells.length) cells[t] = active; });
  render();
}

function pattern(i) {
  const x = i % cols, y = Math.floor(i / cols);
  if (block === "cross") return [i, idx(x-1,y), idx(x+1,y), idx(x,y-1), idx(x,y+1)].filter(v => v !== null);
  if (block === "diamond") return [idx(x,y-1), idx(x-1,y), i, idx(x+1,y), idx(x,y+1)].filter(v => v !== null);
  return [i];
}

function idx(x,y) { return x < 0 || x >= cols || y < 0 || y >= rows ? null : y * cols + x; }

function renderStats() {
  const counts = colors.map((_, i) => cells.filter(v => v === i).length);
  stats.innerHTML = counts.map((n, i) => '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:'+colors[i]+'"></span> 色线'+i+'</span><b>'+n+'</b></div>').join("");
  preview.innerHTML = Array.from({length: 36}, (_, i) => '<div class="mini" style="background:'+colors[cells[(i % 6) + Math.floor(i / 6) * cols] || colors[0]]+'"></div>').join("");
  const riskRows = [];
  for (let y = 0; y < rows; y++) {
    let switches = 0;
    for (let x = 1; x < cols; x++) if (cells[y*cols+x] !== cells[y*cols+x-1]) switches++;
    if (switches > cols * .62) riskRows.push(y + 1);
  }
  risk.innerHTML = riskRows.length ? '<p class="warning">第'+riskRows.join("、")+'行换色过密，可能断线。</p>' : '<p>暂无明显断线风险。</p>';
}

// ---------- 洗缩校准面板 ----------

function currentState() {
  return { cols, rows, warpDensity, weftDensity };
}

function pct(v) { return (v * 100).toFixed(1) + "%"; }
function fmtTime(ts) { return new Date(ts).toLocaleString("zh-CN"); }

function saveCalib() {
  calib = { warpDensity, weftDensity,
    finishedWidth: Number($("#finishedWidth").value) || calib.finishedWidth,
    finishedLength: Number($("#finishedLength").value) || calib.finishedLength };
  localStorage.setItem("zfl31Calib", JSON.stringify(calib));
}

function sampleStatus(s) {
  if (s.status === "pending") return { text: "待复测", cls: "warn" };
  if (s.signature !== SampleArchive.signatureOf(currentState())) return { text: "已失效（行列/密度变化）", cls: "off" };
  const base = SampleArchive.baselineFor(s.signature);
  if (base && base.createdAt === s.createdAt) return { text: "有效基准", cls: "ok" };
  return { text: "已被更新样片取代", cls: "off" };
}

function renderCalib() {
  const state = currentState();
  const base = SampleArchive.baselineFor(SampleArchive.signatureOf(state));
  baselineInfo.innerHTML = base
    ? '<p>当前基准：样片 <b>'+base.id+'</b>（宽缩 '+pct(base.shrink.width)+'、长缩 '+pct(base.shrink.length)+'，'+fmtTime(base.createdAt)+' 登记）</p>'
    : '<p class="warning">当前画布与密度下无有效基准，请先登记样片。</p>';

  const all = SampleArchive.list();
  if (!all.length) {
    sampleList.innerHTML = '<p>暂无样片记录。</p>';
    picked = null;
    return;
  }
  // 选中项已不在档案里时，回落到当前有效基准。
  if (!all.some(s => s.createdAt === picked)) picked = base ? base.createdAt : null;
  sampleList.innerHTML = all.map(s => {
    const st = sampleStatus(s);
    return '<label class="sample"><input type="radio" name="baselinePick" value="'+s.createdAt+'"'+(s.createdAt === picked ? ' checked' : '')+'>'+
      '<span><b>'+s.id+'</b> · 宽缩 '+pct(s.shrink.width)+' · 长缩 '+pct(s.shrink.length)+
      ' · '+s.cols+'×'+s.rows+' · 经密'+s.warpDensity+' 纬密'+s.weftDensity+
      ' · '+fmtTime(s.createdAt)+' <span class="tag '+st.cls+'">'+st.text+'</span></span></label>';
  }).join("");
  sampleList.querySelectorAll("input[name=baselinePick]").forEach(el => {
    el.onchange = () => { picked = Number(el.value); };
  });
}

function setMsg(el, text, ok) {
  el.className = "msg " + (ok ? "ok" : "err");
  el.textContent = text;
}

function positive(values) {
  return values.every(v => Number.isFinite(v) && v > 0);
}

function registerSample() {
  const id = $("#sampleId").value.trim();
  const greigeWidth = Number($("#greigeWidth").value);
  const greigeLength = Number($("#greigeLength").value);
  const washedWidth = Number($("#washedWidth").value);
  const washedLength = Number($("#washedLength").value);
  if (!id) return setMsg(registerMsg, "请填写样片编号。", false);
  if (!positive([greigeWidth, greigeLength, washedWidth, washedLength])) return setMsg(registerMsg, "坯布与洗后宽长都须为正数。", false);
  const { sample, base } = SampleArchive.register(
    { id, greigeWidth, greigeLength, washedWidth, washedLength }, currentState());
  picked = sample.createdAt;
  const shrinkText = "宽缩 "+pct(sample.shrink.width)+"、长缩 "+pct(sample.shrink.length);
  if (sample.status === "pending") {
    setMsg(registerMsg, "样片 "+id+" 登记："+shrinkText+"，与基准样片 "+base.id+" 的缩率相差超过两成，停在待复测。", false);
  } else {
    setMsg(registerMsg, "样片 "+id+" 登记："+shrinkText+"，已通过并设为当前基准。", true);
  }
  renderCalib();
}

function recalcGrid() {
  const finishedWidth = Number($("#finishedWidth").value);
  const finishedLength = Number($("#finishedLength").value);
  if (!positive([finishedWidth, finishedLength])) return setMsg(recalcMsg, "请填写正的成品宽长。", false);
  const sample = SampleArchive.find(picked);
  const err = SampleArchive.validateBaseline(sample, currentState());
  if (err) return setMsg(recalcMsg, err, false);
  const g = Shrinkage.gridFromFinished(finishedWidth, finishedLength, warpDensity, weftDensity, sample.shrink);
  if (g.cols < MIN_COLS || g.cols > MAX_COLS || g.rows < MIN_ROWS || g.rows > MAX_ROWS) {
    return setMsg(recalcMsg, "反推得 "+g.cols+"×"+g.rows+"，超出画布范围（列 "+MIN_COLS+"–"+MAX_COLS+"、行 "+MIN_ROWS+"–"+MAX_ROWS+"），未上机。", false);
  }
  snapshot();
  resizeCells(g.cols, g.rows);
  saveCalib();
  render();
  setMsg(recalcMsg, "按基准样片 "+sample.id+" 反推：织造幅宽 "+g.greigeWidth.toFixed(1)+"cm、织长 "+g.greigeLength.toFixed(1)+"cm，网格 "+g.cols+" 列 × "+g.rows+" 行已上机。旧基准随之失效，下一匹须重新登记样片。", true);
}

// 行列变化时保留重叠区域，其余补底色。
function resizeCells(newCols, newRows) {
  const next = Array(newCols * newRows).fill(0);
  for (let y = 0; y < Math.min(rows, newRows); y++) {
    for (let x = 0; x < Math.min(cols, newCols); x++) next[y * newCols + x] = cells[y * cols + x];
  }
  cells = next;
  cols = newCols;
  rows = newRows;
  $("#cols").value = cols;
  $("#rows").value = rows;
}

// ---------- 事件装配 ----------

document.querySelectorAll("[data-block]").forEach(btn => btn.onclick = () => block = btn.dataset.block);
$("#newBtn").onclick = () => { undo = []; redo = []; init(false); };
$("#undoBtn").onclick = () => { if (!undo.length) return; redo.push([...cells]); cells = undo.pop(); render(); };
$("#redoBtn").onclick = () => { if (!redo.length) return; undo.push([...cells]); cells = redo.pop(); render(); };
$("#saveBtn").onclick = () => localStorage.setItem("zfl31Pattern", JSON.stringify({ cols, rows, cells }));
$("#exportBtn").onclick = () => {
  const data = { cols, rows, cells, usage: colors.map((color, i) => ({ color, count: cells.filter(v => v === i).length })) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "brocade-pattern.json"; a.click(); URL.revokeObjectURL(a.href);
};
$("#registerBtn").onclick = registerSample;
$("#recalcBtn").onclick = recalcGrid;
function bindDensity(sel, get, set) {
  $(sel).value = get();
  $(sel).onchange = () => {
    const v = Number($(sel).value);
    if (Number.isFinite(v) && v > 0) { set(v); saveCalib(); renderCalib(); }
  };
}
bindDensity("#warpDensity", () => warpDensity, v => warpDensity = v);
bindDensity("#weftDensity", () => weftDensity, v => weftDensity = v);
$("#finishedWidth").value = calib.finishedWidth;
$("#finishedLength").value = calib.finishedLength;

init();
