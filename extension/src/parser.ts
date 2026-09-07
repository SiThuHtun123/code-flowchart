/**
 * tree-sitter parsing for every supported language.
 *
 * Produces the same simplified AST shape that media/parse.py produced for
 * Python, so cfg.ts needs no changes. Replacing the Python subprocess also
 * removes the extension's dependency on the user having Python installed.
 */

import * as path from 'path';
import { AstNode } from './cfg';
import { LanguageSpec, LangId, StatementKind } from './languages';

/**
 * web-tree-sitter is loaded from media/wasm/ rather than node_modules,
 * because vsce excludes node_modules from the packaged extension. The
 * runtime and every grammar live together as plain assets.
 *
 * Typings lag the runtime API, hence the untyped require.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
let TreeSitter: any;

function loadRuntime(mediaDir: string): void {
  if (!TreeSitter) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    TreeSitter = require(path.join(mediaDir, 'wasm', 'web-tree-sitter.cjs'));
  }
}

export interface RawGraph {
  name: string;
  line: number;
  body: AstNode[];
}

export interface ParseOutput {
  graphs?: RawGraph[];
  error?: string;
  line?: number;
  kind?: 'syntax' | 'too-large' | 'parse';
}

const MAX_LINES = 5000;

let initialised = false;
const loaded = new Map<LangId, unknown>();

/** One-time WASM runtime init, then per-language grammar loading (cached). */
async function ensureLanguage(spec: LanguageSpec, mediaDir: string): Promise<unknown> {
  loadRuntime(mediaDir);

  if (!initialised) {
    await TreeSitter.Parser.init({
      locateFile: () => path.join(mediaDir, 'wasm', 'web-tree-sitter.wasm'),
    });
    initialised = true;
  }

  const cached = loaded.get(spec.id);
  if (cached) { return cached; }

  const grammar = await TreeSitter.Language.load(
    path.join(mediaDir, 'wasm', spec.wasm)
  );
  loaded.set(spec.id, grammar);
  return grammar;
}

export async function parse(
  source: string, spec: LanguageSpec, mediaDir: string
): Promise<ParseOutput> {
  const lineCount = source.split('\n').length;
  if (lineCount > MAX_LINES) {
    return {
      error: `This file has ${lineCount.toLocaleString()} lines. ` +
             `Flowcharts are limited to ${MAX_LINES.toLocaleString()} lines.`,
      kind: 'too-large',
    };
  }

  let tree;
  try {
    const grammar = await ensureLanguage(spec, mediaDir);
    const parser = new TreeSitter.Parser();
    parser.setLanguage(grammar);
    tree = parser.parse(source);
  } catch (err) {
    return { error: String(err), kind: 'parse' };
  }

  if (!tree) { return { error: 'Could not parse this file.', kind: 'parse' }; }

  // tree-sitter is error-tolerant: it returns a tree even for broken code,
  // marking the bad region. Report the first error so the user sees why the
  // chart stopped updating.
  const bad = findFirstError(tree.rootNode);

  const graphs: RawGraph[] = [];
  collectFunctions(tree.rootNode, spec, graphs, []);

  // Anything at top level that isn't inside a function. Wrappers that only
  // contain functions (namespaces, C# file-scoped types) are skipped —
  // charting "namespace Demo" as a lone box tells the reader nothing.
  const topLevel = statementsOf(tree.rootNode, spec)
    .filter(n => !isFunctionOrContainer(n, spec) && !isFunctionWrapper(n, spec))
    .map(n => convert(n, spec))
    .filter((n): n is AstNode => n !== null);

  // Top-level code goes LAST and only when it has real control flow. A file
  // whose only top-level statement is `package main` or `<?php` would
  // otherwise open on a two-box chart instead of the function you came for.
  if (topLevel.length > 0 && (graphs.length === 0 || hasControlFlow(topLevel))) {
    graphs.push({ name: '(module)', line: 1, body: topLevel });
  }

  if (graphs.length === 0 && bad) {
    return { error: 'Syntax error', line: bad.startPosition.row + 1, kind: 'syntax' };
  }

  return { graphs };
}

/**
 * Is a module-level chart worth showing?
 *
 * Real branching always qualifies. So does a handful of plain statements —
 * a script's main body is useful even when it's a straight line. What we're
 * filtering out is the one- or two-statement case that is pure file syntax
 * (`package main`, an import) and charts to nothing but start -> end.
 */
