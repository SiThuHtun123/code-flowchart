/**
 * AST -> control-flow graph -> Mermaid.
 *
 * The core convention: every visit function takes the current "loose ends"
 * (nodes whose outgoing edge isn't decided yet) and returns the new loose
 * ends. `break` / `continue` / `return` return [] because nothing flows
 * through them. That single rule is what makes arbitrary nesting work.
 *
 * A loose end carries a PENDING LABEL — the text its eventual outgoing edge
 * should get. That's how "no" lands on an if-without-else and "done" on a
 * loop exit: the branch is known when the loose end is created, but the edge
 * itself isn't drawn until the parent connects it to whatever comes next.
 */

import { Lang, Phrases, phrasesFor, humanizeExpr } from './i18n';

export type Shape = 'process' | 'decision' | 'terminal';

export interface FlowNode {
  id: string;
  label: string;
  shape: Shape;
  line: number;      // 1-based source line, for click-to-navigate
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

/**
 * A foldable region: the body of a loop, conditional or try block.
 *
 * `header` is the node that stays visible when folded (the loop's condition,
 * say); `members` are the nodes hidden inside it. Folding replaces the
 * members with one summary node and reroutes the edges that crossed the
 * boundary.
 */
export interface Group {
  id: string;
  header: string;      // node id that owns this group
  kind: 'loop' | 'branch' | 'try';
  members: string[];   // node ids inside the body
  summary: string;     // label for the folded placeholder
}

export interface Graph {
  name: string;      // function name, or "(module)"
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: Group[];   // foldable regions
  unreachable: string[]; // node ids no path from start can reach — dead code
  decisions: number; // count of decision nodes
  complexity: number;// cyclomatic complexity = decisions + 1
}

/**
 * Past this many nodes a flowchart stops being readable and becomes a wall.
 * The webview offers a "show anyway" escape hatch rather than hard-blocking.
 */
export const NODE_WARN_THRESHOLD = 80;

/** A loose end: a node, plus the label its outgoing edge should carry. */
interface Exit {
  id: string;
  label?: string;
}

/** Minimal AST shape — matches what parse.py produces. */
export interface AstNode {
  type: string;
  line: number;
  text: string;              // source text for the label
  body?: AstNode[];
  orelse?: AstNode[];
  test?: string;             // condition text
  target?: string;           // assignment target / loop variable
  value?: string;            // assigned value
  iter?: string;             // thing being iterated
  op?: string;               // augmented-assignment operator
  name?: string;             // function name
  handlers?: AstNode[];      // except/catch clauses
  finalbody?: AstNode[];     // finally block
}

export class CfgBuilder {
  private nodes: FlowNode[] = [];
  private edges: FlowEdge[] = [];
  private groups: Group[] = [];
  private counter = 0;
  /** (continueTarget, breakCollector) for the enclosing loop */
  private loopStack: Array<{ cont: string; breaks: Exit[] }> = [];
  private p: Phrases;

  constructor(private lang: Lang = 'en') {
    this.p = phrasesFor(lang);
  }

  private newId(): string {
    return `n${++this.counter}`;
  }

  private addNode(label: string, shape: Shape, line: number): string {
    const id = this.newId();
    this.nodes.push({ id, label: truncate(label), shape, line });
    return id;
  }

  /** Wire every loose end to the target, using each one's pending label. */
  private connect(exits: Exit[], target: string): void {
    for (const exit of exits) {
      this.edges.push({ from: exit.id, to: target, label: exit.label });
    }
  }

  private expr(text: string | undefined): string {
    return humanizeExpr(text ?? '', this.lang);
  }

  /**
   * Visit a body and record every node it created as one foldable group.
   *
   * Node ids are handed out sequentially, so everything added between the
   * marks belongs to this body — including nested structures, which is what
   * makes folding an outer loop hide its inner loops too.
   */
  private visitGroup(
    stmts: AstNode[], entries: Exit[], header: string,
    kind: Group['kind'], summary: string
  ): Exit[] {
    const before = this.nodes.length;
    const ends = this.visitBody(stmts, entries);
    const members = this.nodes.slice(before).map(n => n.id);

    // A single-node body isn't worth a fold control.
    if (members.length > 1) {
      this.groups.push({
        id: `g${this.groups.length + 1}`,
        header, kind, members, summary,
      });
    }
    return ends;
  }

  // ---- statement dispatch --------------------------------------------------

