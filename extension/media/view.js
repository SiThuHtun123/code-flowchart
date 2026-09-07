// Webview side: renders Mermaid charts and talks to the extension.

const vscode = acquireVsCodeApi();
const chartEl = document.getElementById('chart');
const toolbarEl = document.getElementById('toolbar');

// Surface script errors in the panel — a silent failure here just looks like
// a blank flowchart, which is impossible to diagnose from the outside.
window.addEventListener('error', e => {
  chartEl.innerHTML = `<div class="error">Flowchart error: ${
    String(e.message)} (${String(e.filename).split('/').pop()}:${e.lineno})</div>`;
});

let charts = [];
let current = 0;

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  flowchart: {
    curve: 'linear',       // straight edges read more clearly than curves
    useMaxWidth: false,
    nodeSpacing: 25,       // tighter than the default 50
    rankSpacing: 35,
    padding: 6,
    wrappingWidth: 180,    // wrap long labels instead of one very wide box
  },
  themeVariables: {
    // Pull from the VS Code theme so it matches light and dark.
    primaryColor: getVar('--vscode-editor-background', '#fff'),
    primaryTextColor: getVar('--vscode-editor-foreground', '#000'),
    lineColor: getVar('--vscode-editorLineNumber-foreground', '#888'),
    fontFamily: getVar('--vscode-editor-font-family', 'sans-serif'),
    fontSize: '15px',   // larger than Mermaid's default; these get scaled down
  },
});

function getVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

window.addEventListener('message', async event => {
  const msg = event.data;

  if (msg.command === 'render') {
    const previous = charts[current]?.name;
    charts = msg.charts;

    // Keep the user on the chart they were viewing across re-renders; on a
    // first render, open the most complex function rather than whichever
    // happens to be declared first — a 3-box helper tells you nothing.
    const sameChart = charts.findIndex(c => c.name === previous);
    current = sameChart >= 0 ? sameChart : mostInteresting(charts);

    clearBanner();
    renderToolbar();
    await renderChart();
    showHintsOnce();
  }

  if (msg.command === 'error') {
    chartEl.innerHTML = `<div class="error">${escapeHtml(msg.message)}</div>`;
  }

  if (msg.command === 'warn') {
    // The code is temporarily unparseable (usually mid-keystroke). Keep the
    // last good chart visible and just flag it — blanking the panel on every
    // half-typed line would be unusable with live update on.
    showBanner(msg);
  }

  if (msg.command === 'refold') {
    const chart = charts.find(c => c.name === msg.chart);
    if (chart) {
      chart.mermaid = msg.mermaid;
      chart.collapsed = msg.collapsed;
      renderToolbar();   // flips "Collapse all" <-> "Expand all"
      await renderChart();
    }
  }

  if (msg.command === 'highlight') {
    highlightByLine(msg.line);
  }
});

// Tell the extension the listener above is attached. Without this handshake
// the first render can be posted before this script has even loaded, and the
// message is dropped — leaving a permanently blank panel.
vscode.postMessage({ command: 'ready' });

function showBanner({ message, line, kind }) {
  let banner = document.getElementById('banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'banner';
    document.body.insertBefore(banner, chartEl);
  }
  const where = line ? ` (line ${line})` : '';
  const stale = charts.length > 0 ? ' — showing the last valid version' : '';
  banner.className = kind === 'too-large' ? 'banner blocking' : 'banner';
  banner.textContent = `${message}${where}${charts.length ? stale : ''}`;

  if (kind === 'too-large') {
    chartEl.innerHTML = '';
    charts = [];
    toolbarEl.innerHTML = '';
  }
}

function clearBanner() {
  const banner = document.getElementById('banner');
  if (banner) { banner.remove(); }
}

/**
 * A one-time hint strip. None of the interactions here are discoverable on
 * their own — the fold badges are small, and nothing suggests the nodes are
 * clickable. Shown once per viewer, then dismissed for good.
 */
