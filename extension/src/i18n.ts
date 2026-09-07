/**
 * Plain-language rendering of code, in English and Japanese.
 *
 * Pure lookup + string templates — no network, no AI. Deterministic and
 * instant, which is what a render-as-you-type extension needs.
 *
 * Templates are FUNCTIONS, not format strings, because word order differs:
 * English "set x to 5" is verb-first, Japanese "x を 5 にする" is verb-final.
 */

export type Lang = 'en' | 'ja' | 'code';

export interface Phrases {
  // --- branch/edge labels ---
  yes: string;
  no: string;
  loopEach: string;      // edge into a loop body
  loopDone: string;      // edge leaving a loop normally
  // --- node labels ---
  start: (name: string) => string;
  end: string;
  assign: (target: string, value: string) => string;
  /** For statements we only have as raw text, e.g. a C-style for's `i++`. */
  assignRaw: (text: string) => string;
  augAssign: (target: string, op: string, value: string) => string;
  ask: (condition: string) => string;          // wraps an if/while condition
  forEach: (item: string, iterable: string) => string;
  ret: (value: string) => string;
  retNothing: string;
  breakLoop: string;
  continueLoop: string;
  call: (what: string) => string;
  tryStart: string;
  catchError: (what: string) => string;
  finallyDo: string;
  withResource: (what: string) => string;
  raiseError: (what: string) => string;
  nestedDef: (name: string) => string;
  switchOn: (subject: string) => string;
  caseIs: (value: string) => string;
  foreverLoop: string;
  whichCase: string;
  askNot: (condition: string) => string;   // Ruby's `unless`
  askUntil: (condition: string) => string; // Ruby's `until`
  // --- edge labels for try/except ---
  ifError: string;
  ifOk: string;
  // --- folded-group summaries ---
  foldedSteps: (count: number) => string;
  // --- complexity readout ---
  complexity: (decisions: number, score: number) => string;
}

/** Operator words, longest-first so "<=" wins over "<". */
type OpTable = Array<[RegExp, string]>;

export const EN: Phrases = {
  yes: 'yes',
  no: 'no',
  loopEach: 'each',
  loopDone: 'done',

  start: name => name === '(module)' ? 'start' : name,
  end: 'end',
  assign: (t, v) => `set ${t} to ${v}`,
  assignRaw: text => describeRaw(text, 'en'),
  augAssign: (t, op, v) => `${OP_VERB_EN[op] ?? 'update'} ${t} by ${v}`,
  // The operator words already supply a verb ("x is at most y"), so the
  // question mark alone is enough — prefixing "is" would double it up.
  ask: c => `${c}?`,
  forEach: (item, iter) => `for each ${item} in ${iter}`,
  ret: v => `give back ${v}`,
  retNothing: 'give back nothing',
  breakLoop: 'exit the loop',
  continueLoop: 'skip to the next one',
  call: what => `do ${what}`,
  tryStart: 'try this',
  catchError: what => what ? `if ${what} happens` : 'if an error happens',
  finallyDo: 'always do this',
  withResource: what => `using ${what}`,
  raiseError: what => what ? `report error: ${what}` : 'report an error',
  nestedDef: name => `define ${name}`,
  switchOn: subject => `what is ${subject}?`,
  caseIs: value => value || 'otherwise',
  foreverLoop: 'repeat forever',
  whichCase: 'which case matches?',
  askNot: c => `${c} is false?`,
  askUntil: c => `${c} yet?`,
  ifError: 'error',
  ifOk: 'no error',

  foldedSteps: n => `${n} step${n === 1 ? '' : 's'} hidden — click to expand`,
  complexity: (d, s) => `${d} decision${d === 1 ? '' : 's'} · complexity ${s}`,
};