  private visitBody(stmts: AstNode[], entries: Exit[]): Exit[] {
    let ends = entries;
    for (let i = 0; i < stmts.length; i++) {
      ends = this.visit(stmts[i], ends);
      if (ends.length === 0) {
        // Nothing flows past a return/break/continue. The statements after it
        // can never run — still render them, unconnected, so the chart SHOWS
        // the dead code rather than quietly omitting it.
        this.addUnreachable(stmts.slice(i + 1));
        break;
      }
    }
    return ends;
  }

  /** Render statements no path can reach, with no incoming edges. */
  private addUnreachable(stmts: AstNode[]): void {
    for (const stmt of stmts) {
      const before = this.nodes.length;
      this.visit(stmt, []);          // no entries -> no incoming edges
      // Only the first statement needs flagging if it created several nodes;
      // the reachability pass will catch the rest.
      if (this.nodes.length === before) { continue; }
    }
  }

  private visit(node: AstNode, entries: Exit[]): Exit[] {
    switch (node.type) {
      case 'If':       return this.visitIf(node, entries);
      case 'While':    return this.visitWhile(node, entries);
      case 'For':      return this.visitFor(node, entries);
      case 'CFor':     return this.visitCFor(node, entries);
      case 'Loop':     return this.visitLoop(node, entries);
      case 'IfNot':    return this.visitIf(node, entries, true);
      case 'Until':    return this.visitWhile(node, entries, true);
      case 'Break':    return this.visitBreak(node, entries);
      case 'Continue': return this.visitContinue(node, entries);
      case 'Return':   return this.visitReturn(node, entries);
      case 'Assign':   return this.visitAssign(node, entries);
      case 'AugAssign':return this.visitAugAssign(node, entries);
      case 'Expr':     return this.visitExpr(node, entries);
      case 'Try':      return this.visitTry(node, entries);
      case 'Switch':   return this.visitSwitch(node, entries);
      case 'With':     return this.visitWith(node, entries);
      case 'Raise':    return this.visitRaise(node, entries);
      case 'NestedDef':return this.visitNestedDef(node, entries);
      // Anything we don't model ('Other') renders as a plain step, shown
      // as-is rather than wrapped in "do ...".
      default:         return this.visitPlain(node, entries);
    }
  }

  private visitPlain(node: AstNode, entries: Exit[]): Exit[] {
    const id = this.addNode(this.expr(node.text), 'process', node.line);
    this.connect(entries, id);
    return [{ id }];
  }

  private visitAssign(node: AstNode, entries: Exit[]): Exit[] {
    const label = (this.lang === 'code' || !node.target)
      ? node.text
      : this.p.assign(node.target, this.expr(node.value));
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    return [{ id }];
  }

  private visitAugAssign(node: AstNode, entries: Exit[]): Exit[] {
    const label = (this.lang === 'code' || !node.target)
      ? node.text
      : this.p.augAssign(node.target, node.op ?? '+', this.expr(node.value));
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    return [{ id }];
  }

  private visitExpr(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code'
      ? node.text
      : this.p.call(this.expr(node.text));
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    return [{ id }];
  }

  /** `negate` is Ruby's `unless`, which runs its body when the test is false. */
  private visitIf(node: AstNode, entries: Exit[], negate = false): Exit[] {
    const label = this.lang === 'code'
      ? (node.test ?? node.text)
      : (negate ? this.p.askNot(this.expr(node.test)) : this.p.ask(this.expr(node.test)));
    const cond = this.addNode(label, 'decision', node.line);
    this.connect(entries, cond);

    const trueEnds = this.visitGroup(
      node.body ?? [], [{ id: cond, label: this.p.yes }], cond, 'branch', ''
    );

    let falseEnds: Exit[];
    if (node.orelse && node.orelse.length > 0) {
      falseEnds = this.visitGroup(
        node.orelse, [{ id: cond, label: this.p.no }], cond, 'branch', ''
      );
    } else {
      // No else branch: the condition itself is a loose end, and its edge
      // to whatever comes next means "no".
      falseEnds = [{ id: cond, label: this.p.no }];
    }

    return [...trueEnds, ...falseEnds];
  }

