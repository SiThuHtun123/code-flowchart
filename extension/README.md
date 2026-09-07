# Code Flowchart

**See what your code actually does.** Open a file, click one button, and get a
flowchart — with every step explained in plain English or Japanese.

Built for people learning to program, and for anyone staring at a function
wondering which branch runs when.

![A Python method rendered as a flowchart, with each step written in plain English](https://raw.githubusercontent.com/SiThuHtun123/code-flowchart/main/docs/example-chart.png)

---

## Getting started

Open any supported file, then click the flowchart icon in the editor's title
bar, top right:

![The flowchart icon in the VS Code editor title bar](https://raw.githubusercontent.com/SiThuHtun123/code-flowchart/main/docs/toolbar-button.png)

The chart opens beside your code and follows along as you type.

No icon? It only appears for the languages listed below — check the file's
language mode in the status bar. You can also run **Show Flowchart** from the
Command Palette (`Ctrl+Shift+P`).

---

## What it does

**One click.** A flowchart icon appears in the editor title bar for any
supported file. Click it and the chart opens beside your code.

**Plain language, not syntax.** `d * d <= n` becomes *"d × d is at most n?"*.
`is_prime = True` becomes *"set is_prime to true"*. Switch to Japanese, or turn
it off entirely for raw code.

| Code | English | 日本語 |
|---|---|---|
| `d * d <= n` | d × d is at most n? | d × d は n 以下？ |
| `is_prime = True` | set is_prime to true | is_prime を 真 にする |
| `for n in numbers` | for each n in numbers | numbers の各 n について |
| `return None` | give back nothing | 何も返さない |

**It tells you when code can't run.** Statements after a `return`, branches
that can never be taken — these show up struck through in red, with a count in
the toolbar. That's a class of bug you cannot see by reading.

**Complexity, at a glance.** Every chart shows its decision count and
cyclomatic complexity — green under 6, amber to 10, red beyond. A quick answer
to *"is this function doing too much?"*

**It handles real code.** Nested loops, `break` and `continue` landing in the
right place, `try`/`except`/`finally`, `switch`, `elif` chains. The hard cases
are the ones worth drawing.

---

## Languages

Python · JavaScript · TypeScript · TSX · Java · C · C++ · C# · Go · Rust ·
PHP · Ruby

Parsing is powered by [tree-sitter](https://tree-sitter.github.io/), bundled
with the extension. Nothing to install.

---

## Using it

| Action | How |
|---|---|
| Open the chart | Click the flowchart icon in the editor title bar |
| Jump to a line | Click any box |
| Fold a loop or branch | Double-click it, or use its **−** badge |
| Fold everything | **Collapse all** in the toolbar |
| Pick a function | The **Function** dropdown — one chart per function |
| Save as an image | **Export** |
| Zoom | **+** / **−** / **Fit**, or Ctrl + scroll |

The chart updates as you type. Move your cursor in the editor and the matching
box highlights.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| `codeFlowchart.language` | `auto` | `en`, `ja`, or `code` for raw syntax. `auto` follows VS Code's display language. |
| `codeFlowchart.liveUpdate` | `true` | Re-render as you type. |

---

## Limits worth knowing

- **Functions over ~80 steps** show a warning first, with a *"show it anyway"*
  option. A chart that large is usually telling you to split the function.
- **Files over 5,000 lines** are skipped.
- **`switch` fall-through** isn't drawn. Cases are shown as independent
  branches, which is how they behave when each one `break`s — and drawing the
  fall-through edges makes the chart much harder to read.
- **`try`/`except`** is drawn as *"body runs, then: did an error happen?"* A
  true control-flow graph would branch to the handler from every statement in
  the block, which is accurate and unreadable.

---

## Building from source

```bash
npm install
node scripts/fetch-wasm.js   # downloads the tree-sitter grammars (~14MB)
npm run compile
```

Then press **F5** in VS Code to launch a window with the extension loaded.

The grammar WASM files aren't committed — they're binaries reproducible from
npm, and `fetch-wasm.js` pulls them with `npm pack` rather than installing the
packages, since several of them try to build native bindings that this project
doesn't need.

---

## Feedback

Found a chart that doesn't match your code? That's the bug worth reporting —
[open an issue](https://github.com/SiThuHtun123/code-flowchart/issues) with the
snippet and what you expected.
