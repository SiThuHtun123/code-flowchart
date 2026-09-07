import * as vscode from 'vscode';
import * as path from 'path';
import { CfgBuilder, toMermaid, Graph, NODE_WARN_THRESHOLD } from './cfg';
import { Lang, phrasesFor } from './i18n';
import { parse, ParseOutput } from './parser';
import { specForVscodeId } from './languages';

let panel: vscode.WebviewPanel | undefined;
let sourceEditor: vscode.TextEditor | undefined;
/** Node id -> source line, for click-to-navigate. */
let lineMap = new Map<string, number>();
/** Whether the panel's HTML has been installed this session. */
let htmlSet = false;
/** Most recent charts, replayed once the webview reports it is ready. */
let lastCharts: unknown[] = [];
/** Built graphs by chart name, so folds can re-render without reparsing. */
let lastGraphs = new Map<string, Graph>();
/** Which groups the user has folded, per chart. Survives re-renders. */
const collapsedByChart = new Map<string, string[]>();

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeFlowchart.show', () => showFlowchart(context))
  );

  // Live update: re-render as the user types.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(debounce((e: vscode.TextDocumentChangeEvent) => {
      const live = vscode.workspace.getConfiguration('codeFlowchart').get('liveUpdate', true);
      if (live && panel && sourceEditor && e.document === sourceEditor.document) {
        render(context, sourceEditor.document);
      }
    }, 300))
  );

  // Changing the language setting should redraw immediately.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codeFlowchart.language') && panel && sourceEditor) {
        render(context, sourceEditor.document);
      }
    })
  );

  // Cursor moves in the editor -> highlight the matching node.
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (!panel || e.textEditor !== sourceEditor) { return; }
      const line = e.selections[0].active.line + 1;
      panel.webview.postMessage({ command: 'highlight', line });
    })
  );
}

