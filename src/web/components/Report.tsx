import { useMemo, useState } from 'preact/hooks';
import { configSnippets, defaultDecisions, type Decisions } from '../../core/config';
import {
  CATEGORY_LABEL,
  counts,
  RECOMMENDATION_LABEL,
  SIGNAL_LABEL,
  toMarkdown,
} from '../../core/report';
import type {
  PackageManager,
  ScanReport,
  ScriptFile,
  ScriptVerdict,
  Signal,
} from '../../core/types';
import { CopyButton } from './CopyButton';

const TONE = { allow: 'var(--allow)', deny: 'var(--deny)', review: 'var(--review)' } as const;
const WARN: Signal[] = ['obfuscated', 'shell', 'network'];

export function Report({ report, onReset }: { report: ScanReport; onReset: () => void }) {
  const [decisions, setDecisions] = useState<Decisions>(() => defaultDecisions(report.verdicts));
  const [manager, setManager] = useState<PackageManager>(report.lockfile.manager);
  const [pin, setPin] = useState(true);
  const c = counts(report);
  const snippets = useMemo(
    () => configSnippets(report.verdicts, decisions, pin),
    [report, decisions, pin],
  );
  const current = snippets.find((s) => s.manager === manager)!;
  const allowed = report.verdicts.filter((v) => decisions.get(v.key)).length;

  const set = (key: string, allow: boolean) => {
    const next = new Map(decisions);
    next.set(key, allow);
    setDecisions(next);
  };

  return (
    <main id="main" class="wrap">
      <header class="report-head">
        <div>
          <p class="meta">
            {report.lockfile.fileName ?? 'pasted lockfile'} · {report.lockfile.manager} ·{' '}
            {report.totalPackages} packages
          </p>
          <h1 data-testid="headline">
            {report.verdicts.length === 0
              ? 'No dependency runs an install script'
              : `${report.verdicts.length} ${report.verdicts.length === 1 ? 'dependency runs' : 'dependencies run'} install scripts`}
          </h1>
        </div>
        <div class="tally" aria-label="Recommendations">
          <span class="t-allow">{c.allow} allow</span>
          <span class="t-deny">{c.deny} deny</span>
          <span class="t-review">{c.review} review</span>
        </div>
      </header>

      {report.errors.map((e) => (
        <p class="alert" role="alert" key={e} style={{ marginBottom: '14px' }}>
          {e}
        </p>
      ))}

      {report.verdicts.length === 0 ? (
        <div class="empty">
          <p>
            Nothing to allow: none of the {report.totalPackages} packages has a preinstall, install
            or postinstall script.
          </p>
          <button type="button" class="btn" onClick={onReset}>
            Check another lockfile
          </button>
        </div>
      ) : (
        <div class="layout">
          <div class="cards">
            {report.verdicts.map((v) => (
              <Card
                key={v.key}
                v={v}
                allow={decisions.get(v.key) ?? false}
                onChange={(a) => set(v.key, a)}
              />
            ))}
          </div>
          <aside class="side" aria-labelledby="config-title">
            <div class="row-between">
              <h2 id="config-title">Your allowlist</h2>
              <span class="small">
                {allowed} allowed · {report.verdicts.length - allowed} denied
              </span>
            </div>
            <div class="tabs" role="tablist" aria-label="Package manager">
              {snippets.map((s) => (
                <button
                  type="button"
                  role="tab"
                  key={s.manager}
                  aria-selected={s.manager === manager}
                  onClick={() => setManager(s.manager)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div class="row-between">
              <code class="small">{current.file}</code>
              <CopyButton text={current.code} />
            </div>
            <pre class="snippet" data-testid="snippet">
              <code>{current.code}</code>
            </pre>
            <p class="small">{current.note}</p>
            {(manager === 'npm' || manager === 'pnpm') && (
              <label class="check-label">
                <input
                  type="checkbox"
                  checked={pin}
                  onChange={(e) => setPin(e.currentTarget.checked)}
                />
                Pin to these exact versions
              </label>
            )}
            <div class="row-between">
              <CopyButton text={() => toMarkdown(report)} label="Copy report (Markdown)" />
              <button type="button" class="btn btn-sm" onClick={onReset}>
                Check another
              </button>
            </div>
          </aside>
        </div>
      )}
      {report.notes.length > 0 && (
        <div style={{ paddingBottom: '48px' }}>
          {report.notes.map((n) => (
            <p class="small" key={n}>
              {n}
            </p>
          ))}
        </div>
      )}
    </main>
  );
}

function Card({
  v,
  allow,
  onChange,
}: {
  v: ScriptVerdict;
  allow: boolean;
  onChange: (allow: boolean) => void;
}) {
  const description = v.files.find((f) => f.description)?.description;
  return (
    <article class="card" style={{ '--tone': TONE[v.recommendation] }} data-testid="card">
      <div class="card-top">
        <span class="card-name">
          {v.name}
          <span class="ver">@{v.version}</span>
          {v.direct && <span class="tag">direct</span>}
          {v.dev && <span class="tag">dev</span>}
        </span>
        <span class="toggle" role="group" aria-label={`Decision for ${v.key}`}>
          <button type="button" class="allow" aria-pressed={allow} onClick={() => onChange(true)}>
            Allow
          </button>
          <button type="button" class="deny" aria-pressed={!allow} onClick={() => onChange(false)}>
            Deny
          </button>
        </span>
      </div>
      <div class="hooks">
        {Object.entries(v.hooks).map(([hook, cmd]) => (
          <code key={hook}>
            <span class="hook">{hook}: </span>
            {cmd}
            {v.implicitGyp && hook === 'install' && (
              <span class="hook"> (implicit: binding.gyp)</span>
            )}
          </code>
        ))}
      </div>
      <p class="reason">
        <b style={{ color: TONE[v.recommendation] }}>
          {RECOMMENDATION_LABEL[v.recommendation]} · {CATEGORY_LABEL[v.category]}
        </b>
        {v.reason}
      </p>
      {v.note && <p class="note">{v.note}</p>}
      {description && <p class="says">The script says: “{description}”</p>}
      {v.signals.length > 0 && (
        <div class="signals">
          {v.signals.map((s) => (
            <span key={s} class={`signal${WARN.includes(s) ? ' warn' : ''}`}>
              {SIGNAL_LABEL[s]}
            </span>
          ))}
        </div>
      )}
      {v.files.map((f) => (
        <Source key={f.path} v={v} file={f} />
      ))}
    </article>
  );
}

function Source({ v, file }: { v: ScriptVerdict; file: ScriptFile }) {
  const hits = new Set(file.evidence.map((e) => e.line));
  const lines = file.excerpt.split('\n');
  const outside = file.evidence.filter((e) => e.line > lines.length);
  return (
    <details class="source">
      <summary>
        {file.path} · {(file.bytes / 1024).toFixed(1)} KB
        {file.evidence.length > 0 &&
          ` · ${file.evidence.length} notable line${file.evidence.length > 1 ? 's' : ''}`}
      </summary>
      <pre class="code">
        {lines.map((line, i) => (
          <span class={`row${hits.has(i + 1) ? ' hit' : ''}`} key={i}>
            <span class="ln">{i + 1}</span>
            {line.length > 220 ? `${line.slice(0, 220)}…` : line}
          </span>
        ))}
      </pre>
      {outside.length > 0 && (
        <ul class="evidence">
          {outside.map((e) => (
            <li key={`${e.line}-${e.signal}`}>
              line {e.line} ({SIGNAL_LABEL[e.signal]}): <code>{e.text}</code>
            </li>
          ))}
        </ul>
      )}
      <p class="small" style={{ marginTop: '6px' }}>
        <a
          href={`https://cdn.jsdelivr.net/npm/${v.name}@${v.version}/${file.path}`}
          target="_blank"
          rel="noreferrer"
        >
          Full file on jsDelivr
        </a>
      </p>
    </details>
  );
}
