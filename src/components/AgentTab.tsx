/**
 * AgentTab.tsx — Local AI Research Agent UI
 *
 * Uses the RunAnywhere WASM LLM (Potency-AI) to run the full AgentX
 * research pipeline locally — no server, no API key, 100% private.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import { runResearchAgent, type PipelineStageId, type PipelineStatus, type FinalResult } from '../agent/agent';
import type { RetrievedSource } from '../agent/retrieval';

// ── Pipeline stage descriptors ──
interface StageInfo {
  id: PipelineStageId;
  label: string;
  icon: string;
  description: string;
}

const STAGES: StageInfo[] = [
  { id: 'intent',    label: 'Classify Intent',    icon: '🎯', description: 'Understanding your query' },
  { id: 'planning',  label: 'Research Planning',  icon: '📋', description: 'Breaking down into sub-tasks' },
  { id: 'retrieval', label: 'Source Retrieval',   icon: '🌐', description: 'Searching Wikipedia' },
  { id: 'analysis',  label: 'Deep Analysis',      icon: '🧠', description: 'Reasoning over sources' },
  { id: 'synthesis', label: 'Report Generation',  icon: '✍️', description: 'Streaming your report' },
  { id: 'followup',  label: 'Follow-up Questions',icon: '💡', description: 'Generating next steps' },
];

const EXAMPLE_QUERIES = [
  'How does the transformer attention mechanism work?',
  'Compare PostgreSQL vs MongoDB for analytics workloads',
  'How does Kubernetes auto-scaling work?',
  'What is RAG (Retrieval Augmented Generation)?',
  'Explain LoRA vs full fine-tuning for LLMs',
];

// ── Simple Markdown renderer ──
function MarkdownContent({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !text) return;
    const html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```mermaid\n?([\s\S]*?)```/g, '<div class="mermaid-block"><pre>$1</pre></div>')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/^#{4}\s(.+)$/gm, '<h4>$1</h4>')
      .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
      .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^\|\s(.+)\s\|$/gm, (_m, row) => {
        const cells = row.split('|').map((c: string) => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      })
      .replace(/(<tr>[\s\S]*?<\/tr>)+/g, (t) => `<table>${t}</table>`)
      .replace(/^\s*[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/(<li>[\s\S]*?<\/li>)+/g, (s) => `<ul>${s}</ul>`)
      .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[htpuolcd])(.*\S.*)$/gm, '$1');
    ref.current.innerHTML = `<p>${html}</p>`;
  }, [text]);
  return <div ref={ref} className="agent-report-body" />;
}

// ── Main component ──
export function AgentTab() {
  const loader = useModelLoader(ModelCategory.Language);

  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [stageStatuses, setStageStatuses] = useState<Record<PipelineStageId, PipelineStatus>>({
    intent: 'idle', planning: 'idle', retrieval: 'idle',
    analysis: 'idle', synthesis: 'idle', followup: 'idle',
  });
  const [stageDetails, setStageDetails] = useState<Partial<Record<PipelineStageId, string>>>({});
  const [streamText, setStreamText] = useState('');
  const [result, setResult] = useState<FinalResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Auto-scroll report while streaming
  useEffect(() => {
    if (running) {
      reportRef.current?.scrollTo({ top: reportRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [streamText, running]);

  const reset = () => {
    setStageStatuses({ intent: 'idle', planning: 'idle', retrieval: 'idle', analysis: 'idle', synthesis: 'idle', followup: 'idle' });
    setStageDetails({});
    setStreamText('');
    setResult(null);
    setError(null);
  };

  const run = useCallback(async () => {
    if (!query.trim() || running) return;

    // Ensure LLM is loaded first
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    reset();
    setRunning(true);

    await runResearchAgent(query.trim(), {
      onStageUpdate: ({ stage, status, detail }) => {
        setStageStatuses((prev) => ({ ...prev, [stage]: status }));
        if (detail) setStageDetails((prev) => ({ ...prev, [stage]: detail }));
      },
      onToken: (token) => {
        setStreamText((t) => t + token);
      },
      onComplete: (r) => {
        setResult(r);
        setStreamText('');
        setRunning(false);
      },
      onError: (msg) => {
        setError(msg);
        setRunning(false);
        setStageStatuses((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next) as PipelineStageId[]) {
            if (next[k] === 'running') next[k] = 'error';
          }
          return next;
        });
      },
    });
  }, [query, running, loader]);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const showPipeline = running || result !== null || error !== null;
  const showStream = running && streamText.length > 0;

  return (
    <div className="tab-panel agent-panel">
      {/* Model Banner */}
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="Research LLM"
      />

      {/* ── Query Input ── */}
      <div className="agent-query-area">
        <div className="agent-query-row">
          <textarea
            id="agent-query"
            className="agent-textarea"
            placeholder="Ask any technical or knowledge question…&#10;e.g. 'How does transformer attention work?' or 'Compare PostgreSQL vs MongoDB'"
            rows={2}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
            disabled={running}
          />
          <div className="agent-actions">
            {running ? (
              <button id="btn-agent-stop" className="btn btn-danger" onClick={stop}>⏹ Stop</button>
            ) : (
              <button
                id="btn-agent-run"
                className="btn btn-primary"
                disabled={!query.trim() || loader.state === 'error'}
                onClick={run}
              >
                🔬 Research
              </button>
            )}
          </div>
        </div>

        {/* Example queries */}
        {!running && !result && (
          <div className="agent-examples">
            <span className="examples-label">Try:</span>
            <div className="examples-chips">
              {EXAMPLE_QUERIES.map((q) => (
                <button key={q} className="example-chip" onClick={() => setQuery(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Offline note */}
        <div className="agent-local-badge">
          <span className="local-dot" />
          100% Local · No API Key · All inference runs on-device via WebAssembly
        </div>
      </div>

      {/* ── Pipeline Tracker ── */}
      {showPipeline && (
        <div className="agent-pipeline">
          {STAGES.map((stage) => {
            const status = stageStatuses[stage.id];
            const detail = stageDetails[stage.id];
            return (
              <div key={stage.id} className={`pipeline-step step-${status}`}>
                <div className="step-icon-wrap">
                  {status === 'running' ? (
                    <span className="step-spinner" />
                  ) : status === 'done' ? (
                    <span className="step-check">✓</span>
                  ) : status === 'error' ? (
                    <span className="step-err">✗</span>
                  ) : (
                    <span className="step-icon">{stage.icon}</span>
                  )}
                </div>
                <div className="step-body">
                  <div className="step-label">{stage.label}</div>
                  {status === 'running' && !detail && (
                    <div className="step-desc">{stage.description}</div>
                  )}
                  {detail && <div className="step-desc">{detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="agent-error">
          <span>⚠️</span>
          <div>
            <strong>Agent error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* ── Streaming output ── */}
      {showStream && (
        <div className="agent-stream" ref={reportRef}>
          <div className="stream-label">
            <span className="pulse-dot" /> Writing report…
          </div>
          <MarkdownContent text={streamText} />
        </div>
      )}

      {/* ── Final Result ── */}
      {result && (
        <div className="agent-result" ref={reportRef}>
          {/* Stats */}
          <div className="result-stats-bar">
            <span>⏱ {(result.elapsedMs / 1000).toFixed(1)}s</span>
            <span>🏷 {result.intent.category}</span>
            {result.sources.length > 0 && <span>📚 {result.sources.length} sources</span>}
            <span className="local-pill">🖥 On-Device</span>
          </div>

          {/* Report */}
          <div className="result-report">
            <MarkdownContent text={result.report} />
          </div>

          {/* Sources */}
          {result.sources.length > 0 && (
            <div className="result-section">
              <h4 className="section-title">📚 Sources</h4>
              <div className="source-grid">
                {result.sources.map((s: RetrievedSource, i: number) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" className="source-item">
                    <span className="source-num">[{i + 1}]</span>
                    <div>
                      <div className="source-name">{s.title}</div>
                      <div className="source-preview">{s.content.slice(0, 80)}…</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Follow-ups */}
          {result.followUps.length > 0 && (
            <div className="result-section">
              <h4 className="section-title">💡 Follow-up Questions</h4>
              <div className="followup-chips">
                {result.followUps.map((q, i) => (
                  <button
                    key={i}
                    className="followup-chip"
                    onClick={() => { reset(); setQuery(q); }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New research */}
          <div className="result-actions">
            <button className="btn btn-outline" onClick={() => { reset(); setQuery(''); }}>
              🔄 New Research
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