function hasControlFlow(nodes: AstNode[]): boolean {
  if (nodes.some(n =>
    /^(If|IfNot|While|Until|For|ForEach|CFor|Loop|Switch|Try)$/.test(n.type))) {
    return true;
  }
  return nodes.length >= 3;
}

// --- tree walking ---------------------------------------------------------

interface TsNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(i: number): TsNode | null;
  childForFieldName(field: string): TsNode | null;
  hasError: boolean;
  isError: boolean;
  isMissing: boolean;
}

function findFirstError(node: TsNode): TsNode | null {
  if (node.isError || node.isMissing) { return node; }
  if (!node.hasError) { return null; }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) {
      const found = findFirstError(child);
      if (found) { return found; }
    }
  }
  return null;
}

function namedChildren(node: TsNode): TsNode[] {
  const out: TsNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) { out.push(child); }
  }
  return out;
}

/** First field present out of several candidate names. */
function field(node: TsNode, names: string[]): TsNode | null {
  for (const name of names) {
    const found = node.childForFieldName(name);
    if (found) { return found; }
  }
  return null;
}

function isFunctionOrContainer(node: TsNode, spec: LanguageSpec): boolean {
  return spec.functionTypes.includes(node.type)
      || spec.containerTypes.includes(node.type);
}

/** A node that exists only to hold functions, e.g. a C# namespace. */
function isFunctionWrapper(node: TsNode, spec: LanguageSpec, depth = 0): boolean {
  if (depth > 3) { return false; }
  if (spec.functionTypes.includes(node.type)) { return true; }
  const children = namedChildren(node);
  if (children.length === 0) { return false; }
  return children.some(c =>
    spec.functionTypes.includes(c.type)
    || spec.containerTypes.includes(c.type)
    || isFunctionWrapper(c, spec, depth + 1));
}

/**
 * Unwrap block nodes to get the statements inside.
 *
 * Some grammars nest an extra layer: Go's `block` holds a `statement_list`,
 * and Rust wraps its control-flow expressions in `expression_statement`.
 * Unwrap those so cfg.ts sees a flat list of statements either way.
 */
function statementsOf(node: TsNode, spec: LanguageSpec): TsNode[] {
  let children = namedChildren(node);

  // Go: block > statement_list > statements
  if (children.length === 1 && children[0].type === 'statement_list') {
    children = namedChildren(children[0]);
  }

  // Rust: expression_statement wrapping a control-flow expression. Unwrap
  // only when the inner node is something we model, so plain expression
  // statements keep their own text.
  return children.map(child => {
    if (child.type === 'expression_statement' && child.namedChildCount === 1) {
      const inner = child.namedChild(0);
      if (inner && spec.statements[inner.type]) { return inner; }
    }
    return child;
  });
}

/** Walk the tree collecting every function as its own graph. */
function collectFunctions(
  node: TsNode, spec: LanguageSpec, out: RawGraph[], prefix: string[]
): void {
  for (const child of namedChildren(node)) {
    if (spec.functionTypes.includes(child.type)) {
      const name = functionName(child, spec);
      const body = field(child, spec.fields.body);
      out.push({
        name: [...prefix, name].join('.'),
        line: child.startPosition.row + 1,
        body: body ? convertBody(body, spec) : [],
      });
    } else if (spec.containerTypes.includes(child.type)) {
      // Class name prefixes its methods, so "Solver.findFirstPrime()" reads
      // clearly. Namespaces and anonymous bodies contribute no prefix.
      const name = containerName(child, spec);
      collectFunctions(child, spec, out, name ? [...prefix, name] : prefix);
    } else {
      collectFunctions(child, spec, out, prefix);
    }
  }
}

function functionName(node: TsNode, spec: LanguageSpec): string {
  const text = plainName(node, spec);
  return text ? `${text}()` : '?';
}

/**
 * A container's bare name — no `()`, since a class or namespace isn't
 * callable. Used to prefix its methods, e.g. "Solver.findFirstPrime()".
 */
function containerName(node: TsNode, spec: LanguageSpec): string {
  return plainName(node, spec);
}

function plainName(node: TsNode, spec: LanguageSpec): string {
  const nameNode = field(node, spec.fields.name);
  if (!nameNode) { return ''; }
  // C/C++ declarators wrap the name in parameter syntax — take the identifier
  // and drop any pointer/reference decoration.
  return nameNode.text.split('(')[0].replace(/[*&]/g, '').trim();
}

function convertBody(node: TsNode, spec: LanguageSpec): AstNode[] {
  return statementsOf(node, spec)
    .map(n => convert(n, spec))
    .filter((n): n is AstNode => n !== null);
}

