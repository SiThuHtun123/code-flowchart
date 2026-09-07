/**
 * Collect the tree-sitter runtime and grammar WASM files into media/wasm/.
 *
 * These are binaries (~14MB) reproducible from npm, so they're gitignored
 * rather than committed. Run once after cloning:
 *
 *     node scripts/fetch-wasm.js
 *
 * Grammars are fetched with `npm pack` rather than installed as dependencies:
 * several of them try to compile native bindings (which needs a C++ toolchain
 * we don't otherwise require), and their tree-sitter peer ranges conflict with
 * each other. We only ever want the prebuilt .wasm out of the tarball.
 *
 * Kotlin and Swift are deliberately absent: the only prebuilt WASM available
 * for them targets an older tree-sitter ABI and fails to load at runtime.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'wasm');

/** package@version -> [[file inside the tarball, destination name], ...] */
const GRAMMARS = {
  'tree-sitter-python@0.25': [['tree-sitter-python.wasm', 'tree-sitter-python.wasm']],
  'tree-sitter-javascript@0.25': [['tree-sitter-javascript.wasm', 'tree-sitter-javascript.wasm']],
  'tree-sitter-typescript@0.23': [
    ['tree-sitter-typescript.wasm', 'tree-sitter-typescript.wasm'],
    ['tree-sitter-tsx.wasm', 'tree-sitter-tsx.wasm'],
  ],
  'tree-sitter-java@0.23': [['tree-sitter-java.wasm', 'tree-sitter-java.wasm']],
  'tree-sitter-c@0.24': [['tree-sitter-c.wasm', 'tree-sitter-c.wasm']],
  'tree-sitter-cpp@0.23': [['tree-sitter-cpp.wasm', 'tree-sitter-cpp.wasm']],
  'tree-sitter-c-sharp@0.23': [['tree-sitter-c_sharp.wasm', 'tree-sitter-c_sharp.wasm']],
  'tree-sitter-go@0.25': [['tree-sitter-go.wasm', 'tree-sitter-go.wasm']],
  'tree-sitter-rust@0.24': [['tree-sitter-rust.wasm', 'tree-sitter-rust.wasm']],
  'tree-sitter-php@0.24': [['tree-sitter-php.wasm', 'tree-sitter-php.wasm']],
  'tree-sitter-ruby@0.23': [['tree-sitter-ruby.wasm', 'tree-sitter-ruby.wasm']],
};

/** The runtime itself IS a normal dependency, so copy it from node_modules. */
const RUNTIME = [
  ['node_modules/web-tree-sitter/web-tree-sitter.wasm', 'web-tree-sitter.wasm'],
  ['node_modules/web-tree-sitter/web-tree-sitter.cjs', 'web-tree-sitter.cjs'],
];

fs.mkdirSync(OUT, { recursive: true });

for (const [rel, name] of RUNTIME) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    console.error(`Missing ${rel}. Run \`npm install\` first.`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(OUT, name));
}
console.log('Copied tree-sitter runtime.');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-wasm-'));
let count = RUNTIME.length;

try {
  for (const [spec, files] of Object.entries(GRAMMARS)) {
    const tarball = execFileSync('npm', ['pack', spec, '--silent'], {
      cwd: work, encoding: 'utf8', shell: true,
    }).trim().split('\n').pop();

    for (const [inside, name] of files) {
      execFileSync('tar', ['-xzf', tarball, `package/${inside}`], { cwd: work, shell: true });
      fs.copyFileSync(path.join(work, 'package', inside), path.join(OUT, name));
      count++;
    }
    console.log(`  ${spec}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\nDone — ${count} files in media/wasm/`);
