/**
 * Per-language mappings from tree-sitter grammar node names to the small
 * vocabulary cfg.ts understands.
 *
 * cfg.ts is language-agnostic: `if`, `while`, `for`, `break`, `return` mean
 * the same thing everywhere. Only the grammar's NAMES differ — Python's
 * grammar calls it `if_statement`, so does JavaScript's, but the field names
 * for the condition and body vary. That's all this file encodes.
 */

export type LangId =
  | 'python' | 'javascript' | 'typescript' | 'tsx' | 'java' | 'cpp' | 'c' | 'csharp'
  | 'go' | 'rust' | 'php' | 'ruby';

export interface LanguageSpec {
  id: LangId;
  /** VS Code languageIds that map to this grammar. */
  vscodeIds: string[];
  wasm: string;

  /** Grammar node type -> our statement kind. */
  statements: Record<string, StatementKind>;

  /** Node types whose children are a statement list. */
  blockTypes: string[];

  /** Node types that define a chartable function. */
  functionTypes: string[];

  /** Node types that group functions (classes, namespaces). */
  containerTypes: string[];

  /** Field names, which differ across grammars. */
  fields: {
    condition: string[];   // if/while test
    body: string[];        // statement block
    alternative: string[]; // else branch
    name: string[];        // function name
  };

  /**
   * C-style `for (init; cond; update)` needs different handling from
   * Python's `for x in xs`. True for the whole C family.
   */
  cStyleFor: boolean;
}

export type StatementKind =
  | 'If' | 'IfNot' | 'While' | 'Until' | 'For' | 'ForEach' | 'DoWhile'
  | 'GoFor'   // Go's single `for` keyword — shape decided by its clause
  | 'Loop'    // Rust's infinite `loop`
  | 'Break' | 'Continue' | 'Return' | 'Try' | 'With'
  | 'Raise' | 'Switch' | 'Assign' | 'AugAssign' | 'Expr' | 'Block';

/** Shared by every C-family grammar; individual specs override as needed. */
const C_FAMILY_STATEMENTS: Record<string, StatementKind> = {
  if_statement: 'If',
  while_statement: 'While',
  for_statement: 'For',
  do_statement: 'DoWhile',
  break_statement: 'Break',
  continue_statement: 'Continue',
  return_statement: 'Return',
  try_statement: 'Try',
  switch_statement: 'Switch',
  expression_statement: 'Expr',
  declaration: 'Assign',
  local_variable_declaration: 'Assign',
};