/** One grammar node -> one simplified AST node. */
function convert(node: TsNode, spec: LanguageSpec): AstNode | null {
  const kind: StatementKind | undefined = spec.statements[node.type];
  const line = node.startPosition.row + 1;
  const text = firstLine(node.text);

  // Statements we don't model (imports, comments, declarations without
  // control flow) become plain boxes via the default branch below.
  switch (kind) {
    case 'If':
      return convertIf(node, spec, line);

    case 'While': {
      const cond = field(node, spec.fields.condition);
      return {
        type: 'While', line,
        text: `while ${cleanCondition(cond?.text ?? '')}`,
        test: cleanCondition(cond?.text ?? ''),
        body: bodyOf(node, spec),
      };
    }

    case 'DoWhile': {
      const cond = field(node, spec.fields.condition);
      return {
        type: 'While', line,
        text: `do while ${cleanCondition(cond?.text ?? '')}`,
        test: cleanCondition(cond?.text ?? ''),
        body: bodyOf(node, spec),
      };
    }

    case 'For':
      return spec.cStyleFor
        ? convertCStyleFor(node, spec, line)
        : convertForEach(node, spec, line);

    case 'ForEach':
      return convertForEach(node, spec, line);

    case 'GoFor':
      return convertGoFor(node, spec, line);

    case 'Loop': {
      // Rust's `loop { }` — runs forever until something breaks out.
      return {
        type: 'Loop', line, text: 'loop',
        body: bodyOf(node, spec),
      };
    }

    case 'IfNot': {
      // Ruby's `unless x` is `if not x`.
      const cond = field(node, spec.fields.condition)
        ?? namedChildren(node)[0];
      const condText = cleanCondition(cond?.text ?? '');
      return {
        type: 'IfNot', line,
        text: `unless ${condText}`,
        test: condText,
        body: bodyOf(node, spec),
        orelse: alternativeOf(node, spec),
      };
    }

    case 'Until': {
      // Ruby's `until x` loops while x is false.
      const cond = field(node, spec.fields.condition)
        ?? namedChildren(node)[0];
      const condText = cleanCondition(cond?.text ?? '');
      return {
        type: 'Until', line,
        text: `until ${condText}`,
        test: condText,
        body: bodyOf(node, spec),
      };
    }

    case 'AugAssign': {
      const target = namedChildren(node)[0];
      const value = namedChildren(node)[1];
      return {
        type: 'AugAssign', line, text: stripSemicolon(text),
        target: target ? firstLine(target.text) : '',
        op: /([+\-*/])=/.exec(node.text)?.[1] ?? '+',
        value: value ? firstLine(value.text) : '',
      };
    }

    case 'Break':    return { type: 'Break', line, text: 'break' };
    case 'Continue': return { type: 'Continue', line, text: 'continue' };

    case 'Return': {
      const value = returnValue(node);
      return { type: 'Return', line, text: `return ${value}`.trim(), value };
    }

    case 'Raise': {
      const value = namedChildren(node).map(c => c.text).join(' ');
      return { type: 'Raise', line, text, value };
    }

    case 'Try':    return convertTry(node, spec, line);
    case 'Switch': return convertSwitch(node, spec, line);

    case 'With': {
      const head = namedChildren(node)[0];
      return {
        type: 'With', line, text,
        value: head ? firstLine(head.text) : '',
        body: bodyOf(node, spec),
      };
    }

    case 'Assign': return convertAssign(node, spec, line, text);

    case 'Expr': {
      // `x = 5;` parses as an expression_statement wrapping an assignment.
      // Unwrap it so it reads as "set x to 5" rather than "do x = 5".
      const inner = namedChildren(node)[0];
      if (inner && /assignment/.test(inner.type)) {
        return convertAssign(inner, spec, line, stripSemicolon(text));
      }
      return { type: 'Expr', line, text: stripSemicolon(text) };
    }

    default:
      // Skip pure syntax noise; render anything else as a plain step.
      if (SKIP_TYPES.has(node.type)) { return null; }
      return { type: 'Other', line, text: stripSemicolon(text) };
  }
}

const SKIP_TYPES = new Set([
  'comment', 'line_comment', 'block_comment',
  'import_statement', 'import_from_statement', 'import_declaration',
  'preproc_include', 'using_directive', 'package_declaration',
  'field_declaration',
  // Not executable statements — file-level syntax that would otherwise
  // become a meaningless box (and `<?php` reads as "is less than" once the
  // humaniser sees the angle bracket).
  'php_tag', 'text_interpolation', 'package_clause', 'attribute_item',
  'use_declaration', 'extern_crate_declaration', 'namespace_use_declaration',
]);