  /** `negate` is Ruby's `until`, which loops while the test is false. */
  private visitWhile(node: AstNode, entries: Exit[], negate = false): Exit[] {
    const label = this.lang === 'code'
      ? (node.test ?? node.text)
      : (negate ? this.p.askUntil(this.expr(node.test)) : this.p.ask(this.expr(node.test)));
    const cond = this.addNode(label, 'decision', node.line);
    this.connect(entries, cond);

    // `until` runs its body while the test is FALSE, so the branch labels
    // swap: the "no" edge enters the loop and "yes" leaves it.
    const enterLabel = negate ? this.p.no : this.p.yes;
    const exitLabel = negate ? this.p.yes : this.p.no;

    const breaks: Exit[] = [];
    this.loopStack.push({ cont: cond, breaks });
    const bodyEnds = this.visitGroup(
      node.body ?? [], [{ id: cond, label: enterLabel }], cond, 'loop', ''
    );
    this.loopStack.pop();

    this.connect(bodyEnds, cond);                          // back-edge
    return [{ id: cond, label: exitLabel }, ...breaks];
  }

  /** Rust's `loop { }` and Go's bare `for { }` — only `break` gets you out. */
  private visitLoop(node: AstNode, entries: Exit[]): Exit[] {
    const header = this.addNode(
      this.lang === 'code' ? 'loop' : this.p.foreverLoop, 'process', node.line
    );
    this.connect(entries, header);

    const breaks: Exit[] = [];
    this.loopStack.push({ cont: header, breaks });
    const bodyEnds = this.visitGroup(node.body ?? [], [{ id: header }], header, 'loop', '');
    this.loopStack.pop();

    this.connect(bodyEnds, header);   // back-edge; no condition to exit on
    return breaks;                    // the only way out is a break
  }

  private visitFor(node: AstNode, entries: Exit[]): Exit[] {
    const label = (this.lang === 'code' || !node.target)
      ? node.text
      : this.p.forEach(node.target, this.expr(node.iter));
    const cond = this.addNode(label, 'decision', node.line);
    this.connect(entries, cond);

    const breaks: Exit[] = [];
    this.loopStack.push({ cont: cond, breaks });
    const bodyEnds = this.visitGroup(
      node.body ?? [], [{ id: cond, label: this.p.loopEach }], cond, 'loop', ''
    );
    this.loopStack.pop();

    this.connect(bodyEnds, cond);
    return [{ id: cond, label: this.p.loopDone }, ...breaks];
  }

  /**
   * try/except/else/finally.
   *
   * A true CFG would branch to the handler from EVERY statement in the body,
   * since any of them can raise. That produces an unreadable hairball, so we
   * draw the pedagogically useful shape instead: the body runs, then a single
   * decision asks whether an error happened.
   */
  private visitTry(node: AstNode, entries: Exit[]): Exit[] {
    const tryNode = this.addNode(
      this.lang === 'code' ? 'try' : this.p.tryStart, 'process', node.line
    );
    this.connect(entries, tryNode);

    const bodyEnds = this.visitGroup(
      node.body ?? [], [{ id: tryNode }], tryNode, 'try', ''
    );

    const handlers = node.handlers ?? [];
    let afterEnds: Exit[] = [];

    if (handlers.length > 0) {
      // One decision node representing "did an error occur?"
      const check = this.addNode(
        this.lang === 'code' ? 'error?' : this.p.catchError(''),
        'decision', node.line
      );
      this.connect(bodyEnds, check);

      // Each handler is a branch off that decision.
      for (const handler of handlers) {
        const label = this.lang === 'code'
          ? `except ${handler.text}`.trim()
          : this.p.catchError(handler.text);
        const hNode = this.addNode(label, 'process', handler.line);
        this.edges.push({ from: check, to: hNode, label: this.p.ifError });
        afterEnds.push(...this.visitBody(handler.body ?? [], [{ id: hNode }]));
      }

      // The no-error path, optionally through an `else` block.
      const okExit: Exit = { id: check, label: this.p.ifOk };
      afterEnds.push(...(node.orelse && node.orelse.length > 0
        ? this.visitBody(node.orelse, [okExit])
        : [okExit]));
    } else {
      afterEnds = bodyEnds;
    }

    // `finally` runs on every path, so all ends funnel through it.
    if (node.finalbody && node.finalbody.length > 0) {
      const fin = this.addNode(
        this.lang === 'code' ? 'finally' : this.p.finallyDo, 'process', node.line
      );
      this.connect(afterEnds, fin);
      return this.visitBody(node.finalbody, [{ id: fin }]);
    }

    return afterEnds;
  }

