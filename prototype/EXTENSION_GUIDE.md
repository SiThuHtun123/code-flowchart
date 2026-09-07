# Code → Flowchart VS Code Extension

## The four stages

```
source code → [1] parse to AST → [2] build CFG → [3] emit Mermaid → [4] render in webview
```

Stage 2 is the real work (see `cfg.py`). Stages 1, 3, 4 use existing tools.

---

## Setting up the extension

```bash
npm install -g yo generator-code
yo code
# → New Extension (TypeScript)
# → name: code-flowchart
```

Press F5 in VS Code. A new window opens with your extension loaded. That's the dev loop.

### Project shape

```
code-flowchart/
├── package.json          # commands, activation events, menus
├── src/
│   ├── extension.ts      # entry point: activate()
│   ├── parser.ts         # stage 1: source → AST (tree-sitter)
│   ├── cfg.ts            # stage 2: AST → nodes + edges   ← the hard part
│   ├── mermaid.ts        # stage 3: CFG → Mermaid text
│   └── panel.ts          # stage 4: webview management
└── media/
    └── view.html         # webview: renders Mermaid, handles clicks
```

---

## Stage 1: Parsing

Two options:

**tree-sitter (recommended)** — `web-tree-sitter` + `tree-sitter-python.wasm`.
Self-contained, no Python dependency on the user's machine, incremental
(fast re-parse on keystroke), error-tolerant (works on half-typed code),
and grammars exist for every language → your multi-language path.

**Shell out to Python** — bundle a script using Python's `ast` module.
Simpler to write, but requires the user to have Python installed.
Fine for a prototype, weak for a shipped extension.

---

## Stage 2: AST → CFG

Port `cfg.py` to TypeScript. The key design idea:

> Every visit function takes the list of **loose ends** (nodes whose outgoing
> edge isn't decided yet) and returns the new loose ends after handling the
> statement.

That single convention is what makes arbitrary nesting work. Handle:

| Construct | CFG shape |
|---|---|
| sequence | chain nodes |
| `if/else` | diamond → two branches → merge |
| `while`/`for` | diamond, body, back-edge to condition |
| `break` | edge out of loop; returns `[]` |
| `continue` | edge back to loop condition; returns `[]` |
| `return` | terminal node; returns `[]` |
| `try/except` | do this LAST — it's the messy one |

Store the source line on every node — that's what makes navigation work.

---

## Stage 3: Emit Mermaid

```
flowchart TD
    n1(["start"])
    n2{"x > 0"}
    n2 -->|yes| n3
```

Shapes: `["..."]` process, `{"..."}` decision, `(["..."])` terminal.
Escape quotes in labels.

---

## Stage 4: Webview

```typescript
const panel = vscode.window.createWebviewPanel(
  'flowchart', 'Flowchart', vscode.ViewColumn.Beside,
  { enableScripts: true }
);
panel.webview.html = getHtml(mermaidText);
```

Inside the webview, load Mermaid and render. Then wire the two directions:

**Click node → jump to line.** Webview posts `{command:'goto', line: 42}`;
extension calls `revealRange` on the editor.

**Cursor moves → highlight node.** `onDidChangeTextEditorSelection` →
post `{command:'highlight', line}` → webview adds a CSS class.

That bidirectional link is what makes it a *tool* rather than a picture.
It's also what a CLI wrapper fundamentally cannot do.

---

## Live updates

```typescript
vscode.workspace.onDidChangeTextDocument(debounce(update, 300));
```

Re-parsing on every keystroke is too slow. 300ms debounce + tree-sitter's
incremental parsing keeps it responsive.

---

## The hard parts (plan for these)

1. **Big files.** A 500-line file is an unreadable wall. Need per-function
   view and/or collapsible nodes. Design for this EARLY — it's the difference
   between a toy and a tool.
2. **Deep nesting.** Loop in condition in try. The loose-ends convention
   handles it if you're disciplined about recursion.
3. **Layout quality.** Mermaid's auto-layout is decent but not great.
   ELK.js gives better results for more work.
4. **`try/except`, comprehensions, `async`.** Ugly graphs. Simplify
   deliberately or handle last.

---

## Six-person split

| Person | Area |
|---|---|
| 1–2 | CFG builder (biggest piece — pair on it) |
| 3 | tree-sitter integration + multi-language |
| 4 | Webview rendering, pan/zoom, styling |
| 5 | Editor integration: navigation, highlighting, live update |
| 6 | Export (PNG/SVG/Mermaid), settings, tests, docs |

---

## Build order

1. Command that dumps Mermaid text for the open file into the output channel
2. Webview that renders it
3. Click-to-navigate
4. Live update on edit
5. Cursor-to-node highlighting
6. Collapsing / per-function view
7. Second language (proves the tree-sitter architecture)
8. Export + polish

Each step leaves you with something demoable.

---

## Publishing

```bash
npm install -g @vscode/vsce
vsce package        # → .vsix, installable locally
vsce publish        # → Marketplace (needs a publisher account)
```

Install counts make good evidence for a presentation.