function convertIf(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  const cond = field(node, spec.fields.condition)
    ?? namedChildren(node).find(c => !spec.blockTypes.includes(c.type)
                                  && !/clause|block/.test(c.type));
  const condText = cleanCondition(cond?.text ?? '');

  return {
    type: 'If', line,
    text: `if ${condText}`,
    test: condText,
    body: bodyOf(node, spec),
    orelse: elseBranchOf(node, spec),
  };
}

/**
 * The else side of a conditional, across three grammar shapes:
 *   C-family    `alternative` field holds a block or a nested if_statement
 *   Python      `elif_clause` and `else_clause` are SIBLINGS, and a chain
 *               has several elifs followed by at most one else
 *   Ruby        `else` is a sibling node
 *
 * An elif chain is rebuilt as nested Ifs so it renders as a decision chain.
 */
function elseBranchOf(node: TsNode, spec: LanguageSpec): AstNode[] {
  const clauses = namedChildren(node).filter(c => /^(elif_clause|else_clause|else|elsif)$/.test(c.type));

  if (clauses.length > 0) {
    return buildElseChain(clauses, 0, spec);
  }

  // C-family: a single `alternative` field.
  const alt = field(node, spec.fields.alternative);
  if (!alt) { return []; }

  if (spec.statements[alt.type] === 'If') {
    const nested = convert(alt, spec);
    return nested ? [nested] : [];
  }
  if (/^(else_clause|else)$/.test(alt.type)) {
    const inner = namedChildren(alt)[0];
    if (!inner) { return []; }
    if (spec.statements[inner.type] === 'If') {
      const nested = convert(inner, spec);
      return nested ? [nested] : [];
    }
    return convertBody(inner, spec);
  }
  return convertBody(alt, spec);
}

/** Turn a flat [elif, elif, else] list into nested If nodes. */
function buildElseChain(clauses: TsNode[], index: number, spec: LanguageSpec): AstNode[] {
  if (index >= clauses.length) { return []; }
  const clause = clauses[index];

  if (/^(elif_clause|elsif)$/.test(clause.type)) {
    const cond = field(clause, spec.fields.condition)
      ?? namedChildren(clause).find(c => !spec.blockTypes.includes(c.type));
    const condText = cleanCondition(cond?.text ?? '');
    return [{
      type: 'If',
      line: clause.startPosition.row + 1,
      text: `elif ${condText}`,
      test: condText,
      body: bodyOf(clause, spec),
      orelse: buildElseChain(clauses, index + 1, spec),
    }];
  }

  // Plain else: its body ends the chain.
  return bodyOf(clause, spec);
}

/**
 * C-style `for (init; cond; update)` has three parts where Python has one.
 * We surface the condition as the loop test and fold init/update into the
 * label, which keeps the graph shape identical to a while loop.
 */
function convertCStyleFor(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  const init = node.childForFieldName('initializer') ?? node.childForFieldName('init');
  const cond = node.childForFieldName('condition');
  const update = node.childForFieldName('update') ?? node.childForFieldName('increment');

  const parts = [
    init ? firstLine(init.text).replace(/;$/, '') : '',
    cond ? cleanCondition(firstLine(cond.text)) : '',
    update ? firstLine(update.text) : '',
  ];

  return {
    type: 'CFor', line,
    text: `for (${parts.join('; ')})`,
    test: parts[1] || 'true',
    target: parts[0],   // initialiser, shown as a step before the loop
    iter: parts[2],     // update, shown as a step at the end of the body
    body: bodyOf(node, spec),
  };
}

/**
 * Go has exactly one loop keyword, wearing three hats:
 *   for { }                       -> infinite
 *   for cond { }                  -> while
 *   for i := 0; i < n; i++ { }    -> C-style (a for_clause child)
 *   for i, v := range xs { }      -> range (a range_clause child)
 * Pick the shape from whichever clause is present.
 */