export const JA: Phrases = {
  yes: 'はい',
  no: 'いいえ',
  loopEach: '各要素',
  loopDone: '終了',

  start: name => name === '(module)' ? '開始' : name,
  end: '終了',
  assign: (t, v) => `${t} を ${v} にする`,
  assignRaw: text => describeRaw(text, 'ja'),
  augAssign: (t, op, v) => `${t} を ${v} ${OP_VERB_JA[op] ?? '更新する'}`,
  ask: c => `${c}？`,
  forEach: (item, iter) => `${iter} の各 ${item} について`,
  ret: v => `${v} を返す`,
  retNothing: '何も返さない',
  breakLoop: 'ループを抜ける',
  continueLoop: '次の繰り返しへ',
  call: what => `${what} を実行する`,
  tryStart: '試してみる',
  catchError: what => what ? `${what} が起きたら` : 'エラーが起きたら',
  finallyDo: '必ず実行する',
  withResource: what => `${what} を使って`,
  raiseError: what => what ? `エラーを出す: ${what}` : 'エラーを出す',
  nestedDef: name => `${name} を定義する`,
  switchOn: subject => `${subject} は何？`,
  caseIs: value => value || 'その他',
  foreverLoop: '無限に繰り返す',
  whichCase: 'どの条件に合う？',
  askNot: c => `${c} が偽？`,
  askUntil: c => `${c} になるまで？`,
  ifError: 'エラー',
  ifOk: '正常',

  foldedSteps: n => `${n} ステップを省略 — クリックで展開`,
  complexity: (d, s) => `分岐 ${d} 個 · 複雑度 ${s}`,
};

const OP_VERB_EN: Record<string, string> = {
  '+': 'increase', '-': 'decrease', '*': 'multiply', '/': 'divide',
};

const OP_VERB_JA: Record<string, string> = {
  '+': '増やす', '-': '減らす', '*': '掛ける', '/': '割る',
};

/**
 * Comparison and logical operators, rewritten as words.
 * Order matters: two-character operators must be tried before one-character
 * ones, or "<=" would match "<" and leave a stray "=".
 */
const OPS_EN: OpTable = [
  // Rust deref/ref sigils are noise, and `*n` would otherwise read as
  // multiplication. The distinction is spacing: `*n` (no gap) is a deref,
  // `d * d` (spaced) is arithmetic. Strip only the unspaced form.
  [/(^|[([,]|\s)[*&](\w)/g, '$1$2'],
  [/\.iter\(\)|\.into_iter\(\)/g, ''],   // Rust iterator noise
  // Arithmetic FIRST: these use \S+ captures, which would otherwise swallow
  // the words a comparison rewrite has already inserted.
  [/(\S+)\s*%\s*(\S+)/g, 'the remainder of $1 ÷ $2'],
  [/\s*\/\/\s*/g, ' divided evenly by '],
  [/\s*\*\s*/g, ' × '],
  // Comparisons: LONGEST operators first. JS's "===" must be consumed before
  // "==", which must come before "=", or each leaves a stray character.
  [/\s*===\s*/g, ' is exactly '],
  [/\s*!==\s*/g, ' is not exactly '],
  [/\s*<=\s*/g, ' is at most '],
  [/\s*>=\s*/g, ' is at least '],
  [/\s*==\s*/g, ' is equal to '],
  [/\s*!=\s*/g, ' is not equal to '],
  [/\s*<\s*/g, ' is less than '],
  [/\s*>\s*/g, ' is greater than '],
  // Membership BEFORE the bare not/in rules: "x not in y" must become
  // "x is not in y", not the ungrammatical "x not is in y".
  [/\s+not\s+in\s+/g, ' is not in '],
  [/(?<!\bis)(?<!\bis not)\s+in\s+/g, ' is in '],
  [/\bnot\s+/g, 'not '],
  [/\s+and\s+/g, ' and '],
  [/\s+or\s+/g, ' or '],
  [/\s+is\s+None\b/g, ' is nothing'],
  [/\bNone\b/g, 'nothing'],
  [/\bTrue\b/g, 'true'],
  [/\bFalse\b/g, 'false'],
  [/\blen\(([^)]*)\)/g, 'the length of $1'],
];

/** Comparisons are handled by JA_COMPARISONS — these are the rest. */
const OPS_JA: OpTable = [
  [/\s*\*\s*/g, ' × '],
  // Noun phrase, not a clause — this may sit on either side of a comparison.
  [/(\S+)\s*%\s*(\S+)/g, '$1 を $2 で割った余り'],
  [/\bnot\s+/g, ''],
  [/\s+and\s+/g, ' かつ '],
  [/\s+or\s+/g, ' または '],
  [/\bNone\b/g, 'なし'],
  [/\bTrue\b/g, '真'],
  [/\bFalse\b/g, '偽'],
  [/\blen\(([^)]*)\)/g, '$1 の長さ'],
];