  /**
   * switch / match: one decision node with a labelled branch per case.
   * Fall-through between cases isn't modelled — beginners almost always
   * `break`, and drawing the fall-through edges makes the chart much harder
   * to read for the rare case where they don't.
   */
  private visitSwitch(node: AstNode, entries: Exit[]): Exit[] {
    // Go allows `switch { case cond: }` with no subject — that's a chain of
    // conditions, so ask "which case?" rather than "what is <nothing>?".
    const subject = this.expr(node.test);
    const label = this.lang === 'code'
      ? node.text
      : (subject ? this.p.switchOn(subject) : this.p.whichCase);
    const check = this.addNode(label, 'decision', node.line);
    this.connect(entries, check);

    const cases = node.handlers ?? [];
    if (cases.length === 0) { return [{ id: check }]; }

    const ends: Exit[] = [];
    for (const branch of cases) {
      const caseLabel = this.lang === 'code'
        ? branch.text
        : this.p.caseIs(branch.text);
      ends.push(...this.visitBody(branch.body ?? [], [{ id: check, label: caseLabel }]));
    }
    return ends;
  }

  private visitWith(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code'
      ? node.text
      : this.p.withResource(this.expr(node.value));
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    return this.visitBody(node.body ?? [], [{ id }]);
  }

  private visitRaise(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code'
      ? node.text
      : this.p.raiseError(this.expr(node.value));
    const id = this.addNode(label, 'terminal', node.line);
    this.connect(entries, id);
    return [];  // control leaves the function
  }

  private visitNestedDef(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code'
      ? node.text
      : this.p.nestedDef(node.name ?? node.text);
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    return [{ id }];
  }

  /**
   * C-style `for (init; cond; update)`.
   *
   * Desugared into what actually happens, which is what a beginner needs to
   * see: init runs once, then the condition is checked, then the body, then
   * the update, then back to the condition. Drawing it as a single box would
   * hide the three-part behaviour that makes C-style loops confusing.
   */
  private visitCFor(node: AstNode, entries: Exit[]): Exit[] {
    let current = entries;

    if (node.target) {
      const init = this.addNode(
        this.lang === 'code' ? node.target : this.p.assignRaw(node.target),
        'process', node.line
      );
      this.connect(current, init);
      current = [{ id: init }];
    }

    const cond = this.addNode(
      this.lang === 'code' ? (node.test ?? '') : this.p.ask(this.expr(node.test)),
      'decision', node.line
    );
    this.connect(current, cond);

    const breaks: Exit[] = [];
    // `continue` in a C-style for jumps to the UPDATE, not the condition.
    const updateId = node.iter
      ? this.addNode(
          this.lang === 'code' ? node.iter : this.p.assignRaw(node.iter),
          'process', node.line
        )
      : null;

    this.loopStack.push({ cont: updateId ?? cond, breaks });
    const bodyEnds = this.visitGroup(
      node.body ?? [], [{ id: cond, label: this.p.yes }], cond, 'loop', ''
    );
    this.loopStack.pop();

    if (updateId) {
      this.connect(bodyEnds, updateId);
      this.connect([{ id: updateId }], cond);   // back-edge
    } else {
      this.connect(bodyEnds, cond);
    }

    return [{ id: cond, label: this.p.no }, ...breaks];
  }

  private visitBreak(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code' ? 'break' : this.p.breakLoop;
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    if (this.loopStack.length > 0) {
      this.loopStack[this.loopStack.length - 1].breaks.push({ id });
    }
    return [];
  }

  private visitContinue(node: AstNode, entries: Exit[]): Exit[] {
    const label = this.lang === 'code' ? 'continue' : this.p.continueLoop;
    const id = this.addNode(label, 'process', node.line);
    this.connect(entries, id);
    if (this.loopStack.length > 0) {
      this.connect([{ id }], this.loopStack[this.loopStack.length - 1].cont);
    }
    return [];
  }

  private visitReturn(node: AstNode, entries: Exit[]): Exit[] {
    let label: string;
    if (this.lang === 'code') {
      label = node.text;
    } else {
      const raw = (node.value ?? '').trim();
      // `return None` reads better as "give back nothing" than as a value.
      label = (raw === '' || raw === 'None')
        ? this.p.retNothing
        : this.p.ret(this.expr(node.value));
    }
    const id = this.addNode(label, 'terminal', node.line);
    this.connect(entries, id);
    return [];
  }

  // ---- entry point ---------------------------------------------------------

