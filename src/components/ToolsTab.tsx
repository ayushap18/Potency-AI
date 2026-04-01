import { ModelCategory } from '@runanywhere/web';
import {
  ToolCalling, ToolCallFormat, toToolValue, getStringArg, getNumberArg,
  type ToolDefinition, type ToolCall, type ToolResult, type ToolCallingResult, type ToolValue,
} from '@runanywhere/web-llamacpp';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

// ── Demo tools ──
const DEMO_TOOLS: { def: ToolDefinition; executor: Parameters<typeof ToolCalling.registerTool>[1] }[] = [
  {
    def: { name: 'get_weather', description: 'Gets the current weather for a city.', parameters: [{ name: 'location', type: 'string', description: 'City name', required: true }], category: 'Utility' },
    executor: async (args) => {
      const city = getStringArg(args, 'location') ?? 'Unknown';
      const conditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Rainy', 'Windy', 'Foggy'];
      return { location: toToolValue(city), temperature_f: toToolValue(Math.round(45 + Math.random() * 50)), condition: toToolValue(conditions[Math.floor(Math.random() * conditions.length)]), humidity_pct: toToolValue(Math.round(30 + Math.random() * 60)) };
    },
  },
  {
    def: { name: 'calculate', description: 'Evaluates a mathematical expression.', parameters: [{ name: 'expression', type: 'string', description: 'Math expression', required: true }], category: 'Math' },
    executor: async (args): Promise<Record<string, ToolValue>> => {
      const expr = getStringArg(args, 'expression') ?? '0';
      try { const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, ''); const val = Function(`"use strict"; return (${sanitized})`)(); return { result: toToolValue(Number(val)), expression: toToolValue(expr) }; }
      catch { return { error: toToolValue(`Invalid expression: ${expr}`) }; }
    },
  },
  {
    def: { name: 'get_time', description: 'Returns the current date and time.', parameters: [{ name: 'timezone', type: 'string', description: 'IANA timezone. Defaults to UTC.', required: false }], category: 'Utility' },
    executor: async (args): Promise<Record<string, ToolValue>> => {
      const tz = getStringArg(args, 'timezone') ?? 'UTC';
      try { return { datetime: toToolValue(new Date().toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' })), timezone: toToolValue(tz) }; }
      catch { return { datetime: toToolValue(new Date().toISOString()), timezone: toToolValue('UTC'), note: toToolValue('Fell back to UTC') }; }
    },
  },
  {
    def: { name: 'random_number', description: 'Generates a random integer between min and max.', parameters: [{ name: 'min', type: 'number', description: 'Minimum', required: true }, { name: 'max', type: 'number', description: 'Maximum', required: true }], category: 'Math' },
    executor: async (args) => {
      const min = getNumberArg(args, 'min') ?? 1; const max = getNumberArg(args, 'max') ?? 100;
      return { value: toToolValue(Math.floor(Math.random() * (max - min + 1)) + min), min: toToolValue(min), max: toToolValue(max) };
    },
  },
];

interface TraceStep { type: 'user' | 'tool_call' | 'tool_result' | 'response'; content: string; detail?: ToolCall | ToolResult; }
interface ParamDraft { name: string; type: 'string' | 'number' | 'boolean'; description: string; required: boolean; }
const EMPTY_PARAM: ParamDraft = { name: '', type: 'string', description: '', required: true };

export function ToolsTab() {
  const loader = useModelLoader(ModelCategory.Language);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [autoExecute, setAutoExecute] = useState(true);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [registeredTools, setRegisteredTools] = useState<ToolDefinition[]>([]);
  const [showToolForm, setShowToolForm] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const traceRef = useRef<HTMLDivElement>(null);
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolParams, setToolParams] = useState<ParamDraft[]>([{ ...EMPTY_PARAM }]);

  useEffect(() => {
    ToolCalling.clearTools();
    for (const { def, executor } of DEMO_TOOLS) ToolCalling.registerTool(def, executor);
    setRegisteredTools(ToolCalling.getRegisteredTools());
    return () => { ToolCalling.clearTools(); };
  }, []);

  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: 'smooth' }); }, [trace]);

  const refreshRegistry = useCallback(() => setRegisteredTools(ToolCalling.getRegisteredTools()), []);

  const send = useCallback(async () => {
    const text = input.trim(); if (!text || generating) return;
    if (loader.state !== 'ready') { const ok = await loader.ensure(); if (!ok) return; }
    setInput(''); setGenerating(true); setTrace([{ type: 'user', content: text }]);
    try {
      const result: ToolCallingResult = await ToolCalling.generateWithTools(text, { autoExecute, maxToolCalls: 5, temperature: 0.3, maxTokens: 512, format: ToolCallFormat.Default });
      const steps: TraceStep[] = [{ type: 'user', content: text }];
      for (let i = 0; i < result.toolCalls.length; i++) {
        const call = result.toolCalls[i];
        const argSummary = Object.entries(call.arguments).map(([k, v]) => `${k}=${JSON.stringify('value' in v ? v.value : v)}`).join(', ');
        steps.push({ type: 'tool_call', content: `${call.toolName}(${argSummary})`, detail: call });
        if (result.toolResults[i]) {
          const res = result.toolResults[i];
          const resultStr = res.success && res.result ? JSON.stringify(Object.fromEntries(Object.entries(res.result).map(([k, v]) => [k, 'value' in v ? v.value : v])), null, 2) : res.error ?? 'Unknown error';
          steps.push({ type: 'tool_result', content: res.success ? resultStr : `Error: ${resultStr}`, detail: res });
        }
      }
      if (result.text) steps.push({ type: 'response', content: result.text });
      setTrace(steps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTrace((prev) => [...prev, { type: 'response', content: `Error: ${msg}` }]);
    } finally { setGenerating(false); }
  }, [input, generating, autoExecute, loader]);

  const addParam = () => setToolParams((p) => [...p, { ...EMPTY_PARAM }]);
  const updateParam = (idx: number, field: keyof ParamDraft, value: string | boolean) => setToolParams((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  const removeParam = (idx: number) => setToolParams((prev) => prev.filter((_, i) => i !== idx));

  const registerCustomTool = () => {
    const name = toolName.trim().replace(/\s+/g, '_').toLowerCase(); const desc = toolDesc.trim();
    if (!name || !desc) return;
    const params = toolParams.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), type: p.type as 'string' | 'number' | 'boolean', description: p.description.trim() || p.name.trim(), required: p.required }));
    const def: ToolDefinition = { name, description: desc, parameters: params, category: 'Custom' };
    const executor = async (args: Record<string, ToolValue>): Promise<Record<string, ToolValue>> => {
      const result: Record<string, ToolValue> = { status: toToolValue('executed'), tool: toToolValue(name) };
      for (const [k, v] of Object.entries(args)) result[`input_${k}`] = v;
      return result;
    };
    ToolCalling.registerTool(def, executor);
    refreshRegistry(); setToolName(''); setToolDesc(''); setToolParams([{ ...EMPTY_PARAM }]); setShowToolForm(false);
  };

  const unregisterTool = (name: string) => { ToolCalling.unregisterTool(name); refreshRegistry(); };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto custom-scrollbar relative h-full">
      <ModelBanner state={loader.state} progress={loader.progress} error={loader.error} onLoad={loader.ensure} label="LLM Tool Execution" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass-panel-strong p-4 rounded-2xl relative z-10 w-full shrink-0">
        <div className="flex items-center gap-2">
          <button
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${showRegistry ? 'btn-primary' : 'glass-panel'}`}
            style={!showRegistry ? { color: 'var(--text-secondary)' } : {}}
            onClick={() => { setShowRegistry(!showRegistry); setShowToolForm(false); }}
          >
            <span className="material-symbols-outlined align-middle mr-2 text-sm">build</span>
            Tools ({registeredTools.length})
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${showToolForm ? 'btn-primary' : 'glass-panel'}`}
            style={!showToolForm ? { color: 'var(--text-secondary)' } : {}}
            onClick={() => { setShowToolForm(!showToolForm); setShowRegistry(false); }}
          >
            <span className="material-symbols-outlined align-middle mr-2 text-sm">add</span>
            Add Tool
          </button>
        </div>
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
            <div className={`block w-10 h-6 border rounded-full transition-colors ${autoExecute ? 'border-[var(--accent)]' : ''}`}
              style={{ borderColor: autoExecute ? 'var(--accent)' : 'var(--glass-border)', background: autoExecute ? 'var(--accent-dim)' : 'var(--glass-bg)' }} />
            <div className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${autoExecute ? 'transform translate-x-4' : ''}`}
              style={{ background: autoExecute ? 'var(--accent)' : 'var(--text-muted)' }} />
          </div>
          <span className="text-xs font-bold uppercase tracking-widest transition-colors" style={{ color: 'var(--text-muted)' }}>Auto-execute</span>
        </label>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0 relative z-10">
        {/* Sidebar panels */}
        {(showRegistry || showToolForm) && (
          <div className="w-full md:w-80 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0">
            {showRegistry && (
              <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
                <h4 className="text-xs font-bold tracking-[0.2em] uppercase pb-4" style={{ color: 'var(--accent)', borderBottom: '1px solid var(--glass-border)' }}>Registered Tools</h4>
                {registeredTools.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tools registered</p>}
                {registeredTools.map((t) => (
                  <div key={t.name} className="glass-panel-strong rounded-xl p-4 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <strong className="text-sm font-bold block" style={{ color: 'var(--text-primary)' }}>{t.name}</strong>
                        {t.category && <span className="text-[10px] font-mono px-2 py-0.5 rounded mt-1 inline-block" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>{t.category}</span>}
                      </div>
                      <button className="icon-btn" onClick={() => unregisterTool(t.name)}><span className="material-symbols-outlined text-sm">close</span></button>
                    </div>
                    <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{t.description}</p>
                    {t.parameters.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.parameters.map((p) => (
                          <span key={p.name} className="text-[9px] font-mono px-2 py-1 rounded-sm glass-panel" style={{ color: 'var(--accent)' }}>
                            {p.name}: {p.type}{p.required ? ' *' : ''}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {showToolForm && (
              <div className="glass-panel rounded-2xl p-6 flex flex-col gap-4 relative">
                <h4 className="text-xs font-bold tracking-[0.2em] uppercase pb-4" style={{ color: 'var(--accent)', borderBottom: '1px solid var(--glass-border)' }}>Register Custom Tool</h4>
                <div className="space-y-4">
                  <input className="w-full glass-panel-strong border-none rounded-lg p-3 text-sm outline-none" style={{ color: 'var(--text-primary)' }} placeholder="Tool name (e.g. search_web)" value={toolName} onChange={(e) => setToolName(e.target.value)} />
                  <input className="w-full glass-panel-strong border-none rounded-lg p-3 text-sm outline-none" style={{ color: 'var(--text-primary)' }} placeholder="Description" value={toolDesc} onChange={(e) => setToolDesc(e.target.value)} />
                  <div className="glass-panel-strong p-4 rounded-xl space-y-3">
                    <span className="text-[10px] uppercase tracking-widest font-bold block" style={{ color: 'var(--text-muted)' }}>Parameters</span>
                    {toolParams.map((p, i) => (
                      <div key={i} className="flex flex-col gap-2 p-3 glass-panel rounded-lg relative">
                        <div className="flex gap-2">
                          <input className="flex-1 min-w-0 glass-panel-strong rounded py-1 px-2 text-xs outline-none" style={{ color: 'var(--text-primary)' }} placeholder="name" value={p.name} onChange={(e) => updateParam(i, 'name', e.target.value)} />
                          <select className="w-24 glass-panel-strong rounded py-1 px-2 text-xs outline-none" style={{ color: 'var(--text-primary)' }} value={p.type} onChange={(e) => updateParam(i, 'type', e.target.value)}>
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                          </select>
                        </div>
                        <input className="w-full glass-panel-strong rounded py-1 px-2 text-xs outline-none" style={{ color: 'var(--text-primary)' }} placeholder="description" value={p.description} onChange={(e) => updateParam(i, 'description', e.target.value)} />
                        <div className="flex items-center justify-between mt-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="accent-[var(--accent)]" checked={p.required} onChange={(e) => updateParam(i, 'required', e.target.checked)} />
                            <span className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>Required</span>
                          </label>
                          {toolParams.length > 1 && <button className="text-[10px] font-bold uppercase" style={{ color: 'var(--ax-error)' }} onClick={() => removeParam(i)}>Remove</button>}
                        </div>
                      </div>
                    ))}
                    <button className="w-full glass-panel py-2 rounded-lg text-xs font-bold transition-colors" style={{ color: 'var(--text-secondary)', borderStyle: 'dashed' }} onClick={addParam}>+ Add Parameter</button>
                  </div>
                  <div className="pt-2 flex gap-2">
                    <button className="flex-1 btn-primary font-bold text-xs uppercase tracking-widest py-3 rounded-xl" onClick={registerCustomTool} disabled={!toolName.trim() || !toolDesc.trim()}>Register</button>
                    <button className="px-4 glass-panel font-bold text-xs uppercase tracking-widest py-3 rounded-xl" style={{ color: 'var(--text-secondary)' }} onClick={() => setShowToolForm(false)}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main trace area */}
        <div className="flex-1 flex flex-col min-w-0 glass-panel-elevated rounded-2xl overflow-hidden relative">
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar" ref={traceRef}>
            {trace.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50 relative z-10">
                <span className="material-symbols-outlined text-6xl mb-6" style={{ fontVariationSettings: "'FILL' 1", color: 'var(--accent)' }}>deployed_code</span>
                <h3 className="text-2xl font-bold mb-2 tracking-tight" style={{ color: 'var(--text-primary)' }}>Tool Pipeline Explorer</h3>
                <p className="text-sm max-w-sm mb-10 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Initiate a process that requires multi-step external integration.<br />Watch the neural controller invoke and orchestrate systems dynamically.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
                  {[{ cat: 'Utility', q: 'What is the weather in San Francisco?', label: 'Weather in San Francisco' },
                    { cat: 'Math', q: 'What is 123 * 456 + 789?', label: '123 * 456 + 789' },
                    { cat: 'Utility', q: 'What time is it in Tokyo?', label: 'Time in Tokyo' },
                    { cat: 'Math', q: 'Give me a random number between 1 and 1000', label: 'Random int (1-1000)' }
                  ].map((item) => (
                    <button key={item.q} className="glass-panel px-4 py-3 rounded-xl text-left transition-all" onClick={() => setInput(item.q)}>
                      <div className="text-xs font-bold mb-1 uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{item.cat}</div>
                      <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {trace.map((step, i) => (
              <div key={i} className={`flex flex-col gap-2 ${step.type === 'user' ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-2" style={{ color: 'var(--text-muted)' }}>
                  {step.type === 'user' && <><span className="material-symbols-outlined text-sm" style={{ color: 'var(--text-primary)' }}>person</span> INPUT</>}
                  {step.type === 'tool_call' && <><span className="material-symbols-outlined text-sm" style={{ color: 'var(--accent)' }}>build</span> TOOL EXECUTING</>}
                  {step.type === 'tool_result' && <><span className="material-symbols-outlined text-sm" style={{ color: 'var(--success)' }}>output</span> SYNC RESULT</>}
                  {step.type === 'response' && <><span className="material-symbols-outlined text-sm" style={{ color: 'var(--accent)' }}>auto_awesome</span> ENGINE OUTPUT</>}
                </div>
                <div className={`max-w-[90%] p-5 rounded-2xl relative ${
                  step.type === 'user' ? 'glass-panel-strong rounded-br-sm text-sm' :
                  step.type === 'tool_call' ? 'glass-panel font-mono text-xs overflow-x-auto rounded-bl-sm' :
                  step.type === 'tool_result' ? 'font-mono text-[11px] overflow-x-auto rounded-bl-sm' :
                  'glass-panel-strong text-sm rounded-bl-sm'
                }`}
                style={
                  step.type === 'user' ? { color: 'var(--accent)' } :
                  step.type === 'tool_call' ? { color: 'var(--text-primary)', borderColor: 'var(--glass-border-hover)' } :
                  step.type === 'tool_result' ? { color: 'var(--success)', borderLeft: '2px solid var(--success)', background: 'var(--glass-bg)', padding: '20px' } :
                  { color: 'var(--text-primary)' }
                }>
                  <pre className="whitespace-pre-wrap font-inherit m-0 leading-relaxed">{step.content}</pre>
                </div>
              </div>
            ))}

            {generating && (
              <div className="flex flex-col gap-2 items-start">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-2" style={{ color: 'var(--text-muted)' }}>
                  <span className="material-symbols-outlined text-sm animate-spin" style={{ color: 'var(--accent)' }}>sync</span> PROCESSING
                </div>
                <div className="glass-panel-strong p-5 rounded-2xl rounded-bl-sm flex gap-2">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '75ms' }} />
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '150ms' }} />
                </div>
              </div>
            )}
          </div>

          <div className="p-4 shrink-0 relative z-20" style={{ borderTop: '1px solid var(--glass-border)', background: 'var(--glass-bg)' }}>
            <form className="flex items-center gap-4 glass-panel-strong rounded-full p-2 pr-4" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <span className="material-symbols-outlined ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>terminal</span>
              <input type="text" className="flex-1 bg-transparent border-none text-sm outline-none" style={{ color: 'var(--text-primary)' }}
                placeholder="Initiate a sequence that invokes registered tools..." value={input} onChange={(e) => setInput(e.target.value)} disabled={generating} />
              <button type="submit" className="btn-primary px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest" disabled={!input.trim() || generating}>
                {generating ? 'Running' : 'Execute'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