export const LANGUAGES: Record<LangId, LanguageSpec> = {
  python: {
    id: 'python',
    vscodeIds: ['python'],
    wasm: 'tree-sitter-python.wasm',
    statements: {
      if_statement: 'If',
      while_statement: 'While',
      for_statement: 'ForEach',
      break_statement: 'Break',
      continue_statement: 'Continue',
      return_statement: 'Return',
      try_statement: 'Try',
      with_statement: 'With',
      raise_statement: 'Raise',
      match_statement: 'Switch',
      expression_statement: 'Expr',
      assignment: 'Assign',
      augmented_assignment: 'AugAssign',
    },
    blockTypes: ['block', 'module'],
    functionTypes: ['function_definition'],
    containerTypes: ['class_definition'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: false,
  },

  javascript: {
    id: 'javascript',
    vscodeIds: ['javascript', 'javascriptreact'],
    wasm: 'tree-sitter-javascript.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      for_in_statement: 'ForEach',
      lexical_declaration: 'Assign',
      variable_declaration: 'Assign',
      throw_statement: 'Raise',
    },
    blockTypes: ['statement_block', 'program'],
    functionTypes: [
      'function_declaration', 'method_definition',
      'function_expression', 'arrow_function', 'generator_function_declaration',
    ],
    containerTypes: ['class_declaration', 'class_body'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  java: {
    id: 'java',
    vscodeIds: ['java'],
    wasm: 'tree-sitter-java.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      enhanced_for_statement: 'ForEach',
      throw_statement: 'Raise',
    },
    blockTypes: ['block', 'program', 'constructor_body'],
    functionTypes: ['method_declaration', 'constructor_declaration'],
    containerTypes: ['class_declaration', 'class_body', 'interface_declaration'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  cpp: {
    id: 'cpp',
    vscodeIds: ['cpp'],
    wasm: 'tree-sitter-cpp.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      for_range_loop: 'ForEach',
      throw_statement: 'Raise',
    },
    blockTypes: ['compound_statement', 'translation_unit'],
    functionTypes: ['function_definition'],
    containerTypes: ['class_specifier', 'struct_specifier', 'namespace_definition'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['declarator', 'name'],
    },
    cStyleFor: true,
  },

  c: {
    id: 'c',
    vscodeIds: ['c'],
    wasm: 'tree-sitter-c.wasm',
    statements: C_FAMILY_STATEMENTS,
    blockTypes: ['compound_statement', 'translation_unit'],
    functionTypes: ['function_definition'],
    containerTypes: ['struct_specifier'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['declarator'],
    },
    cStyleFor: true,
  },

  csharp: {
    id: 'csharp',
    vscodeIds: ['csharp'],
    wasm: 'tree-sitter-c_sharp.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      foreach_statement: 'ForEach',
      throw_statement: 'Raise',
      using_statement: 'With',
      local_declaration_statement: 'Assign',
    },
    blockTypes: ['block', 'compilation_unit'],
    functionTypes: ['method_declaration', 'constructor_declaration', 'local_function_statement'],
    // namespace_declaration is walked through but contributes no name prefix —
    // "Solver.FindFirstPrime()" reads better than "Demo.Solver.FindFirstPrime()".
    containerTypes: ['class_declaration', 'struct_declaration'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  // TypeScript has its own grammar — the JavaScript one chokes on type
  // annotations, interfaces and generics.
  typescript: {
    id: 'typescript',
    vscodeIds: ['typescript'],
    wasm: 'tree-sitter-typescript.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      for_in_statement: 'ForEach',
      lexical_declaration: 'Assign',
      variable_declaration: 'Assign',
      throw_statement: 'Raise',
    },
    blockTypes: ['statement_block', 'program'],
    functionTypes: [
      'function_declaration', 'method_definition', 'method_signature',
      'function_expression', 'arrow_function', 'generator_function_declaration',
    ],
    containerTypes: ['class_declaration', 'class_body', 'interface_declaration'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  tsx: {
    id: 'tsx',
    vscodeIds: ['typescriptreact'],
    wasm: 'tree-sitter-tsx.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      for_in_statement: 'ForEach',
      lexical_declaration: 'Assign',
      variable_declaration: 'Assign',
      throw_statement: 'Raise',
    },
    blockTypes: ['statement_block', 'program'],
    functionTypes: [
      'function_declaration', 'method_definition',
      'function_expression', 'arrow_function', 'generator_function_declaration',
    ],
    containerTypes: ['class_declaration', 'class_body', 'interface_declaration'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  go: {
    id: 'go',
    vscodeIds: ['go'],
    wasm: 'tree-sitter-go.wasm',
    statements: {
      if_statement: 'If',
      // Go has ONE `for` keyword covering C-style, while-style and range.
      // convertGoFor picks the right shape by inspecting its clause.
      for_statement: 'GoFor',
      break_statement: 'Break',
      continue_statement: 'Continue',
      return_statement: 'Return',
      expression_switch_statement: 'Switch',
      type_switch_statement: 'Switch',
      short_var_declaration: 'Assign',
      assignment_statement: 'Assign',
      var_declaration: 'Assign',
      inc_statement: 'Expr',
      dec_statement: 'Expr',
      expression_statement: 'Expr',
      go_statement: 'Expr',
      defer_statement: 'Expr',
    },
    blockTypes: ['block', 'source_file', 'statement_list'],
    functionTypes: ['function_declaration', 'method_declaration'],
    containerTypes: [],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: false,
  },

  rust: {
    id: 'rust',
    vscodeIds: ['rust'],
    wasm: 'tree-sitter-rust.wasm',
    // Rust is expression-oriented: control flow nodes end in _expression,
    // not _statement.
    statements: {
      if_expression: 'If',
      while_expression: 'While',
      for_expression: 'ForEach',
      loop_expression: 'Loop',
      break_expression: 'Break',
      continue_expression: 'Continue',
      return_expression: 'Return',
      match_expression: 'Switch',
      let_declaration: 'Assign',
      expression_statement: 'Expr',
    },
    blockTypes: ['block', 'source_file', 'declaration_list'],
    functionTypes: ['function_item'],
    containerTypes: ['impl_item', 'trait_item', 'mod_item'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name', 'type'],
    },
    cStyleFor: false,
  },

  php: {
    id: 'php',
    vscodeIds: ['php'],
    wasm: 'tree-sitter-php.wasm',
    statements: {
      ...C_FAMILY_STATEMENTS,
      foreach_statement: 'ForEach',
      throw_statement: 'Raise',
      echo_statement: 'Expr',
      compound_statement: 'Block',
    },
    blockTypes: ['compound_statement', 'program', 'declaration_list'],
    functionTypes: ['function_definition', 'method_declaration'],
    containerTypes: ['class_declaration', 'trait_declaration', 'interface_declaration'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: true,
  },

  ruby: {
    id: 'ruby',
    vscodeIds: ['ruby'],
    wasm: 'tree-sitter-ruby.wasm',
    // Ruby's grammar uses bare keywords as node types — `if`, not
    // `if_statement` — and wraps bodies in `do` / `then` nodes.
    statements: {
      if: 'If',
      unless: 'IfNot',
      while: 'While',
      until: 'Until',
      for: 'ForEach',
      break: 'Break',
      next: 'Continue',
      return: 'Return',
      begin: 'Try',
      case: 'Switch',
      assignment: 'Assign',
      operator_assignment: 'AugAssign',
      call: 'Expr',
    },
    blockTypes: ['body_statement', 'program', 'do', 'then', 'else', 'do_block'],
    functionTypes: ['method', 'singleton_method'],
    containerTypes: ['class', 'module'],
    fields: {
      condition: ['condition'],
      body: ['body', 'consequence'],
      alternative: ['alternative'],
      name: ['name'],
    },
    cStyleFor: false,
  },
};

/** Every VS Code languageId the extension can chart. */
export const SUPPORTED_IDS: string[] = Object.values(LANGUAGES)
  .flatMap(spec => spec.vscodeIds);

export function specForVscodeId(languageId: string): LanguageSpec | undefined {
  return Object.values(LANGUAGES).find(s => s.vscodeIds.includes(languageId));
}