async function showFlowchart(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !specForVscodeId(editor.document.languageId)) {
    vscode.window.showWarningMessage(
      'Flowcharts are available for Python, JavaScript, TypeScript, Java, C, C++ and C#.'
    );
    return;
  }
  sourceEditor = editor;

  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'codeFlowchart',
      `Flowchart: ${path.basename(editor.document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      }
    );

    panel.onDidDispose(() => {
      panel = undefined;
      htmlSet = false;   // a fresh panel needs its HTML installed again
    });

    panel.webview.onDidReceiveMessage(async msg => {
      // The webview's scripts have loaded and it can receive messages now.
      if (msg.command === 'ready' && panel) {
        panel.webview.postMessage({ command: 'render', charts: lastCharts });
        return;
      }

      // Fold or unfold a group: re-emit just that chart's Mermaid, without
      // reparsing the file.
      if (msg.command === 'toggleFold' && panel) {
        const graph = lastGraphs.get(msg.chart);
        if (!graph) { return; }

        const open = collapsedByChart.get(msg.chart) ?? [];
        const next = open.includes(msg.groupId)
          ? open.filter(id => id !== msg.groupId)
          : [...open, msg.groupId];
        collapsedByChart.set(msg.chart, next);

        panel.webview.postMessage({
          command: 'refold',
          chart: msg.chart,
          mermaid: toMermaid(graph, next),
          collapsed: next,
        });
        return;
      }

      // Collapse or expand every foldable region at once.
      if (msg.command === 'foldAll' && panel) {
        const graph = lastGraphs.get(msg.chart);
        if (!graph) { return; }

        // Only the outermost groups: an inner group's members are already
        // hidden by its parent, so folding both changes nothing but adds noise.
        const outermost = graph.groups.filter(g =>
          !graph.groups.some(other =>
            other.id !== g.id && other.members.includes(g.header)));

        const next = msg.collapse ? outermost.map(g => g.id) : [];
        collapsedByChart.set(msg.chart, next);

        panel.webview.postMessage({
          command: 'refold',
          chart: msg.chart,
          mermaid: toMermaid(graph, next),
          collapsed: next,
        });
        return;
      }

      // Save the rendered chart. The webview owns the SVG; only the
      // extension host can show a save dialog and write to disk.
      if (msg.command === 'export') {
        const safeName = String(msg.name).replace(/[^\w.-]+/g, '_').replace(/_+$/, '');
        const target = await vscode.window.showSaveDialog({
          filters: { 'SVG image': ['svg'] },
          defaultUri: vscode.Uri.file(
            path.join(
              sourceEditor ? path.dirname(sourceEditor.document.fileName) : '',
              `${safeName || 'flowchart'}.svg`
            )
          ),
        });
        if (!target) { return; }

        await vscode.workspace.fs.writeFile(target, Buffer.from(msg.svg, 'utf8'));
        const open = await vscode.window.showInformationMessage(
          `Flowchart saved to ${path.basename(target.fsPath)}`, 'Open'
        );
        if (open === 'Open') {
          await vscode.commands.executeCommand('vscode.open', target);
        }
        return;
      }

      // Click a node -> jump to that line.
      if (msg.command === 'goto' && sourceEditor) {
        const line = lineMap.get(msg.nodeId);
        if (line === undefined) { return; }
        const pos = new vscode.Position(Math.max(0, line - 1), 0);
        sourceEditor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter
        );
        sourceEditor.selection = new vscode.Selection(pos, pos);
        vscode.window.showTextDocument(sourceEditor.document, sourceEditor.viewColumn);
      }
    });
  }

  panel.reveal(vscode.ViewColumn.Beside, true);
  await render(context, editor.document);
}

async function render(context: vscode.ExtensionContext, doc: vscode.TextDocument) {
  if (!panel) { return; }

  const spec = specForVscodeId(doc.languageId);
  if (!spec) { return; }

  const mediaDir = vscode.Uri.joinPath(context.extensionUri, 'media').fsPath;

  let parsed: ParseOutput;
  try {
    parsed = await parse(doc.getText(), spec, mediaDir);
  } catch (err) {
    panel.webview.postMessage({ command: 'error', message: String(err) });
    return;
  }

  if (parsed.error) {
    // A syntax error mid-typing is normal, not a failure. Keep the last good
    // chart on screen and show a small banner instead of blanking the panel.
    panel.webview.postMessage({
      command: 'warn',
      message: parsed.error,
      line: parsed.line,
      kind: parsed.kind ?? 'syntax',
    });
    return;
  }

  const lang = resolveLanguage();
  const phrases = phrasesFor(lang);

  lineMap = new Map();
  lastGraphs = new Map();

  const charts = (parsed.graphs ?? []).map(raw => {
    const graph: Graph = new CfgBuilder(lang).build(raw.name, raw.body, raw.line);
    lastGraphs.set(raw.name, graph);

    // Node -> source line, for click-to-navigate and cursor highlighting.
    const lines: Record<string, number> = {};
    for (const node of graph.nodes) {
      // Node ids restart per graph, so namespace them by graph name.
      lineMap.set(`${raw.name}::${node.id}`, node.line);
      lines[node.id] = node.line;
    }

    // Folds the user had open stay open across re-renders, so typing doesn't
    // reset the view. Group ids are stable for a given code shape.
    const collapsed = collapsedByChart.get(raw.name) ?? [];

    return {
      name: raw.name,
      mermaid: toMermaid(graph, collapsed),
      groups: graph.groups.map(g => ({
        id: g.id, header: g.header, kind: g.kind, size: g.members.length,
      })),
      collapsed,
      complexity: phrases.complexity(graph.decisions, graph.complexity),
      score: graph.complexity,
      nodeCount: graph.nodes.length,
      tooBig: graph.nodes.length > NODE_WARN_THRESHOLD,
      deadCode: graph.unreachable.length,
      deadCodeLines: graph.unreachable
        .map(id => graph.nodes.find(n => n.id === id)?.line)
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b),
      lines,
    };
  });

  lastCharts = charts;

  if (!htmlSet) {
    htmlSet = true;
    panel.webview.html = getHtml(panel.webview, context.extensionUri);
    // The webview posts 'ready' once its scripts have loaded and its message
    // listener is attached; sending before that would drop the payload.
    return;
  }

  panel.webview.postMessage({ command: 'render', charts });
}

/**
 * "auto" follows VS Code's display language, so a Japanese-locale user gets
 * Japanese without touching settings.
 */
function resolveLanguage(): Lang {
  const setting = vscode.workspace
    .getConfiguration('codeFlowchart')
    .get<string>('language', 'auto');

  if (setting === 'en' || setting === 'ja' || setting === 'code') {
    return setting;
  }
  return vscode.env.language.startsWith('ja') ? 'ja' : 'en';
}


function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media'));
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${mediaUri}/view.css">
</head>
<body>
  <div id="toolbar"></div>
  <div id="chart"></div>
  <script src="${mediaUri}/mermaid.min.js"></script>
  <script src="${mediaUri}/view.js"></script>
</body>
</html>`;
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | undefined;
  return ((...args: never[]) => {
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function deactivate() { /* nothing to clean up */ }