  /**
   * Build one graph. Each function becomes its own graph — that keeps module
   * flow clean AND is the answer to the large-file problem (render one
   * function at a time).
   */
  build(name: string, body: AstNode[], startLine: number): Graph {
    this.nodes = [];
    this.edges = [];
    this.groups = [];
    this.counter = 0;
    this.loopStack = [];

    const start = this.addNode(this.p.start(name), 'terminal', startLine);
    const ends = this.visitBody(body, [{ id: start }]);
    if (ends.length > 0) {
      const end = this.addNode(this.p.end, 'terminal', startLine);
      this.connect(ends, end);
    }

    const decisions = this.nodes.filter(n => n.shape === 'decision').length;

    // Anything the start node can't reach is dead code — a statement after a
    // return, or a branch that can never be taken. This falls out of the CFG
    // for free, and it's exactly the mistake a beginner can't see by reading.
    const reachable = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const edge of this.edges) {
        if (edge.from === id && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    const unreachable = this.nodes.filter(n => !reachable.has(n.id)).map(n => n.id);

    // Fill in summaries now that member counts are final.
    for (const group of this.groups) {
      group.summary = this.p.foldedSteps(group.members.length);
    }

    return {
      name,
      nodes: this.nodes,
      edges: this.edges,
      groups: this.groups,
      unreachable,
      decisions,
      complexity: decisions + 1,
    };
  }
}

function truncate(text: string, max = 52): string {
  const line = text.split('\n')[0].trim();
  return line.length > max ? line.slice(0, max) + '…' : line;
}

/**
 * Graph -> Mermaid flowchart source.
 *
 * `collapsed` names groups to fold. Each folded group's members are replaced
 * by one summary node; edges that crossed the boundary are rewired to it, and
 * edges entirely inside it are dropped.
 */
export function toMermaid(graph: Graph, collapsed: string[] = []): string {
  const folds = graph.groups.filter(g => collapsed.includes(g.id));

  // node id -> the fold node standing in for it. Inner groups resolve to the
  // outermost fold containing them, so nested folds collapse cleanly.
  const replacement = new Map<string, string>();
  for (const group of folds) {
    const foldId = `fold_${group.id}`;
    for (const member of group.members) {
      if (!replacement.has(member)) { replacement.set(member, foldId); }
    }
  }

  const resolve = (id: string) => replacement.get(id) ?? id;
  const hidden = new Set(replacement.keys());

  const out: string[] = ['flowchart TD'];

  for (const node of graph.nodes) {
    if (hidden.has(node.id)) { continue; }
    const safe = escapeLabel(node.label);
    if (node.shape === 'decision') {
      out.push(`    ${node.id}{"${safe}"}`);
    } else if (node.shape === 'terminal') {
      out.push(`    ${node.id}(["${safe}"])`);
    } else {
      out.push(`    ${node.id}["${safe}"]`);
    }
  }

  for (const group of folds) {
    out.push(`    fold_${group.id}["${escapeLabel(group.summary)}"]`);
  }

  // Rewire edges around folds, then dedupe. Two edges that differ only by
  // label become one unlabelled edge — a fold hides the distinction that
  // made the labels meaningful, so showing just one keeps the chart honest.
  const rewired: FlowEdge[] = [];
  const pairSeen = new Map<string, number>();

  for (const edge of graph.edges) {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    if (from === to) { continue; }              // wholly inside a fold

    const pair = `${from}|${to}`;
    const existing = pairSeen.get(pair);
    if (existing !== undefined) {
      // Same endpoints already drawn: drop the label if they disagree.
      if (rewired[existing].label !== edge.label) {
        rewired[existing] = { from, to };
      }
      continue;
    }
    pairSeen.set(pair, rewired.length);
    rewired.push({ from, to, label: edge.label });
  }

  for (const edge of rewired) {
    out.push(edge.label
      ? `    ${edge.from} -->|"${escapeLabel(edge.label)}"| ${edge.to}`
      : `    ${edge.from} --> ${edge.to}`);
  }

  // Style classes — the webview maps these to theme colours.
  const visible = graph.nodes.filter(n => !hidden.has(n.id));
  const decisions = visible.filter(n => n.shape === 'decision').map(n => n.id);
  const terminals = visible.filter(n => n.shape === 'terminal').map(n => n.id);
  if (decisions.length) { out.push(`    class ${decisions.join(',')} decision`); }
  if (terminals.length) { out.push(`    class ${terminals.join(',')} terminal`); }
  if (folds.length) {
    out.push(`    class ${folds.map(g => `fold_${g.id}`).join(',')} folded`);
  }
  const dead = graph.unreachable.filter(id => !hidden.has(id));
  if (dead.length) { out.push(`    class ${dead.join(',')} unreachable`); }

  return out.join('\n');
}

/** Mermaid treats these as syntax inside labels even when quoted. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "'")
    .replace(/[{}]/g, '')
    .replace(/\|/g, '/');
}