function convertGoFor(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  const children = namedChildren(node);
  const forClause = children.find(c => c.type === 'for_clause');
  const rangeClause = children.find(c => c.type === 'range_clause');

  if (forClause) {
    const parts = namedChildren(forClause);
    const init = forClause.childForFieldName('initializer') ?? parts[0];
    const cond = forClause.childForFieldName('condition');
    const update = forClause.childForFieldName('update');
    return {
      type: 'CFor', line,
      text: firstLine(node.text),
      test: cond ? cleanCondition(firstLine(cond.text)) : 'true',
      target: init ? stripSemicolon(firstLine(init.text)) : '',
      iter: update ? stripSemicolon(firstLine(update.text)) : '',
      body: bodyOf(node, spec),
    };
  }

  if (rangeClause) {
    const left = rangeClause.childForFieldName('left');
    const right = rangeClause.childForFieldName('right');
    const targetText = left ? firstLine(left.text) : 'each item';
    const iterText = right ? firstLine(right.text) : '';
    return {
      type: 'For', line,
      text: `for ${targetText} in ${iterText}`,
      target: targetText,
      iter: iterText,
      body: bodyOf(node, spec),
    };
  }

  // `for cond { }` or bare `for { }`.
  const cond = children.find(c => !spec.blockTypes.includes(c.type));
  if (cond) {
    const condText = cleanCondition(firstLine(cond.text));
    return {
      type: 'While', line,
      text: `for ${condText}`,
      test: condText,
      body: bodyOf(node, spec),
    };
  }

  return { type: 'Loop', line, text: 'for', body: bodyOf(node, spec) };
}

/** The else/elsif branch, however this grammar spells it. */
function alternativeOf(node: TsNode, spec: LanguageSpec): AstNode[] {
  const alt = field(node, spec.fields.alternative)
    ?? namedChildren(node).find(c => /^(else|elsif|else_clause)$/.test(c.type));
  if (!alt) { return []; }

  if (spec.statements[alt.type] === 'If') {
    const nested = convert(alt, spec);
    return nested ? [nested] : [];
  }
  return convertBody(alt, spec);
}

function convertForEach(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  const target = node.childForFieldName('left')
    ?? node.childForFieldName('pattern')     // Rust: `for n in xs`
    ?? node.childForFieldName('name')
    ?? node.childForFieldName('declarator');
  const iter = node.childForFieldName('right')
    ?? node.childForFieldName('value')
    ?? node.childForFieldName('range');

  const targetText = target ? firstLine(target.text) : 'each item';
  // Ruby's `in` node carries the keyword along with the collection.
  const iterText = iter ? firstLine(iter.text).replace(/^in\s+/, '') : '';

  return {
    type: 'For', line,
    text: `for ${targetText} in ${iterText}`,
    target: targetText,
    iter: iterText,
    body: bodyOf(node, spec),
  };
}

function convertTry(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  const handlers: AstNode[] = [];
  let finalbody: AstNode[] = [];
  const orelse: AstNode[] = [];

  for (const child of namedChildren(node)) {
    if (/except|catch/.test(child.type)) {
      const typeNode = child.childForFieldName('type')
        ?? namedChildren(child).find(c => !spec.blockTypes.includes(c.type));
      handlers.push({
        type: 'Handler',
        line: child.startPosition.row + 1,
        // C#/Java wrap the exception type in parentheses: `catch (IOException e)`.
        text: typeNode ? cleanCondition(firstLine(typeNode.text)) : '',
        body: bodyOf(child, spec),
      });
    } else if (/finally/.test(child.type)) {
      finalbody = bodyOf(child, spec);
    }
  }

  return {
    type: 'Try', line, text: 'try',
    body: bodyOf(node, spec),
    handlers, orelse, finalbody,
  };
}

