import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  FileImage,
  FileJson,
  FileText,
  FolderDown,
  Globe2,
  Image,
  Layers3,
  Link2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Terminal,
  WandSparkles,
} from "lucide-react";

const repairRules = [
  {
    icon: Code2,
    label: "CSS参照",
    value: "url() / @import",
    detail: "CSSファイル基準で再解決",
  },
  {
    icon: Image,
    label: "画像",
    value: "srcset / lazy attr",
    detail: "data-src系も通常srcへ昇格",
  },
  {
    icon: FileText,
    label: "フォント",
    value: "woff2 / ttf / otf",
    detail: "preloadとCSS内参照を保存",
  },
  {
    icon: WandSparkles,
    label: "欠損補完",
    value: "SVG placeholder",
    detail: "失敗画像を表示可能な代替へ",
  },
];

const outputFiles = [
  { icon: FileText, label: "index.html", type: "rewritten HTML" },
  { icon: Archive, label: "assets/", type: "CSS, images, fonts, scripts" },
  { icon: FileJson, label: "copy-the-page-manifest.json", type: "download result log" },
  { icon: FileText, label: "README.md", type: "local entry guide" },
];

const phases = [
  "HTML",
  "CSS",
  "画像",
  "フォント",
  "リンク",
  "manifest",
];

function App() {
  const [targetUrl, setTargetUrl] = useState("https://example.com");
  const [outputDir, setOutputDir] = useState("copies/example-com");
  const [depth, setDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(12);
  const [keepScripts, setKeepScripts] = useState(true);
  const [cleanOutput, setCleanOutput] = useState(true);
  const [externalPages, setExternalPages] = useState(false);
  const [copyState, setCopyState] = useState("idle");

  const host = hostFromUrl(targetUrl);
  const command = [
    "npm run copy --",
    shellQuote(targetUrl || "https://example.com"),
    "--output",
    shellQuote(outputDir || "copies/site"),
    "--depth",
    depth,
    "--max-pages",
    maxPages,
    cleanOutput ? "--clean" : "",
    externalPages ? "--external-pages" : "",
    keepScripts ? "" : "--no-scripts",
  ]
    .filter(Boolean)
    .join(" ");

  async function copyCommand() {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(command);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#job">
          <span className="brand-mark">
            <FolderDown size={20} aria-hidden="true" />
          </span>
          <span>
            <strong>Copy the Page</strong>
            <small>static page copier</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <a href="#job">Job</a>
          <a href="#repair">Repair</a>
          <a href="#output">Output</a>
        </nav>
      </header>

      <main className="workspace">
        <section className="intro-band">
          <div className="intro-copy">
            <h1>CSSと画像を崩さず保存するサイトコピー</h1>
          </div>
          <div className="host-chip">
            <Globe2 size={18} aria-hidden="true" />
            <span>{host}</span>
          </div>
        </section>

        <section className="layout-grid" id="job" aria-label="Copy job">
          <form className="control-panel" onSubmit={(event) => event.preventDefault()}>
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">source</span>
                <h2>コピー対象</h2>
              </div>
              <Settings2 size={20} aria-hidden="true" />
            </div>

            <label className="field">
              <span>URL</span>
              <div className="input-shell">
                <Globe2 size={18} aria-hidden="true" />
                <input
                  value={targetUrl}
                  onChange={(event) => setTargetUrl(event.target.value)}
                  inputMode="url"
                  spellCheck="false"
                />
              </div>
            </label>

            <label className="field">
              <span>出力先</span>
              <div className="input-shell">
                <Archive size={18} aria-hidden="true" />
                <input
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                  spellCheck="false"
                />
              </div>
            </label>

            <div className="range-grid">
              <label className="range-field">
                <span>深さ</span>
                <strong>{depth}</strong>
                <input
                  type="range"
                  min="0"
                  max="4"
                  value={depth}
                  onChange={(event) => setDepth(Number(event.target.value))}
                />
              </label>

              <label className="range-field">
                <span>最大ページ</span>
                <strong>{maxPages}</strong>
                <input
                  type="range"
                  min="1"
                  max="80"
                  value={maxPages}
                  onChange={(event) => setMaxPages(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="toggle-stack">
              <Toggle
                checked={keepScripts}
                icon={Code2}
                label="scriptを保存"
                onChange={setKeepScripts}
              />
              <Toggle
                checked={cleanOutput}
                icon={RefreshCw}
                label="出力先を初期化"
                onChange={setCleanOutput}
              />
              <Toggle
                checked={externalPages}
                icon={ExternalLink}
                label="外部HTMLも巡回"
                onChange={setExternalPages}
              />
            </div>
          </form>

          <section className="run-panel" aria-label="Run command">
            <div className="run-header">
              <div>
                <span className="panel-kicker">command</span>
                <h2>実行</h2>
              </div>
              <span className="status-pill">
                <CheckCircle2 size={15} aria-hidden="true" />
                ready
              </span>
            </div>

            <div className="command-box" id="command">
              <Terminal size={18} aria-hidden="true" />
              <code>{command}</code>
            </div>

            <div className="action-row">
              <button className="primary-button" type="button" onClick={copyCommand}>
                {copyState === "copied" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <Clipboard size={18} aria-hidden="true" />
                )}
                {copyButtonLabel(copyState)}
              </button>
              <a className="secondary-button" href="#output">
                <Play size={18} aria-hidden="true" />
                出力を見る
              </a>
            </div>

            <div className="phase-rail" aria-label="Pipeline">
              {phases.map((phase) => (
                <span key={phase}>{phase}</span>
              ))}
            </div>
          </section>
        </section>

        <section className="metrics-row" aria-label="Copy summary">
          <Metric icon={Layers3} label="page budget" value={`${maxPages}`} />
          <Metric icon={Link2} label="crawl depth" value={`${depth}`} />
          <Metric icon={FileImage} label="asset modes" value="6" />
          <Metric icon={ShieldCheck} label="fallbacks" value="4" />
        </section>

        <section className="repair-section" id="repair" aria-label="Repair rules">
          <div className="section-heading">
            <span className="panel-kicker">repair</span>
            <h2>補完ルール</h2>
          </div>
          <div className="rule-grid">
            {repairRules.map(({ icon: Icon, label, value, detail }) => (
              <article className="rule-card" key={label}>
                <Icon size={22} aria-hidden="true" />
                <div>
                  <h3>{label}</h3>
                  <strong>{value}</strong>
                  <p>{detail}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="output-section" id="output" aria-label="Output files">
          <div className="section-heading">
            <span className="panel-kicker">output</span>
            <h2>生成物</h2>
          </div>
          <div className="output-list">
            {outputFiles.map(({ icon: Icon, label, type }) => (
              <div className="output-row" key={label}>
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
                <small>{type}</small>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function Toggle({ checked, icon: Icon, label, onChange }) {
  return (
    <label className="toggle-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </label>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <article className="metric-card">
      <Icon size={20} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname || "new site";
  } catch {
    return "new site";
  }
}

function copyButtonLabel(state) {
  if (state === "copied") return "コピー済み";
  if (state === "manual") return "手動で選択";
  return "コマンドをコピー";
}

function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export default App;
