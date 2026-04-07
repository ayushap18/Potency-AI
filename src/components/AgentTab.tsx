/**
 * AgentTab.tsx — Local AI Research Agent UI (Glassmorphism Edition)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { runResearchAgent, type PipelineStageId, type PipelineStatus, type FinalResult } from '../agent/agent';
import type { RetrievedSource } from '../agent/retrieval';
import { checkOllamaStatus } from '../services/ollama';
import { pushHistory } from '../App';

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
      .replace(/((<tr>[\s\S]*?<\/tr>))+/g, (t) => `<table>${t}</table>`)
      .replace(/^\s*[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/((<li>[\s\S]*?<\/li>))+/g, (s) => `<ul>${s}</ul>`)
      .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[htpuolcd])(.*\S.*)$/gm, '$1');
    ref.current.innerHTML = `<p>${html}</p>`;
  }, [text]);
  return <div ref={ref} className="agent-report-body" />;
}

// ── Main component ──
export function AgentTab() {
  const [ollamaReady, setOllamaReady] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  useEffect(() => {
    const check = async () => {
      const status = await checkOllamaStatus();
      setOllamaReady(status.running && status.models.some(m => m.includes('gemma4')) ? 'connected' : status.running ? 'disconnected' : 'disconnected');
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

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
    if (!query.trim() || running || ollamaReady !== 'connected') return;
    reset();
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;
    pushHistory('research', query.trim());

    await runResearchAgent(query.trim(), {
      onStageUpdate: ({ stage, status, detail, warning }) => {
        setStageStatuses((prev) => ({ ...prev, [stage]: status }));
        if (detail) setStageDetails((prev) => ({ ...prev, [stage]: detail }));
        if (warning) console.warn(`[${stage}] ${warning}`);
      },
      onToken: (token) => setStreamText((t) => t + token),
      onComplete: (r) => {
        setResult(r);
        setStreamText('');
        setRunning(false);
        abortRef.current = null;
      },
      onError: (msg) => {
        setError(msg);
        setRunning(false);
        abortRef.current = null;
        setStageStatuses((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next) as PipelineStageId[]) {
            if (next[k] === 'running') next[k] = 'error';
          }
          return next;
        });
      },
    }, { signal: controller.signal });
  }, [query, running, ollamaReady]);

  const stop = () => { 
    abortRef.current?.abort(); 
    abortRef.current = null;
    setRunning(false); 
  };

  const showPipeline = running || result !== null || error !== null;
  const showStream = running && streamText.length > 0;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto custom-scrollbar">
      {/* Ollama Status */}
      {ollamaReady === 'disconnected' && (
        <div className="glass-panel rounded-xl p-4 flex items-center gap-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--ax-error)' }} />
          </span>
          <div className="flex-1">
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Ollama + Gemma 4 Required</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Run <code style={{ color: 'var(--accent)' }}>ollama serve</code> and ensure <code style={{ color: 'var(--accent)' }}>gemma4</code> is pulled.
            </p>
          </div>
        </div>
      )}
      {ollamaReady === 'connected' && (
        <div className="glass-panel rounded-xl p-3 flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--success)' }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: 'var(--success)' }} />
          </span>
          <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>Gemma 4 via Ollama</span>
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>Local · 9.6GB · No API Key</span>
        </div>
      )}
      {ollamaReady === 'checking' && (
        <div className="glass-panel rounded-xl p-3 flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Checking Ollama...</span>
        </div>
      )}

      {/* ── Query Bar ── */}
      <div className="query-hero">
        <div className="query-glow" />
        <div className="query-box p-6 flex flex-col gap-4">
          <div className="query-accent-line" />
          <div className="flex flex-col md:flex-row gap-4 relative z-10">
            <div className="flex-1 relative">
              <textarea
                id="query-input"
                className="w-full p-4 text-sm h-24 rounded-xl"
                style={{ background: 'var(--glass-bg)', color: 'var(--text-primary)' }}
                placeholder={`Ask any technical or knowledge question...\ne.g. 'How does transformer attention work?'`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
                disabled={running}
              />
            </div>
            <div className="flex flex-col gap-2 justify-end">
              {running ? (
                <button
                  className="research-btn"
                  style={{ color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}
                  onClick={stop}
                >
                  Halt
                </button>
              ) : (
                <button
                  className="research-btn"
                  onClick={run}
                  disabled={!query.trim() || ollamaReady !== 'connected'}
                >
                  <span className="material-symbols-outlined text-xl mr-2">travel_explore</span>
                  Research
                </button>
              )}
            </div>
          </div>

          {!running && !result && (
            <div className="flex flex-col gap-2 mt-2 relative z-10">
              <span className="text-[10px] font-bold uppercase tracking-widest font-mono" style={{ color: 'var(--text-muted)' }}>
                Suggested Inquiries
              </span>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuery(q)}
                    className="glass-panel px-3 py-1.5 rounded-full text-xs text-left transition-all"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-2 text-[10px] font-bold uppercase tracking-widest relative z-10 font-mono" style={{ color: 'var(--accent)' }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
            Gemma 4 · Ollama · 100% Local · No API Key
          </div>
        </div>
      </div>

      {/* ── Pipeline ── */}
      {showPipeline && (
        <div className="glass-panel-strong rounded-xl p-6 overflow-x-auto">
          <div className="flex items-start min-w-max gap-4 px-2 justify-between">
            {STAGES.map((stage) => {
              const status = stageStatuses[stage.id];
              const detail = stageDetails[stage.id];
              return (
                <div key={stage.id} className={`stage-node ${status}`}>
                  <div className="stage-icon">
                    {status === 'running' ? (
                      <span className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                    ) : status === 'done' ? (
                      <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1", color: '#34d399' }}>check_circle</span>
                    ) : status === 'partial' ? (
                      <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1", color: '#fbbf24' }}>warning</span>
                    ) : status === 'error' ? (
                      <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1", color: '#f87171' }}>cancel</span>
                    ) : (
                      <span className="text-lg">{stage.icon}</span>
                    )}
                  </div>
                  <div className="text-center">
                    <h4 className="stage-label">{stage.label}</h4>
                    {status === 'running' && !detail && (
                      <p className="text-[9px] mt-1 leading-tight" style={{ color: 'var(--text-muted)' }}>{stage.description}</p>
                    )}
                    {detail && <p className="text-[9px] mt-1 leading-tight" style={{ color: 'var(--text-muted)' }}>{detail}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="glass-panel rounded-xl p-4 flex gap-4" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--ax-error)' }}>warning</span>
          <div>
            <h4 className="font-bold text-sm" style={{ color: 'var(--ax-error)' }}>Engine Failure</h4>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{error}</p>
          </div>
        </div>
      )}

      {/* ── Stream ── */}
      {showStream && (
        <div className="glass-panel-elevated rounded-2xl p-8 relative overflow-hidden" ref={reportRef}>
          <div className="flex items-center gap-2 mb-6 pb-4 relative z-10" style={{ borderBottom: '1px solid var(--glass-border)' }}>
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
            <h3 className="text-xs font-bold tracking-[0.2em] uppercase" style={{ color: 'var(--accent)' }}>Synthesizing Report</h3>
          </div>
          <div className="relative z-10 prose prose-sm max-w-none leading-loose" style={{ color: 'var(--text-primary)' }}>
            <MarkdownContent text={streamText} />
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div className="flex flex-col gap-6" ref={reportRef}>
          {/* Meta badges */}
          <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest">
            <span className="glass-panel px-3 py-1.5 rounded-full flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <span className="material-symbols-outlined text-[14px]">timer</span>
              {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
            <span className="glass-panel px-3 py-1.5 rounded-full flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <span className="material-symbols-outlined text-[14px]">category</span>
              {result.intent.category}
            </span>
            <span className="glass-panel px-3 py-1.5 rounded-full flex items-center gap-2 ml-auto" style={{ color: 'var(--accent)' }}>
              <span className="material-symbols-outlined text-[14px]">memory</span>
              Local Verification
            </span>
          </div>

          {/* Report body */}
          <div className="glass-panel-elevated rounded-2xl p-10 relative overflow-hidden">
            <div className="prose prose-sm max-w-none leading-loose relative z-10" style={{ color: 'var(--text-primary)' }}>
              <MarkdownContent text={result.report} />
            </div>
          </div>

          {/* Sources */}
          {result.sources.length > 0 && (
            <div className="glass-panel-strong rounded-2xl p-8">
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-6 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                <span className="material-symbols-outlined text-sm">local_library</span>
                Source Citations
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.sources.map((s: RetrievedSource, i: number) => (
                  <a key={i} href={s.url} target="_blank" rel="noreferrer" className="glass-panel p-4 rounded-xl flex gap-4 group">
                    <span className="font-bold text-xs mt-0.5 shrink-0" style={{ color: 'var(--accent)' }}>[{i + 1}]</span>
                    <div>
                      <h5 className="text-sm font-semibold mb-1 line-clamp-1" style={{ color: 'var(--text-primary)' }}>{s.title}</h5>
                      <p className="text-[10px] line-clamp-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{s.content}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Follow-ups */}
          {result.followUps.length > 0 && (
            <div className="glass-panel-strong rounded-2xl p-8">
              <h4 className="text-xs font-bold tracking-[0.2em] uppercase mb-6 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                <span className="material-symbols-outlined text-sm">lightbulb</span>
                Strategic Vectors
              </h4>
              <div className="flex flex-wrap gap-3">
                {result.followUps.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { reset(); setQuery(q); }}
                    className="glass-panel px-4 py-2 rounded-full text-xs font-medium cursor-pointer text-left"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reset */}
          <div className="flex justify-center mt-4 pb-10">
            <button
              className="research-btn"
              style={{ background: 'transparent' }}
              onClick={() => { reset(); setQuery(''); }}
            >
              Initialize New Research
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