/**
 * Japanese comparisons need a suffix after the right-hand side, so they're
 * handled as a whole-expression rewrite rather than token substitution.
 */
const JA_COMPARISONS: Array<[RegExp, (a: string, b: string) => string]> = [
  [/^(.+?)\s*===\s*(.+)$/, (a, b) => `${a} は ${b} と完全に等しい`],
  [/^(.+?)\s*!==\s*(.+)$/, (a, b) => `${a} は ${b} と完全には等しくない`],
  [/^(.+?)\s*<=\s*(.+)$/, (a, b) => `${a} は ${b} 以下`],
  [/^(.+?)\s*>=\s*(.+)$/, (a, b) => `${a} は ${b} 以上`],
  [/^(.+?)\s*==\s*(.+)$/, (a, b) => `${a} は ${b} と等しい`],
  [/^(.+?)\s*!=\s*(.+)$/, (a, b) => `${a} は ${b} と等しくない`],
  [/^(.+?)\s*<\s*(.+)$/,  (a, b) => `${a} は ${b} より小さい`],
  [/^(.+?)\s*>\s*(.+)$/,  (a, b) => `${a} は ${b} より大きい`],
];

/** Rewrite an expression into words. Falls back to the raw text. */
export function humanizeExpr(expr: string, lang: Lang): string {
  if (lang === 'code') { return expr; }
  if (!expr) { return expr; }

  // Anything with brackets, lambdas or comprehensions reads worse translated
  // than raw — bail out and show the code.
  if (isTooComplex(expr)) { return expr; }

  if (lang === 'ja') {
    for (const [pattern, build] of JA_COMPARISONS) {
      const m = pattern.exec(expr);
      if (m) {
        return build(applyOps(m[1], OPS_JA).trim(), applyOps(m[2], OPS_JA).trim());
      }
    }
    return applyOps(expr, OPS_JA).trim();
  }

  return applyOps(expr, OPS_EN).replace(/\s+/g, ' ').trim();
}

function applyOps(text: string, table: OpTable): string {
  let out = text;
  for (const [pattern, replacement] of table) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Comprehensions, lambdas, nested calls and subscripts translate badly.
 * Showing the original code is clearer than a mangled sentence.
 */
function isTooComplex(expr: string): boolean {
  if (expr.length > 60) { return true; }
  if (/\bfor\b.*\bin\b/.test(expr) && /[[{(]/.test(expr)) { return true; }  // comprehension
  if (/\blambda\b/.test(expr)) { return true; }
  const depth = (expr.match(/[([{]/g) ?? []).length;
  return depth > 2;
}

export function phrasesFor(lang: Lang): Phrases {
  return lang === 'ja' ? JA : EN;
}

/**
 * A bare fragment with no parsed structure — a C-style for's initialiser or
 * update. Handles the increment forms beginners meet first, and falls back
 * to a general assignment rewrite.
 */
function describeRaw(text: string, lang: 'en' | 'ja'): string {
  const t = text.trim().replace(/;$/, '');

  let m = /^(\w+)\+\+$|^\+\+(\w+)$/.exec(t);
  if (m) {
    const v = m[1] ?? m[2];
    return lang === 'ja' ? `${v} を 1 増やす` : `add 1 to ${v}`;
  }

  m = /^(\w+)--$|^--(\w+)$/.exec(t);
  if (m) {
    const v = m[1] ?? m[2];
    return lang === 'ja' ? `${v} を 1 減らす` : `subtract 1 from ${v}`;
  }

  m = /^(\w+)\s*([+\-*/])=\s*(.+)$/.exec(t);
  if (m) {
    const [, v, op, amount] = m;
    if (lang === 'ja') { return `${v} を ${amount} ${OP_VERB_JA[op] ?? '更新する'}`; }
    return `${OP_VERB_EN[op] ?? 'update'} ${v} by ${amount}`;
  }

  // `int i = 0` / `let i = 0` / Go's `i := 0` — drop any type keyword and
  // the walrus colon, keep the assignment.
  m = /^(?:\w+\s+)?(\w+)\s*:?=\s*(.+)$/.exec(t);
  if (m) {
    const [, target, value] = m;
    const rendered = humanizeExpr(value, lang);
    return lang === 'ja' ? `${target} を ${rendered} にする` : `set ${target} to ${rendered}`;
  }

  return humanizeExpr(t, lang);
}
