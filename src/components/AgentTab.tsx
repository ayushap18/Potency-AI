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
    <div className="flex-1 flex flex-col p-4 md:p-8 bg-surface space-y-6 overflow-y-auto custom-scrollbar">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="Research Engine"
      />

      {/* Query Bar */}
      <div className="bg-surface-container-low rounded-2xl p-6 shadow-lg border border-outline-variant/10 flex flex-col gap-4 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -mr-32 -mt-32"></div>
        <div className="flex flex-col md:flex-row gap-4 relative z-10">
          <div className="flex-1 relative focus-within:ring-1 focus-within:ring-primary/40 rounded-xl transition-all">
            <textarea
              className="w-full bg-surface-container-high border-none rounded-xl p-4 text-on-surface text-sm focus:ring-0 placeholder:text-outline-variant/60 resize-none h-24 outline-none"
              placeholder="Ask any technical or knowledge question...&#10;e.g. 'How does transformer attention work?'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }}
              disabled={running}
            />
          </div>
          <div className="flex flex-col gap-2 justify-end">
             {running ? (
                <button 
                  className="bg-error/20 hover:bg-error/30 text-error px-8 py-3 rounded-xl font-bold text-sm tracking-wide uppercase transition-all"
                  onClick={stop}
                >
                  Halt
                </button>
             ) : (
                <button 
                  className="bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-lg shadow-primary/10 hover:shadow-primary/20 px-8 py-3 rounded-xl font-bold text-sm tracking-wide uppercase transition-all disabled:opacity-50 flex items-center gap-2 justify-center"
                  onClick={run}
                  disabled={!query.trim() || loader.state === 'error'}
                >
                  <span className="material-symbols-outlined text-xl">travel_explore</span>
                  Research
                </button>
             )}
          </div>
        </div>

        {!running && !result && (
          <div className="flex flex-col gap-2 mt-2 relative z-10">
             <span className="text-[10px] font-bold text-outline uppercase tracking-widest">Suggested Inquiries</span>
             <div className="flex flex-wrap gap-2">
               {EXAMPLE_QUERIES.map((q) => (
                 <button 
                   key={q} 
                   onClick={() => setQuery(q)}
                   className="text-xs bg-surface-container-highest/50 hover:bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 text-on-surface-variant hover:text-primary px-3 py-1.5 rounded-full transition-all text-left"
                 >
                   {q}
                 </button>
               ))}
             </div>
          </div>
        )}

        <div className="flex items-center gap-2 mt-2 text-[10px] font-bold text-primary/60 uppercase tracking-widest relative z-10">
           <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse w-max"></span>
           100% Local · No API Key · On-Device Neural Engine
        </div>
      </div>

      {showPipeline && (
        <div className="bg-surface-container-low rounded-xl p-6 overflow-x-auto shadow-inner border border-outline-variant/5">
           <div className="flex items-start min-w-max gap-8 px-4 justify-between">
             {STAGES.map((stage) => {
                const status = stageStatuses[stage.id];
                const detail = stageDetails[stage.id];
                return (
                  <div key={stage.id} className="flex flex-col items-center gap-3 w-24 text-center group">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                       status === 'running' ? 'border-primary bg-primary/10 shadow-[0_0_15px_rgba(210,197,179,0.3)]' :
                       status === 'done' ? 'border-secondary bg-secondary/10 shadow-[0_0_15px_rgba(211,197,173,0.3)]' :
                       status === 'error' ? 'border-error bg-error/10' :
                       'border-surface-container-highest bg-surface-container-high text-outline-variant'
                    }`}>
                       {status === 'running' ? (
                         <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                       ) : status === 'done' ? (
                         <span className="material-symbols-outlined text-secondary" style={{fontVariationSettings: "'FILL' 1"}}>check_circle</span>
                       ) : status === 'error' ? (
                         <span className="material-symbols-outlined text-error" style={{fontVariationSettings: "'FILL' 1"}}>cancel</span>
                       ) : (
                         <span className="text-xl">{stage.icon}</span>
                       )}
                    </div>
                    <div>
                      <h4 className={`text-[10px] font-bold uppercase tracking-widest ${
                         status === 'running' ? 'text-primary' :
                         status === 'done' ? 'text-secondary' :
                         status === 'error' ? 'text-error' :
                         'text-outline'
                      }`}>{stage.label}</h4>
                      {status === 'running' && !detail && <p className="text-[9px] text-on-surface-variant mt-1 leading-tight">{stage.description}</p>}
                      {detail && <p className="text-[9px] text-on-surface-variant mt-1 leading-tight">{detail}</p>}
                    </div>
                  </div>
                );
             })}
           </div>
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/30 rounded-xl p-4 flex gap-4 text-error">
          <span className="material-symbols-outlined">warning</span>
          <div>
            <h4 className="font-bold text-sm">Engine Failure</h4>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {showStream && (
        <div className="bg-surface-container-highest rounded-2xl p-8 border border-primary/20 shadow-lg shadow-primary/5 relative overflow-hidden" ref={reportRef}>
           <div className="absolute top-0 right-0 p-4 opacity-10">
             <span className="material-symbols-outlined text-9xl text-primary" style={{fontVariationSettings: "'FILL' 1"}}>auto_awesome</span>
           </div>
           <div className="flex items-center gap-2 mb-6 border-b border-outline-variant/10 pb-4 relative z-10">
             <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
             <h3 className="text-xs font-bold text-primary tracking-[0.2em] uppercase">Synthesizing Report</h3>
           </div>
           <div className="relative z-10 prose prose-invert prose-sm max-w-none text-on-surface leading-loose">
             <MarkdownContent text={streamText} />
           </div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6" ref={reportRef}>
           <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest">
              <span className="bg-surface-container-low border border-outline-variant/20 px-3 py-1.5 rounded-full text-on-surface-variant flex items-center gap-2">
                 <span className="material-symbols-outlined text-[14px]">timer</span>
                 {(result.elapsedMs / 1000).toFixed(1)}s
              </span>
              <span className="bg-surface-container-low border border-outline-variant/20 px-3 py-1.5 rounded-full text-on-surface-variant flex items-center gap-2">
                 <span className="material-symbols-outlined text-[14px]">category</span>
                 {result.intent.category}
              </span>
              <span className="bg-primary/20 border border-primary/30 px-3 py-1.5 rounded-full text-primary ml-auto flex items-center gap-2">
                 <span className="material-symbols-outlined text-[14px]">memory</span>
                 Local Verification
              </span>
           </div>

           <div className="bg-[#161c25] rounded-2xl p-10 shadow-xl border border-outline-variant/10 relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5">
               <span className="material-symbols-outlined text-9xl text-primary" style={{fontVariationSettings: "'FILL' 1"}}>description</span>
             </div>
             
             <div className="prose prose-invert prose-sm max-w-none text-on-surface leading-loose relative z-10 
               [&>h1]:text-3xl [&>h1]:font-extrabold [&>h1]:tracking-tight [&>h1]:text-transparent [&>h1]:bg-clip-text [&>h1]:bg-gradient-to-r [&>h1]:from-primary [&>h1]:to-primary-container [&>h1]:mb-6
               [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-primary [&>h2]:mt-8 [&>h2]:mb-4
               [&>h3]:text-lg [&>h3]:font-bold [&>h3]:text-secondary [&>h3]:mt-6 [&>h3]:mb-3
               [&_pre]:bg-[#0e141c] [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-outline-variant/20 [&_pre]:overflow-x-auto [&_code]:text-secondary [&_code]:font-mono [&_code]:text-xs
               [&_p>code]:bg-[#242a33] [&_p>code]:text-primary [&_p>code]:px-1.5 [&_p>code]:py-0.5 [&_p>code]:rounded-md [&_p>code]:font-mono [&_p>code]:text-xs
               [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 hover:[&_a]:decoration-primary
             ">
                <MarkdownContent text={result.report} />
             </div>
           </div>

           {result.sources.length > 0 && (
             <div className="bg-surface-container-low rounded-2xl p-8 border border-outline-variant/5">
                <h4 className="text-xs font-bold text-outline tracking-[0.2em] uppercase mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">local_library</span>
                  Source Citations
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   {result.sources.map((s: RetrievedSource, i: number) => (
                     <a key={i} href={s.url} target="_blank" rel="noreferrer" className="bg-[#242a33] p-4 rounded-xl flex gap-4 group hover:bg-[#2f353e] transition-colors border border-transparent hover:border-primary/20">
                        <span className="text-primary font-bold text-xs mt-0.5 shrink-0">[{i + 1}]</span>
                        <div>
                          <h5 className="text-sm font-semibold text-on-surface mb-1 line-clamp-1">{s.title}</h5>
                          <p className="text-[10px] text-on-surface-variant line-clamp-2 leading-relaxed">{s.content}</p>
                        </div>
                     </a>
                   ))}
                </div>
             </div>
           )}

           {result.followUps.length > 0 && (
             <div className="bg-surface-container-low rounded-2xl p-8 border border-outline-variant/5">
                <h4 className="text-xs font-bold text-outline tracking-[0.2em] uppercase mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">lightbulb</span>
                  Strategic Vectors
                </h4>
                <div className="flex flex-wrap gap-3">
                   {result.followUps.map((q, i) => (
                     <button
                       key={i}
                       onClick={() => { reset(); setQuery(q); }}
                       className="bg-[#242a33] text-secondary hover:text-on-secondary-container hover:bg-secondary-container/40 border border-secondary/20 hover:border-secondary/40 px-4 py-2 rounded-full text-xs font-medium cursor-pointer transition-all text-left"
                     >
                       {q}
                     </button>
                   ))}
                </div>
             </div>
           )}

           <div className="flex justify-center mt-4 pb-10">
              <button 
                className="bg-transparent border border-primary/40 text-primary hover:bg-primary/10 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all"
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
