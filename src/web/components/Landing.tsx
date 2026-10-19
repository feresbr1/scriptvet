import { useEffect, useRef, useState } from 'preact/hooks';
import { SUPPORTED_LOCKFILES } from '../../core/parsers';
import { CopyButton } from './CopyButton';

const MAX_BYTES = 50 * 1024 * 1024;
const COMMAND = 'npx github:feresbr1/scriptvet';

interface LandingProps {
  onScan: (text: string, fileName?: string) => void;
  error?: string;
}

export function Landing({ onScan, error }: LandingProps) {
  const [over, setOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [readError, setReadError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  const readFile = async (file: File | undefined) => {
    setReadError(undefined);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setReadError(`${file.name} is larger than 50 MB.`);
      return;
    }
    try {
      onScan(await file.text(), file.name);
    } catch {
      setReadError(`Could not read ${file.name}.`);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (text.trim().length > 20) {
        e.preventDefault();
        onScan(text);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const loadSample = async () => {
    setReadError(undefined);
    try {
      const mod = await import('../../../examples/demo-app/package-lock.json?raw');
      onScan(mod.default, 'package-lock.json');
    } catch {
      setReadError('Could not load the sample.');
    }
  };

  const shown = readError ?? error;
  return (
    <main id="main">
      <section class="hero wrap">
        <span class="pill">npm 12, pnpm 11 and Bun now block install scripts by default</span>
        <h1>
          Your dependencies' install scripts are blocked now. <span>Which ones do you need?</span>
        </h1>
        <p class="lede">
          Drop a lockfile. scriptvet finds every dependency with a <code>preinstall</code>,{' '}
          <code>install</code> or <code>postinstall</code> script, reads the code it runs, tells you
          what it does and whether to allow it, and writes the allowlist for your package manager.
        </p>

        <div
          class={`drop${over ? ' is-over' : ''}`}
          data-testid="dropzone"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void readFile(e.dataTransfer?.files[0]);
          }}
        >
          <h2>Drop your lockfile</h2>
          <p>or click to choose · or paste it anywhere with Ctrl/⌘ + V</p>
          <div class="files">
            {SUPPORTED_LOCKFILES.map((f) => (
              <code key={f}>{f}</code>
            ))}
          </div>
          <div class="actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" class="btn btn-primary" onClick={() => input.current?.click()}>
              Choose lockfile
            </button>
            <button
              type="button"
              class="btn"
              aria-expanded={pasteOpen}
              onClick={() => setPasteOpen(!pasteOpen)}
            >
              Paste text
            </button>
            <button type="button" class="linkish" onClick={() => void loadSample()}>
              or try a sample with 14 install scripts
            </button>
          </div>
          <input
            ref={input}
            type="file"
            class="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            accept=".json,.yaml,.yml,.lock,text/plain,application/json"
            onChange={(e) => {
              void readFile(e.currentTarget.files?.[0]);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {pasteOpen && (
          <form
            style={{ marginTop: '14px', display: 'grid', gap: '10px' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) onScan(pasted);
            }}
          >
            <label class="sr-only" for="paste">
              Lockfile contents
            </label>
            <textarea
              id="paste"
              value={pasted}
              spellcheck={false}
              placeholder="Paste package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock"
              onInput={(e) => setPasted(e.currentTarget.value)}
            />
            <div>
              <button type="submit" class="btn btn-primary" disabled={!pasted.trim()}>
                Check pasted lockfile
              </button>
            </div>
          </form>
        )}
        {shown && (
          <p class="alert" role="alert">
            {shown}
          </p>
        )}

        <div class="below">
          <div>
            <h3>Reads the actual code</h3>
            <p>
              Each script command and the files it runs are fetched for the exact version in your
              lockfile and checked for network calls, child processes, file writes and obfuscation.
            </p>
          </div>
          <div>
            <h3>Writes your allowlist</h3>
            <p>
              <code>allowScripts</code> for npm, <code>allowBuilds</code> for pnpm,{' '}
              <code>dependenciesMeta</code> for Yarn, <code>trustedDependencies</code> for Bun,
              pinned to the versions you reviewed.
            </p>
          </div>
          <div>
            <h3>Private, or in your terminal</h3>
            <p>
              The lockfile stays in this tab; only package names and versions go to the npm registry
              and jsDelivr. Or run it locally and let it edit your config:
            </p>
            <div class="cmd">
              <code>{COMMAND} --write</code>
              <CopyButton text={`${COMMAND} --write`} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
