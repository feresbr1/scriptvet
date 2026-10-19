import { useEffect, useRef, useState } from 'preact/hooks';
import { analyzeLockfile } from '../core/analyze';
import { LockfileError, parseLockfile } from '../core/parsers';
import type { ScanProgress, ScanReport } from '../core/types';
import { VERSION } from '../core/version';
import { Landing } from './components/Landing';
import { Report } from './components/Report';
import { storage } from './storage';

const REPO = 'https://github.com/feresbr1/scriptvet';

type State =
  | { view: 'landing'; error?: string }
  | { view: 'scanning'; progress: ScanProgress; count: number }
  | { view: 'report'; report: ScanReport };

export function App() {
  const [state, setState] = useState<State>({ view: 'landing' });
  const [theme, setTheme] = useState(() => storage.get('theme') ?? undefined);
  const scanId = useRef(0);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  useEffect(() => {
    const onPop = () => {
      scanId.current++;
      setState({ view: 'landing' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const scan = async (text: string, fileName?: string) => {
    const id = ++scanId.current;
    let lockfile;
    try {
      lockfile = parseLockfile(text, fileName);
    } catch (error) {
      setState({
        view: 'landing',
        error:
          error instanceof LockfileError
            ? error.message
            : `Could not read this lockfile (${(error as Error).message}).`,
      });
      return;
    }
    const count = lockfile.packages.length;
    setState({ view: 'scanning', count, progress: { stage: 'manifests', done: 0, total: count } });
    window.scrollTo({ top: 0 });
    try {
      const report = await analyzeLockfile(lockfile, {
        fileName,
        onProgress: (progress) => {
          if (scanId.current === id) setState({ view: 'scanning', count, progress });
        },
      });
      if (scanId.current !== id) return;
      history.pushState({ report: true }, '', '#report');
      setState({ view: 'report', report });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (scanId.current === id) {
        setState({ view: 'landing', error: `Check failed: ${(error as Error).message}` });
      }
    }
  };

  const reset = () => {
    scanId.current++;
    if (location.hash === '#report') history.back();
    else setState({ view: 'landing' });
  };

  const toggleTheme = () => {
    const dark = theme
      ? theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    storage.set('theme', next);
  };

  return (
    <>
      <a class="sr-only" href="#main">
        Skip to content
      </a>
      <header class="site-header">
        <div class="wrap">
          <button type="button" class="brand" onClick={reset} aria-label="scriptvet home">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="5"
                stroke="currentColor"
                stroke-width="1.8"
              />
              <path
                d="m7.5 12.5 3 3 6-7"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            scriptvet
          </button>
          <nav class="nav" aria-label="Site">
            <a class="hide-sm" href={`${REPO}#command-line`}>
              CLI
            </a>
            <button type="button" onClick={toggleTheme} aria-label="Toggle dark mode">
              ◐
            </button>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>
      {state.view === 'landing' && (
        <Landing onScan={(t, f) => void scan(t, f)} error={state.error} />
      )}
      {state.view === 'scanning' && (
        <main id="main" class="wrap progress" aria-busy="true">
          <h1 style={{ margin: 0, fontSize: '26px', letterSpacing: '-0.02em' }}>
            {state.progress.stage === 'manifests'
              ? `Checking ${state.count.toLocaleString('en-US')} packages for install scripts…`
              : 'Reading the scripts…'}
          </h1>
          <div
            class="bar"
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct(state.progress)}
          >
            <span style={{ width: `${pct(state.progress)}%` }} />
          </div>
          <p class="small" aria-live="polite">
            {state.progress.done.toLocaleString('en-US')} /{' '}
            {state.progress.total.toLocaleString('en-US')}
          </p>
        </main>
      )}
      {state.view === 'report' && <Report report={state.report} onReset={reset} />}
      <footer class="site-footer">
        <div class="wrap">
          <span>
            scriptvet v{VERSION} · MIT · <a href={`${REPO}/issues`}>report an issue</a>
          </span>
          <span>Manifests from registry.npmjs.org · files from jsDelivr · nothing uploaded</span>
        </div>
      </footer>
    </>
  );
}

function pct(p: ScanProgress): number {
  const within = p.total ? p.done / p.total : 1;
  return Math.round((p.stage === 'manifests' ? within * 0.7 : 0.7 + within * 0.3) * 100);
}