/** Render switch/match as a chain of decisions — closest to how it executes. */
function convertSwitch(node: TsNode, spec: LanguageSpec, line: number): AstNode {
  // A subject-less switch — Go's `switch { case x > 1: }` — is really a
  // chain of conditions, so don't invent a subject from the first case.
  const first = namedChildren(node)[0];
  const subject = field(node, spec.fields.condition)
    ?? node.childForFieldName('value')
    ?? (first && !/case|arm|clause|section|body|block/.test(first.type) ? first : null);
  const subjectText = subject ? cleanCondition(firstLine(subject.text)) : '';

  // Cases live inside the switch's body block, not as direct children.
  const bodyNode = field(node, spec.fields.body)
    ?? namedChildren(node).find(c => /body|block|compound/.test(c.type));
  const caseNodes = (bodyNode ? namedChildren(bodyNode) : namedChildren(node))
    .filter(c => /case|arm|clause|section/.test(c.type));

  const cases = caseNodes.map(c => {
    // A case's label and its statements are siblings; split them apart so
    // "case 8:" becomes the edge label and the rest becomes the body.
    const parts = namedChildren(c);
    const labelNode = parts.find(p => /label|value|pattern|expression/.test(p.type))
      ?? parts[0];
    // A case's statements may be direct siblings of its label, or wrapped in
    // a block (Go's statement_list, C#'s block). Flatten either shape.
    const isLabel = (p: TsNode) => p === labelNode;
    const stmts: TsNode[] = [];
    for (const part of parts) {
      if (isLabel(part)) { continue; }
      if (spec.blockTypes.includes(part.type) || part.type === 'statement_list') {
        stmts.push(...statementsOf(part, spec));
      } else if (spec.statements[part.type]) {
        stmts.push(part);
      }
    }

    const source = labelNode && /case|value|pattern|label|expression/.test(labelNode.type)
      ? labelNode.text
      : c.text;
    const label = firstLine(source)
      .replace(/^(case|default|when)\b\s*/, '')
      .replace(/\s*[:{].*$/, '')
      .replace(/\s*=>.*$/, '')     // Rust match arms
      .trim();

    return {
      type: 'Handler' as const,
      line: c.startPosition.row + 1,
      text: label || 'otherwise',
      body: stmts.map(s => convert(s, spec)).filter((n): n is AstNode => n !== null),
    };
  });

  return {
    type: 'Switch', line,
    text: `switch ${subjectText}`,
    test: subjectText,
    handlers: cases,
    body: [],
  };
}

function convertAssign(
  node: TsNode, spec: LanguageSpec, line: number, text: string
): AstNode {
  const clean = stripSemicolon(text);

  // Rust's `let mut x = 5` puts the name in `pattern`; Go's `x := 5` uses
  // left/right like a normal assignment.
  const left = node.childForFieldName('left')
    ?? node.childForFieldName('pattern')
    ?? node.childForFieldName('name');
  const right = node.childForFieldName('right') ?? node.childForFieldName('value');

  if (left && right) {
    return {
      type: 'Assign', line, text: clean,
      target: firstLine(left.text),
      value: stripSemicolon(firstLine(right.text)),
    };
  }

  // Declarations — `int x = 5;` (C/Java), `let x = 5;` (JS),
  // `bool x = true;` (C#). The name and value live in a declarator, whose
  // depth and field names vary: C# nests it inside a variable_declaration,
  // so search recursively rather than only one level down.
  const declarator = findDeclarator(node);
  if (declarator) {
    const dName = declarator.childForFieldName('declarator')
      ?? declarator.childForFieldName('name');
    const dValue = declarator.childForFieldName('value');
    if (dName && dValue) {
      return {
        type: 'Assign', line, text: clean,
        target: firstLine(dName.text),
        value: stripSemicolon(firstLine(dValue.text)),
      };
    }
    // C#'s variable_declarator holds `x = true` as unnamed children.
    const parts = /^(\w+)\s*=\s*(.+)$/.exec(firstLine(declarator.text));
    if (parts) {
      return {
        type: 'Assign', line, text: clean,
        target: parts[1],
        value: stripSemicolon(parts[2]),
      };
    }
  }

  return { type: 'Other', line, text: clean };
}

/** Depth-first search for a declarator node, at most a few levels down. */
function findDeclarator(node: TsNode, depth = 0): TsNode | null {
  if (depth > 3) { return null; }
  for (const child of namedChildren(node)) {
    if (/declarator/.test(child.type)) { return child; }
    const nested = findDeclarator(child, depth + 1);
    if (nested) { return nested; }
  }
  return null;
}

/** Trailing semicolons are syntax noise in a flowchart box. */
function stripSemicolon(text: string): string {
  return text.replace(/\s*;\s*$/, '');
}

function bodyOf(node: TsNode, spec: LanguageSpec): AstNode[] {
  const body = field(node, spec.fields.body);
  if (body) { return convertBody(body, spec); }

  // Braceless single statements: `if (x) doThing();`
  const block = namedChildren(node).find(c => spec.blockTypes.includes(c.type));
  if (block) { return convertBody(block, spec); }
  return [];
}

function returnValue(node: TsNode): string {
  const children = namedChildren(node);
  return children.length > 0 ? firstLine(children[0].text) : '';
}

/** Strip the parentheses C-family grammars include around conditions. */
function cleanCondition(text: string): string {
  const trimmed = firstLine(text).trim();
  return trimmed.startsWith('(') && trimmed.endsWith(')')
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function firstLine(text: string): string {
  return text.split('\n')[0].trim();
}
