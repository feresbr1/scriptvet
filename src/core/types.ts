export type LockfileFormat = 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry' | 'bun';
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** One resolved package version found in a lockfile. */
export interface LockedPackage {
  name: string;
  version: string;
  direct?: boolean;
  dev?: boolean;
  optional?: boolean;
  /** The lockfile records whether this package has install scripts. Undefined when it does not say. */
  hasInstallScript?: boolean;
  source?: 'registry' | 'git' | 'file' | 'url' | 'other-registry';
}

export interface ParsedLockfile {
  format: LockfileFormat;
  manager: PackageManager;
  lockfileVersion: string;
  packages: LockedPackage[];
  skipped: { name: string; spec: string; reason: string }[];
  warnings: string[];
}

export type Hook = 'preinstall' | 'install' | 'postinstall';

/** What an install script does, as far as we can tell. */
export type Category =
  | 'native-build' // compiles or fetches a native addon (node-gyp, prebuild-install, node-gyp-build)
  | 'binary-download' // downloads a tool or browser binary
  | 'binary-check' // verifies a platform binary from optionalDependencies, repairs it if missing
  | 'message' // only prints (funding banners, notices)
  | 'git-hooks' // installs git hooks
  | 'codegen' // generates code needed at runtime
  | 'unknown';

export type Recommendation = 'allow' | 'deny' | 'review';

export type Signal =
  | 'network' // makes HTTP requests
  | 'child-process' // spawns processes
  | 'writes-files'
  | 'reads-env'
  | 'console-only'
  | 'errors-ignored' // wrapped so failures do not break the install
  | 'shell' // runs shell commands directly (curl, bash -c, powershell)
  | 'obfuscated' // eval, new Function, or long encoded blobs
  | 'platform-specific'; // only installed on some operating systems

export interface ScriptFile {
  path: string;
  /** First lines of the file, for display. */
  excerpt: string;
  /** The file's own leading comment, when it has one. */
  description?: string;
  /** Lines that triggered signals, with line numbers. */
  evidence: { line: number; text: string; signal: Signal }[];
  bytes: number;
}

export interface ScriptVerdict {
  name: string;
  version: string;
  key: string;
  direct?: boolean;
  dev?: boolean;
  optional?: boolean;
  /** Install hooks that will run, including npm's implicit `node-gyp rebuild` for binding.gyp. */
  hooks: Partial<Record<Hook, string>>;
  implicitGyp: boolean;
  os?: string[];
  category: Category;
  recommendation: Recommendation;
  /** One-sentence explanation of the recommendation. */
  reason: string;
  signals: Signal[];
  files: ScriptFile[];
  /** A curated note, for well-known packages. */
  note?: string;
}

export interface ScanReport {
  tool: { name: 'scriptvet'; version: string };
  scannedAt: string;
  lockfile: {
    format: LockfileFormat;
    manager: PackageManager;
    lockfileVersion: string;
    fileName?: string;
  };
  totalPackages: number;
  checkedPackages: number;
  verdicts: ScriptVerdict[];
  notes: string[];
  errors: string[];
}

export interface ScanProgress {
  stage: 'manifests' | 'files' | 'done';
  done: number;
  total: number;
}
