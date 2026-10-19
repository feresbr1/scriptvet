import type { Category, Recommendation, ScriptFile, Signal } from './types';

// ---------------------------------------------------------------------------
// Commands (the strings in package.json "scripts")
// ---------------------------------------------------------------------------

const NATIVE_CMD =
  /\b(?:node-gyp(?:\s+rebuild|\s+build)?|node-gyp-build(?:-optional-packages)?|prebuild-install|node-pre-gyp|cmake-js|install-from-cache)\b/;
const BINARY_CHECK_CMD = /\bnapi-postinstall\b/;
const GIT_HOOKS_CMD = /\b(?:husky|simple-git-hooks|lefthook|git\s+config\s+core\.hooksPath)\b/;
const MESSAGE_CMD = /^(?:echo\b|opencollective(?:-postinstall)?\b|node\s+-e\s+["']console\.log)/;
const CODEGEN_CMD =
  /\b(?:prisma\s+generate|patch-package|ngcc|svelte-kit\s+sync|nuxt\s+prepare|tsc)\b/;
const SHELL_CMD = /\b(?:curl|wget|bash\s+-c|sh\s+-c|powershell|pwsh|Invoke-WebRequest|iwr|iex)\b/i;

export interface CommandAnalysis {
  category?: Category;
  /** Files the command runs (relative to the package root). */
  files: string[];
  signals: Signal[];
}

/** Understand an install command without running it. */
export function analyzeCommand(command: string): CommandAnalysis {
  const files: string[] = [];
  const signals = new Set<Signal>();
  let category: Category | undefined;
  const segments = command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (/\|\|\s*(?:exit\s+0|true)\s*$/.test(command)) signals.add('errors-ignored');
  if (SHELL_CMD.test(command)) signals.add('shell');

  for (const segment of segments) {
    if (!category && NATIVE_CMD.test(segment)) category = 'native-build';
    else if (!category && BINARY_CHECK_CMD.test(segment)) category = 'binary-check';
    else if (!category && GIT_HOOKS_CMD.test(segment)) category = 'git-hooks';
    else if (!category && MESSAGE_CMD.test(segment)) category = 'message';
    else if (!category && CODEGEN_CMD.test(segment)) category = 'codegen';

    // node -e "try{require('./postinstall')}catch(e){}"
    const inline = /^node\s+-e\s+(["'])(.*)\1$/.exec(segment);
    if (inline) {
      const body = inline[2]!;
      if (/try\s*\{[^}]*\}\s*catch/.test(body)) signals.add('errors-ignored');
      for (const m of body.matchAll(/require\(\s*\\?['"](\.{1,2}\/[^'"\\]+)\\?['"]\s*\)/g)) {
        files.push(withJsExtension(m[1]!));
      }
      continue;
    }
    // node install.js / node ./scripts/install.mjs --flag
    const file = /^node\s+(?:--[\w-]+(?:=\S+)?\s+)*([^\s-][^\s]*\.(?:c|m)?js)\b/.exec(segment);
    if (file) files.push(normalisePath(file[1]!));
  }
  return { category, files: [...new Set(files)], signals: [...signals] };
}

function normalisePath(path: string): string {
  return path.replace(/^["']|["']$/g, '').replace(/^\.\//, '');
}

function withJsExtension(path: string): string {
  const clean = normalisePath(path);
  return /\.(?:c|m)?js$/.test(clean) ? clean : `${clean}.js`;
}

// ---------------------------------------------------------------------------
// Source files the commands run
// ---------------------------------------------------------------------------

const SOURCE_RULES: { signal: Signal; re: RegExp }[] = [
  {
    signal: 'network',
    re: /require\(\s*['"](?:node:)?https?['"]\s*\)|from\s+['"](?:node:)?https?['"]|\bfetch\(|\bhttps?\.(?:get|request)\(|require\(\s*['"](?:axios|got|node-fetch|undici|needle|request|make-fetch-happen)['"]\s*\)|from\s+['"](?:axios|got|node-fetch|undici|needle)['"]/,
  },
  {
    signal: 'child-process',
    re: /child_process|\b(?:execSync|spawnSync|execFileSync|execFile|spawn)\(/,
  },
  {
    signal: 'writes-files',
    re: /\b(?:writeFileSync|writeFile|createWriteStream|chmodSync|renameSync|symlinkSync|copyFileSync|unlinkSync|rmSync|mkdirSync)\(/,
  },
  { signal: 'reads-env', re: /process\.env\b/ },
  { signal: 'obfuscated', re: /\beval\(|new\s+Function\(|Buffer\.from\([^)]{0,60}['"]base64['"]/ },
];

const LONG_BLOB = /[A-Za-z0-9+/=]{500,}/;
const CONSOLE = /\bconsole\.(?:log|info|warn|error)\(|process\.stdout\.write\(/;
const RELATIVE_IMPORT =
  /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g;

export interface SourceAnalysis {
  signals: Signal[];
  evidence: ScriptFile['evidence'];
  description?: string;
  /** Relative modules this file loads (to follow one level deeper). */
  imports: string[];
  /** Well-known helper packages the file uses. */
  helpers: string[];
}

export function analyzeSource(text: string): SourceAnalysis {
  const signals = new Set<Signal>();
  const evidence: ScriptFile['evidence'] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//# sourceMappingURL')) return;
    for (const { signal, re } of SOURCE_RULES) {
      if (re.test(line)) {
        signals.add(signal);
        if (evidence.filter((e) => e.signal === signal).length < 3) {
          evidence.push({ line: i + 1, text: line.slice(0, 160), signal });
        }
      }
    }
    if (LONG_BLOB.test(line)) {
      signals.add('obfuscated');
      if (evidence.filter((e) => e.signal === 'obfuscated').length < 3) {
        evidence.push({
          line: i + 1,
          text: `${line.slice(0, 80)}… (${line.length} characters)`,
          signal: 'obfuscated',
        });
      }
    }
  });
  const hasConsole = CONSOLE.test(text);
  if (
    hasConsole &&
    !signals.has('network') &&
    !signals.has('child-process') &&
    !signals.has('writes-files') &&
    !signals.has('obfuscated')
  ) {
    signals.add('console-only');
  }

  const imports = new Set<string>();
  for (const m of text.matchAll(RELATIVE_IMPORT)) {
    const path = m[1] ?? m[2];
    if (path) imports.add(path);
  }
  const helpers = [
    ...new Set(
      [...text.matchAll(/(?:require\(|from\s+)\s*['"]((?:@[\w.-]+\/)?[\w.-]+)['"]/g)]
        .map((m) => m[1]!)
        .filter((m) => !m.startsWith('.') && !m.startsWith('node:')),
    ),
  ];
  return {
    signals: [...signals],
    evidence: evidence.sort((a, b) => a.line - b.line),
    description: leadingComment(lines),
    imports: [...imports],
    helpers,
  };
}

/** The first meaningful comment near the top of a file (skipping licences, lint pragmas). */
export function leadingComment(lines: string[]): string | undefined {
  const head = lines.slice(0, 80);
  for (let i = 0; i < head.length; i++) {
    const line = head[i]!.trim();
    // Only comments before the code starts describe the file (not helpers deeper in a bundle).
    if (!line || line.startsWith('#!') || /^['"]use strict['"];?$/.test(line)) continue;
    if (!line.startsWith('/') && !line.startsWith('*')) {
      if (/^(?:const|let|var|import)\b.*(?:require\(|from\s)/.test(line)) continue;
      return undefined;
    }
    let text: string;
    if (line.startsWith('/*')) {
      const block: string[] = [];
      for (let j = i; j < head.length; j++) {
        block.push(head[j]!);
        if (head[j]!.includes('*/')) {
          i = j;
          break;
        }
      }
      text = block.map((l) => l.replace(/\/\*+|\*+\//g, ' ').replace(/^\s*\*+\s?/, '')).join(' ');
    } else if (line.startsWith('//')) {
      const block: string[] = [];
      let j = i;
      for (; j < head.length && head[j]!.trim().startsWith('//'); j++) {
        block.push(head[j]!.trim().replace(/^\/\/+\s?/, ''));
      }
      i = j - 1;
      text = block.join(' ');
    } else {
      continue;
    }
    text = text.replace(/\s+/g, ' ').trim().replace(/^!\s*/, '');
    if (text.length < 25) continue;
    if (
      /^(?:eslint|@license|copyright|\(c\)|mit license|prettier-ignore|global |jshint|istanbul|@ts-)/i.test(
        text,
      )
    )
      continue;
    if (/^#!/.test(text)) continue;
    return text.length > 320 ? `${text.slice(0, 317)}…` : text;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const NATIVE_HELPERS =
  /^(?:node-gyp-build|node-gyp-build-optional-packages|prebuild-install|@mapbox\/node-pre-gyp|node-pre-gyp|bindings|cmake-js)$/;
const BINARY_CHECK_HELPERS = /^(?:napi-postinstall)$/;
const MESSAGE_HELPERS = /^(?:opencollective-postinstall|@opencollective\/postinstall)$/;

export interface Decision {
  category: Category;
  recommendation: Recommendation;
  reason: string;
}

/** Combine command and source analysis into a category and a recommendation. */
export function decide(input: {
  commandCategory?: Category;
  signals: Signal[];
  helpers: string[];
  sources: string[];
  implicitGyp: boolean;
}): Decision {
  const s = new Set(input.signals);
  let category: Category = input.commandCategory ?? 'unknown';
  if (input.implicitGyp) category = 'native-build';

  if (category === 'unknown') {
    const text = input.sources.join('\n');
    if (
      input.helpers.some((h) => NATIVE_HELPERS.test(h)) ||
      /['"`]node-gyp['"`]|node-gyp\s+rebuild|prebuild-install/.test(text)
    ) {
      category = 'native-build';
    }
    if (category !== 'unknown') {
      // already decided
    } else if (input.helpers.some((h) => BINARY_CHECK_HELPERS.test(h))) category = 'binary-check';
    else if (input.helpers.some((h) => MESSAGE_HELPERS.test(h))) category = 'message';
    else if (/optional\s*dependenc/i.test(text) && (s.has('network') || s.has('child-process'))) {
      category = 'binary-check';
    } else if (s.has('network') && s.has('writes-files')) category = 'binary-download';
    else if (s.has('console-only')) category = 'message';
  }

  if (s.has('obfuscated') || (s.has('shell') && category !== 'native-build')) {
    return {
      category,
      recommendation: 'review',
      reason: s.has('obfuscated')
        ? 'Contains eval, new Function or long encoded data. Read the code before allowing it.'
        : 'Runs shell or download commands directly. Read the command before allowing it.',
    };
  }

  switch (category) {
    case 'native-build':
      return {
        category,
        recommendation: 'allow',
        reason:
          'Builds or loads the compiled native addon this package needs at runtime; without it, requiring the package fails.',
      };
    case 'binary-download':
      return {
        category,
        recommendation: 'allow',
        reason:
          'Downloads a binary the package runs. Without it the tool will not work, unless you run its own install command later (useful in CI).',
      };
    case 'binary-check':
      return {
        category,
        recommendation: 'deny',
        reason:
          'Checks the platform binary that comes from an optional dependency and repairs it if missing. Usually safe to deny when optional dependencies install normally.',
      };
    case 'message':
      return {
        category,
        recommendation: 'deny',
        reason: 'Only prints a message (for example a funding banner). Nothing breaks without it.',
      };
    case 'git-hooks':
      return {
        category,
        recommendation: 'deny',
        reason: 'Installs git hooks. A dependency’s git hooks are not needed in your project.',
      };
    case 'codegen':
      return {
        category,
        recommendation: 'allow',
        reason: 'Generates code the package needs at runtime.',
      };
    default:
      return {
        category,
        recommendation: 'review',
        reason: 'Could not tell what this script does. Read it before deciding.',
      };
  }
}