function showHintsOnce() {
  let seen = false;
  try { seen = localStorage.getItem('flowchartHintsSeen') === '1'; } catch { /* private mode */ }
  if (seen || document.getElementById('hints') || charts.length === 0) { return; }

  const hints = document.createElement('div');
  hints.id = 'hints';
  hints.innerHTML = `
    <span><strong>Click</strong> a box to jump to that line</span>
    <span><strong>Double-click</strong> a loop or question to fold it</span>
    <span>Charts update as you type</span>
    <button id="hints-close" title="Dismiss">Got it</button>
  `;
  document.body.insertBefore(hints, chartEl);

  document.getElementById('hints-close').addEventListener('click', () => {
    hints.remove();
    try { localStorage.setItem('flowchartHintsSeen', '1'); } catch { /* ignore */ }
  });
}

/**
 * Index of the chart worth opening on: highest complexity, breaking ties by
 * node count. `(module)` loses to any real function of equal complexity,
 * since a script's top-level code is rarely what you opened the file for.
 */
function mostInteresting(list) {
  let best = 0;
  let bestScore = -1;
  list.forEach((c, i) => {
    const score = (c.score ?? 1) * 1000 + (c.nodeCount ?? 0) - (c.name === '(module)' ? 500 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function renderToolbar() {
  if (charts.length === 0) {
    toolbarEl.innerHTML = '';
    return;
  }

  // One chart per function, chosen here. Labelled and counted, because an
  // unlabelled dropdown is easy to miss — and missing it makes a file of ten
  // functions look like the extension only found one.
  const picker = charts.length > 1
    ? `<span class="picker-group">
         <label for="picker">Function</label>
         <select id="picker">${charts
           .map((c, i) => `<option value="${i}" ${i === current ? 'selected' : ''}>${
             escapeHtml(c.name)}${c.score > 1 ? `  (complexity ${c.score})` : ''}</option>`)
           .join('')}</select>
         <span class="picker-count">${current + 1} of ${charts.length}</span>
       </span>`
    : `<span class="chart-name">${escapeHtml(charts[0].name)}</span>`;

  const chart = charts[current];
  const level = chart.score <= 5 ? 'ok' : chart.score <= 10 ? 'warn' : 'high';

  toolbarEl.innerHTML = `
    ${picker}
    <span class="complexity ${level}">${escapeHtml(chart.complexity)}</span>
    ${chart.deadCode > 0
      ? `<span class="dead-warning" title="Line${
          chart.deadCodeLines.length === 1 ? '' : 's'} ${chart.deadCodeLines.join(', ')
        } can never run">⚠ ${chart.deadCode} unreachable</span>`
      : ''}
    <span class="legend">
      <span class="key"><i class="swatch terminal"></i>start / end</span>
      <span class="key"><i class="swatch decision"></i>question</span>
      <span class="key"><i class="swatch process"></i>action</span>
    </span>
    <span class="zoom">
      ${(chart.groups ?? []).length > 0
        ? `<button id="fold-all" title="Collapse or expand every loop and branch">${
            (chart.collapsed ?? []).length > 0 ? 'Expand all' : 'Collapse all'}</button>`
        : ''}
      <button id="zoom-out" title="Zoom out">−</button>
      <span id="zoom-level">${Math.round(zoom * 100)}%</span>
      <button id="zoom-in" title="Zoom in">+</button>
      <button id="fit" title="Fit to window">Fit</button>
      <button id="export" title="Save this chart as an image">Export</button>
    </span>
  `;

  const pickerEl = document.getElementById('picker');
  if (pickerEl) {
    pickerEl.addEventListener('change', async e => {
      current = Number(e.target.value);
      renderToolbar();
      await renderChart();
    });
  }
  document.getElementById('fit').addEventListener('click', fitToWindow);
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));

  document.getElementById('export').addEventListener('click', exportChart);

  const foldAllEl = document.getElementById('fold-all');
  if (foldAllEl) {
    foldAllEl.addEventListener('click', () => {
      const c = charts[current];
      // Collapse only OUTERMOST groups: folding an inner one too would be
      // redundant, since its members are already hidden by the outer fold.
      const expandAll = (c.collapsed ?? []).length > 0;
      vscode.postMessage({
        command: 'foldAll',
        chart: c.name,
        collapse: !expandAll,
      });
    });
  }
}

// Ctrl/Cmd + wheel zooms, matching the editor's own gesture.
document.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) { return; }
  e.preventDefault();
  setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });

/** Charts the user has chosen to render despite the size warning. */
const forced = new Set();

async function renderChart() {
  if (charts.length === 0) {
    chartEl.innerHTML = `
      <div class="empty">
        <p><strong>Nothing to chart yet.</strong></p>
        <p>This file has no functions and no top-level logic to follow.
           Write a function, or some code with an <code>if</code> or a loop,
           and the flowchart appears here as you type.</p>
      </div>`;
    return;
  }
  const chart = charts[current];

  // A very large function renders as an unreadable wall. Offer it rather
  // than forcing it.
  if (chart.tooBig && !forced.has(chart.name)) {
    chartEl.innerHTML = `
      <div class="too-big">
        <p><strong>${escapeHtml(chart.name)}</strong> has ${chart.nodeCount} steps.</p>
        <p>Charts this size are hard to read. Splitting this into smaller
           functions usually helps.</p>
        <button id="force">Show it anyway</button>
      </div>`;
    document.getElementById('force').addEventListener('click', async () => {
      forced.add(chart.name);
      await renderChart();
    });
    return;
  }

  try {
    const { svg } = await mermaid.render('graph', chart.mermaid);
    chartEl.innerHTML = svg;
    attachClickHandlers(chart.name);
    // Fit on first render of a chart so it opens fully visible instead of
    // scrolled off-screen. Once the user sets a zoom, respect it.
    if (userSetZoom) { applyZoom(); } else { fitToWindow(); }
  } catch (err) {
    chartEl.innerHTML = `<div class="error">${escapeHtml(String(err))}</div>`;
  }
}

function attachClickHandlers(graphName) {
  const chart = charts[current] ?? {};
  const groups = chart.groups ?? [];
  const collapsed = chart.collapsed ?? [];

  // Which group each header node owns, so clicking the header folds it.
  const byHeader = new Map();
  for (const g of groups) {
    if (!byHeader.has(g.header)) { byHeader.set(g.header, g); }
  }

  chartEl.querySelectorAll('.node').forEach(el => {
    const raw = extractNodeId(el.id);
    if (!raw) { return; }
    el.style.cursor = 'pointer';

    // A folded placeholder — click anywhere on it to expand.
    if (raw.startsWith('fold_')) {
      const groupId = raw.slice('fold_'.length);
      el.classList.add('folded');
      el.addEventListener('click', e => {
        e.stopPropagation();
        vscode.postMessage({ command: 'toggleFold', chart: graphName, groupId });
      });
      return;
    }

    const group = byHeader.get(raw);
    if (group) {
      el.classList.add('foldable');
      if (collapsed.includes(group.id)) { el.classList.add('is-folded'); }
      addFoldToggle(el, graphName, group);

      // The badge is small at the zoom levels people actually use, so
      // double-clicking anywhere on the header folds it too.
      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        vscode.postMessage({ command: 'toggleFold', chart: graphName, groupId: group.id });
      });
    }

    el.addEventListener('click', () => {
      vscode.postMessage({ command: 'goto', nodeId: `${graphName}::${raw}` });
    });
  });
}

/**
 * A small [-] / [+] badge on a group's header node. Kept separate from the
 * node's own click handler so folding never fires a jump-to-line.
 */
function addFoldToggle(nodeEl, graphName, group) {
  const shape = nodeEl.querySelector('rect, polygon, circle');
  if (!shape) { return; }

  // The badge is appended to nodeEl, so it must be positioned in nodeEl's
  // coordinate space. A shape can carry its own transform (Mermaid rotates
  // diamond polygons), so measuring the shape's own getBBox() puts the badge
  // in the wrong place — measure both and convert.
  const nodeBox = nodeEl.getBBox();
  const svgns = 'http://www.w3.org/2000/svg';
  const badge = document.createElementNS(svgns, 'g');
  badge.setAttribute('class', 'fold-toggle');
  // Top-right of the node, nudged inward so it overlaps the border.
  const x = nodeBox.x + nodeBox.width;
  const y = nodeBox.y + 2;
  badge.setAttribute('transform', `translate(${x}, ${y})`);

  const circle = document.createElementNS(svgns, 'circle');
  circle.setAttribute('r', '8');
  badge.appendChild(circle);

  const label = document.createElementNS(svgns, 'text');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('dy', '4');
  label.textContent = nodeEl.classList.contains('is-folded') ? '+' : '−';
  badge.appendChild(label);

  const title = document.createElementNS(svgns, 'title');
  title.textContent = `${group.size} steps inside`;
  badge.appendChild(title);

  badge.addEventListener('click', e => {
    e.stopPropagation();
    vscode.postMessage({ command: 'toggleFold', chart: graphName, groupId: group.id });
  });

  nodeEl.appendChild(badge);
}

function extractNodeId(domId) {
  // Mermaid ids look like "flowchart-n3-12" or "flowchart-fold_g1-7".
  const match = /-(n\d+|fold_g\d+)-/.exec(domId)
    || /^(n\d+|fold_g\d+)$/.exec(domId);
  return match ? match[1] : null;
}

function highlightByLine(line) {
  chartEl.querySelectorAll('.node.active').forEach(el => el.classList.remove('active'));
  const chart = charts[current];
  if (!chart || !chart.lines) { return; }

  // Find the node on this source line, or the nearest one above it.
  let best = null;
  let bestLine = -1;
  for (const [nodeId, nodeLine] of Object.entries(chart.lines)) {
    if (nodeLine <= line && nodeLine > bestLine) {
      bestLine = nodeLine;
      best = nodeId;
    }
  }
  if (!best) { return; }

  for (const el of chartEl.querySelectorAll('.node')) {
    if (extractNodeId(el.id) === best) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    }
  }
}

/**
 * Zoom. Fitting a wide graph to the panel width shrinks the text to nothing,
 * so the floor is 45% — past that, scrolling a legible chart beats squinting
 * at an illegible one.
 */
const MIN_READABLE_SCALE = 0.45;
let zoom = 1;
/** Set once the user picks a zoom, so auto-fit stops overriding them. */
let userSetZoom = false;

function applyZoom() {
  const svg = chartEl.querySelector('svg');
  if (!svg) { return; }
  svg.style.transformOrigin = 'top left';
  svg.style.transform = `scale(${zoom})`;
  // The wrapper has to grow with the scaled SVG or the panel won't scroll
  // far enough to reach the bottom of the chart.
  const box = svg.getBBox();
  chartEl.style.minWidth = `${box.width * zoom}px`;
  chartEl.style.minHeight = `${box.height * zoom}px`;
  const label = document.getElementById('zoom-level');
  if (label) { label.textContent = `${Math.round(zoom * 100)}%`; }
}

function fitToWindow() {
  const svg = chartEl.querySelector('svg');
  if (!svg) { return; }
  const box = svg.getBBox();
  if (!box.width || !box.height) { return; }

  const availableW = chartEl.clientWidth - 48;
  const availableH = chartEl.clientHeight - 48;
  // Fit BOTH axes: a chart that is merely tall shouldn't be zoomed up until
  // it overflows vertically. Cap at 1.5x so a three-node chart doesn't
  // balloon to fill the panel.
  const scale = Math.min(availableW / box.width, availableH / box.height, 1.5);
  zoom = Math.max(MIN_READABLE_SCALE, scale);
  applyZoom();
}

function setZoom(next) {
  zoom = Math.max(0.25, Math.min(3, next));
  userSetZoom = true;
  applyZoom();
}

/**
 * Hand the rendered SVG to the extension, which owns the save dialog —
 * a webview can't write files, and downloads are blocked in this sandbox.
 * Theme colours are inlined first so the exported file doesn't come out
 * invisible against a white background.
 */
function exportChart() {
  const svg = chartEl.querySelector('svg');
  if (!svg) { return; }

  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');           // drop the zoom transform

  const box = svg.getBBox();
  clone.setAttribute('width', Math.ceil(box.width));
  clone.setAttribute('height', Math.ceil(box.height));
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Resolve CSS variables to literal colours, and paint a background.
  const styles = getComputedStyle(document.documentElement);
  const fg = styles.getPropertyValue('--vscode-editor-foreground').trim() || '#000';
  const bg = styles.getPropertyValue('--vscode-editor-background').trim() || '#fff';

  // Order matters: both passes walk source and clone in parallel by index,
  // so nothing may be added or removed from the clone until they're done.
  inlineComputedColours(svg, clone);
  flattenForeignObjects(svg, clone, fg);

  // Fold badges are UI chrome, not part of the diagram. Empty foreignObjects
  // are Mermaid's placeholders for unlabelled edges — nothing to draw.
  clone.querySelectorAll('.fold-toggle').forEach(el => el.remove());
  clone.querySelectorAll('foreignObject').forEach(el => {
    if (!el.textContent.trim()) { el.remove(); }
  });

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `text { fill: ${fg}; font-family: sans-serif; }`;
  clone.insertBefore(style, clone.firstChild);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', box.x);
  rect.setAttribute('y', box.y);
  rect.setAttribute('width', box.width);
  rect.setAttribute('height', box.height);
  rect.setAttribute('fill', bg);
  clone.insertBefore(rect, style.nextSibling);

  vscode.postMessage({
    command: 'export',
    name: charts[current]?.name ?? 'flowchart',
    svg: new XMLSerializer().serializeToString(clone),
  });
}

/**
 * Replace Mermaid's <foreignObject> labels with real SVG <text>.
 *
 * Mermaid renders node text as HTML spans inside a foreignObject. Browsers
 * honour that, but standalone SVG viewers and converters ignore it entirely —
 * so an exported chart comes out with every label missing. Measuring the
 * original in the live DOM gives us the position each line should sit at.
 */
function flattenForeignObjects(source, clone, fg) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const originals = source.querySelectorAll('foreignObject');
  const copies = clone.querySelectorAll('foreignObject');

  for (let i = 0; i < copies.length && i < originals.length; i++) {
    const fo = copies[i];
    const spans = originals[i].querySelectorAll('span.nodeLabel, span, div');

    // Prefer the innermost elements that actually hold text.
    const lines = [];
    spans.forEach(s => {
      const text = s.textContent.trim();
      if (text && !s.querySelector('span, div')) { lines.push({ text, el: s }); }
    });
    if (lines.length === 0) { continue; }

    const foBox = originals[i].getBoundingClientRect();
    const group = document.createElementNS(SVGNS, 'g');

    lines.forEach((line, index) => {
      const box = line.el.getBoundingClientRect();
      const style = getComputedStyle(line.el);
      const size = parseFloat(style.fontSize) || 14;

      const text = document.createElementNS(SVGNS, 'text');
      // Position relative to the foreignObject's own coordinate system.
      const x = parseFloat(fo.getAttribute('x') || '0')
              + parseFloat(fo.getAttribute('width') || '0') / 2;
      const y = parseFloat(fo.getAttribute('y') || '0')
              + (box.top - foBox.top) + size * 0.8;

      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', `${size}px`);
      text.setAttribute('font-family', style.fontFamily || 'sans-serif');
      text.setAttribute('fill', style.color || fg);
      if (style.textDecorationLine.includes('line-through')) {
        text.setAttribute('text-decoration', 'line-through');
      }
      text.textContent = line.text;
      group.appendChild(text);
    });

    fo.parentNode.replaceChild(group, fo);
  }
}

/**
 * Copy computed fill/stroke onto the clone, since CSS variables and
 * color-mix() won't resolve outside the webview.
 *
 * `fill: none` must be preserved rather than skipped — dropping it makes
 * Mermaid's edge paths render as filled blobs.
 */
function inlineComputedColours(source, clone) {
  const from = source.querySelectorAll('*');
  const to = clone.querySelectorAll('*');
  for (let i = 0; i < from.length && i < to.length; i++) {
    const computed = getComputedStyle(from[i]);
    for (const prop of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity']) {
      const value = computed.getPropertyValue(prop);
      if (!value || value === 'normal') { continue; }
      const safe = (prop === 'fill' || prop === 'stroke') ? toRgba(value) : value;
      to[i].style.setProperty(prop, safe);
      // Presentation attributes beat inline styles in some renderers, so
      // set both and keep them in agreement.
      if (prop === 'fill' || prop === 'stroke') {
        to[i].setAttribute(prop, safe);
      }
    }
  }
}

/**
 * Normalise a computed colour to plain rgb()/rgba().
 *
 * The CSS in this webview uses color-mix(), which Chromium computes to
 * `color(srgb 0.45 0.78 0.56 / 0.35)`. That's valid CSS Color 4, but most
 * SVG renderers outside a browser don't parse it and silently drop the fill —
 * which is how exported charts ended up as empty outlines.
 */
function toRgba(value) {
  const match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i
    .exec(value.trim());
  if (!match) { return value; }

  const [r, g, b] = match.slice(1, 4).map(n => Math.round(parseFloat(n) * 255));
  const alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
