import { ModelCategory } from '@runanywhere/web';
import {
  ToolCalling,
  ToolCallFormat,
  toToolValue,
  getStringArg,
  getNumberArg,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
  type ToolCallingResult,
  type ToolValue,
} from '@runanywhere/web-llamacpp';
import { useState, useRef, useEffect, useCallback } from 'react';

import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

// ---------------------------------------------------------------------------
// Built-in demo tools
// ---------------------------------------------------------------------------

const DEMO_TOOLS: { def: ToolDefinition; executor: Parameters<typeof ToolCalling.registerTool>[1] }[] = [
  {
    def: {
      name: 'get_weather',
      description: 'Gets the current weather for a city. Returns temperature in Fahrenheit and a short condition.',
      parameters: [
        { name: 'location', type: 'string', description: 'City name (e.g. "San Francisco")', required: true },
      ],
      category: 'Utility',
    },
    executor: async (args) => {
      const city = getStringArg(args, 'location') ?? 'Unknown';
      const conditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Rainy', 'Windy', 'Foggy'];
      const temp = Math.round(45 + Math.random() * 50);
      const condition = conditions[Math.floor(Math.random() * conditions.length)];
      return {
        location: toToolValue(city),
        temperature_f: toToolValue(temp),
        condition: toToolValue(condition),
        humidity_pct: toToolValue(Math.round(30 + Math.random() * 60)),
      };
    },
  },
  {
    def: {
      name: 'calculate',
      description: 'Evaluates a mathematical expression and returns the numeric result.',
      parameters: [
        { name: 'expression', type: 'string', description: 'Math expression (e.g. "2 + 3 * 4")', required: true },
      ],
      category: 'Math',
    },
    executor: async (args): Promise<Record<string, ToolValue>> => {
      const expr = getStringArg(args, 'expression') ?? '0';
      try {
        const sanitized = expr.replace(/[^0-9+\-*/().%\s^]/g, '');
        const val = Function(`"use strict"; return (${sanitized})`)();
        return { result: toToolValue(Number(val)), expression: toToolValue(expr) };
      } catch {
        return { error: toToolValue(`Invalid expression: ${expr}`) };
      }
    },
  },
  {
    def: {
      name: 'get_time',
      description: 'Returns the current date and time, optionally for a specific timezone.',
      parameters: [
        { name: 'timezone', type: 'string', description: 'IANA timezone (e.g. "America/New_York"). Defaults to UTC.', required: false },
      ],
      category: 'Utility',
    },
    executor: async (args): Promise<Record<string, ToolValue>> => {
      const tz = getStringArg(args, 'timezone') ?? 'UTC';
      try {
        const now = new Date();
        const formatted = now.toLocaleString('en-US', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' });
        return { datetime: toToolValue(formatted), timezone: toToolValue(tz) };
      } catch {
        return { datetime: toToolValue(new Date().toISOString()), timezone: toToolValue('UTC'), note: toToolValue('Fell back to UTC — invalid timezone') };
      }
    },
  },
  {
    def: {
      name: 'random_number',
      description: 'Generates a random integer between min and max (inclusive).',
      parameters: [
        { name: 'min', type: 'number', description: 'Minimum value', required: true },
        { name: 'max', type: 'number', description: 'Maximum value', required: true },
      ],
      category: 'Math',
    },
    executor: async (args) => {
      const min = getNumberArg(args, 'min') ?? 1;
      const max = getNumberArg(args, 'max') ?? 100;
      const value = Math.floor(Math.random() * (max - min + 1)) + min;
      return { value: toToolValue(value), min: toToolValue(min), max: toToolValue(max) };
    },
  },
];

// ---------------------------------------------------------------------------
// Types for the execution trace
// ---------------------------------------------------------------------------

interface TraceStep {
  type: 'user' | 'tool_call' | 'tool_result' | 'response';
  content: string;
  detail?: ToolCall | ToolResult;
}

// ---------------------------------------------------------------------------
// Custom tool form state
// ---------------------------------------------------------------------------

interface ParamDraft {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

const EMPTY_PARAM: ParamDraft = { name: '', type: 'string', description: '', required: true };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  // Custom tool form state
  const [toolName, setToolName] = useState('');
  const [toolDesc, setToolDesc] = useState('');
  const [toolParams, setToolParams] = useState<ParamDraft[]>([{ ...EMPTY_PARAM }]);

  // Register demo tools on mount
  useEffect(() => {
    ToolCalling.clearTools();
    for (const { def, executor } of DEMO_TOOLS) {
      ToolCalling.registerTool(def, executor);
    }
    setRegisteredTools(ToolCalling.getRegisteredTools());
    return () => { ToolCalling.clearTools(); };
  }, []);

  // Auto-scroll trace
  useEffect(() => {
    traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight, behavior: 'smooth' });
  }, [trace]);

  const refreshRegistry = useCallback(() => {
    setRegisteredTools(ToolCalling.getRegisteredTools());
  }, []);

  // -------------------------------------------------------------------------
  // Generate with tools
  // -------------------------------------------------------------------------

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setInput('');
    setGenerating(true);
    setTrace([{ type: 'user', content: text }]);

    try {
      const result: ToolCallingResult = await ToolCalling.generateWithTools(text, {
        autoExecute,
        maxToolCalls: 5,
        temperature: 0.3,
        maxTokens: 512,
        format: ToolCallFormat.Default,
      });

      // Build trace from result
      const steps: TraceStep[] = [{ type: 'user', content: text }];

      for (let i = 0; i < result.toolCalls.length; i++) {
        const call = result.toolCalls[i];
        const argSummary = Object.entries(call.arguments)
          .map(([k, v]) => `${k}=${JSON.stringify('value' in v ? v.value : v)}`)
          .join(', ');
        steps.push({
          type: 'tool_call',
          content: `${call.toolName}(${argSummary})`,
          detail: call,
        });

        if (result.toolResults[i]) {
          const res = result.toolResults[i];
          const resultStr = res.success && res.result
            ? JSON.stringify(Object.fromEntries(Object.entries(res.result).map(([k, v]) => [k, 'value' in v ? v.value : v])), null, 2)
            : res.error ?? 'Unknown error';
          steps.push({
            type: 'tool_result',
            content: res.success ? resultStr : `Error: ${resultStr}`,
            detail: res,
          });
        }
      }

      if (result.text) {
        steps.push({ type: 'response', content: result.text });
      }

      setTrace(steps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTrace((prev) => [...prev, { type: 'response', content: `Error: ${msg}` }]);
    } finally {
      setGenerating(false);
    }
  }, [input, generating, autoExecute, loader]);

  // -------------------------------------------------------------------------
  // Register custom tool
  // -------------------------------------------------------------------------

  const addParam = () => setToolParams((p) => [...p, { ...EMPTY_PARAM }]);

  const updateParam = (idx: number, field: keyof ParamDraft, value: string | boolean) => {
    setToolParams((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const removeParam = (idx: number) => {
    setToolParams((prev) => prev.filter((_, i) => i !== idx));
  };

  const registerCustomTool = () => {
    const name = toolName.trim().replace(/\s+/g, '_').toLowerCase();
    const desc = toolDesc.trim();
    if (!name || !desc) return;

    const params = toolParams
      .filter((p) => p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        type: p.type as 'string' | 'number' | 'boolean',
        description: p.description.trim() || p.name.trim(),
        required: p.required,
      }));

    const def: ToolDefinition = { name, description: desc, parameters: params, category: 'Custom' };

    // Mock executor that returns the args back as acknowledgement
    const executor = async (args: Record<string, ToolValue>): Promise<Record<string, ToolValue>> => {
      const result: Record<string, ToolValue> = {
        status: toToolValue('executed'),
        tool: toToolValue(name),
      };
      for (const [k, v] of Object.entries(args)) {
        result[`input_${k}`] = v;
      }
      return result;
    };

    ToolCalling.registerTool(def, executor);
    refreshRegistry();
    setToolName('');
    setToolDesc('');
    setToolParams([{ ...EMPTY_PARAM }]);
    setShowToolForm(false);
  };

  const unregisterTool = (name: string) => {
    ToolCalling.unregisterTool(name);
    refreshRegistry();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 bg-surface space-y-6 overflow-y-auto custom-scrollbar relative h-full">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM Tool Execution"
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10 shadow-sm relative z-10 w-full shrink-0">
        <div className="flex items-center gap-2">
          <button
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${showRegistry ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-highest text-on-surface hover:text-primary hover:bg-surface-variant'}`}
            onClick={() => { setShowRegistry(!showRegistry); setShowToolForm(false); }}
          >
            <span className="material-symbols-outlined align-middle mr-2 text-sm">build</span>
            Tools ({registeredTools.length})
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${showToolForm ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-highest text-on-surface hover:text-primary hover:bg-surface-variant'}`}
            onClick={() => { setShowToolForm(!showToolForm); setShowRegistry(false); }}
          >
            <span className="material-symbols-outlined align-middle mr-2 text-sm">add</span>
            Add Tool
          </button>
        </div>
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className="relative">
            <input type="checkbox" className="sr-only" checked={autoExecute} onChange={(e) => setAutoExecute(e.target.checked)} />
            <div className={`block w-10 h-6 border rounded-full transition-colors ${autoExecute ? 'border-primary bg-primary/20' : 'border-outline-variant bg-surface-container-highest'}`}></div>
            <div className={`dot absolute left-1 top-1 bg-primary w-4 h-4 rounded-full transition-transform ${autoExecute ? 'transform translate-x-4 bg-primary' : 'bg-outline-variant'}`}></div>
          </div>
          <span className="text-xs font-bold text-outline uppercase tracking-widest group-hover:text-primary transition-colors">Auto-execute</span>
        </label>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0 relative z-10">
        {/* Sidebar panels */}
        {(showRegistry || showToolForm) && (
          <div className="w-full md:w-80 flex flex-col gap-4 overflow-y-auto custom-scrollbar shrink-0">
            {showRegistry && (
              <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-6 flex flex-col gap-4">
                <h4 className="text-xs font-bold text-primary tracking-[0.2em] uppercase border-b border-outline-variant/10 pb-4">Registered Tools</h4>
                {registeredTools.length === 0 && <p className="text-sm text-outline-variant">No tools registered</p>}
                {registeredTools.map((t) => (
                  <div key={t.name} className="bg-surface-container-highest rounded-xl p-4 border border-outline-variant/10 hover:border-primary/30 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                       <div>
                         <strong className="text-sm font-bold text-on-surface block">{t.name}</strong>
                         {t.category && <span className="text-[10px] font-mono text-secondary px-2 py-0.5 bg-secondary/10 rounded mt-1 inline-block">{t.category}</span>}
                       </div>
                       <button className="text-outline-variant hover:text-error transition-colors" onClick={() => unregisterTool(t.name)}>
                         <span className="material-symbols-outlined text-sm">close</span>
                       </button>
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2">{t.description}</p>
                    {t.parameters.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {t.parameters.map((p) => (
                          <span key={p.name} className="text-[9px] font-mono bg-[#161c25] text-primary/80 px-2 py-1 rounded-sm border border-outline-variant/20">
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
              <div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-6 flex flex-col gap-4 relative">
                <h4 className="text-xs font-bold text-primary tracking-[0.2em] uppercase border-b border-outline-variant/10 pb-4">Register Custom Tool</h4>
                <div className="space-y-4">
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg p-3 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 outline-none placeholder:text-outline-variant/50"
                    placeholder="Tool name (e.g. search_web)"
                    value={toolName}
                    onChange={(e) => setToolName(e.target.value)}
                  />
                  <input
                    className="w-full bg-surface-container-high border-none rounded-lg p-3 text-sm text-on-surface focus:ring-1 focus:ring-primary/40 outline-none placeholder:text-outline-variant/50"
                    placeholder="Description"
                    value={toolDesc}
                    onChange={(e) => setToolDesc(e.target.value)}
                  />
                  
                  <div className="bg-surface-container-highest p-4 rounded-xl border border-outline-variant/5 space-y-3">
                    <span className="text-[10px] uppercase tracking-widest text-outline-variant font-bold block">Parameters</span>
                    {toolParams.map((p, i) => (
                      <div key={i} className="flex flex-col gap-2 p-3 bg-[#161c25] rounded-lg border border-outline-variant/10 relative">
                        <div className="flex gap-2">
                          <input
                            className="flex-1 min-w-0 bg-surface-container-high border border-outline-variant/20 rounded py-1 px-2 text-xs text-on-surface focus:border-primary/40 outline-none"
                            placeholder="name"
                            value={p.name}
                            onChange={(e) => updateParam(i, 'name', e.target.value)}
                          />
                          <select
                            className="w-24 bg-surface-container-high border border-outline-variant/20 rounded py-1 px-2 text-xs text-on-surface outline-none"
                            value={p.type}
                            onChange={(e) => updateParam(i, 'type', e.target.value)}
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                          </select>
                        </div>
                        <input
                          className="w-full bg-surface-container-high border border-outline-variant/20 rounded py-1 px-2 text-xs text-on-surface focus:border-primary/40 outline-none"
                          placeholder="description"
                          value={p.description}
                          onChange={(e) => updateParam(i, 'description', e.target.value)}
                        />
                        <div className="flex items-center justify-between mt-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="accent-primary" checked={p.required} onChange={(e) => updateParam(i, 'required', e.target.checked)} />
                            <span className="text-[10px] text-outline font-bold">Required</span>
                          </label>
                          {toolParams.length > 1 && (
                            <button className="text-error hover:text-error/80 text-[10px] font-bold uppercase" onClick={() => removeParam(i)}>Remove</button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button className="w-full border border-dashed border-outline-variant/40 hover:border-primary/40 text-on-surface-variant hover:text-primary py-2 rounded-lg text-xs font-bold transition-colors" onClick={addParam}>
                      + Add Parameter
                    </button>
                  </div>

                  <div className="pt-2 flex gap-2">
                    <button 
                      className="flex-1 bg-primary text-on-primary font-bold text-xs uppercase tracking-widest py-3 rounded-xl disabled:opacity-50" 
                      onClick={registerCustomTool} 
                      disabled={!toolName.trim() || !toolDesc.trim()}
                    >
                      Register
                    </button>
                    <button 
                      className="px-4 bg-surface-variant text-on-surface-variant font-bold text-xs uppercase tracking-widest py-3 rounded-xl" 
                      onClick={() => setShowToolForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main trace area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#161c25] rounded-2xl border border-outline-variant/10 overflow-hidden shadow-inner relative">
          
          <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar" ref={traceRef}>
            {trace.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center opacity-50 relative z-10">
                <span className="material-symbols-outlined text-6xl mb-6 text-primary" style={{fontVariationSettings: "'FILL' 1"}}>deployed_code</span>
                <h3 className="text-2xl font-bold text-on-surface mb-2 tracking-tight">Tool Pipeline Explorer</h3>
                <p className="text-sm text-outline-variant max-w-sm mb-10 leading-relaxed">
                  Initiate a process that requires multi-step external integration.<br/> Watch the neural controller invoke and orchestrate systems dynamically.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
                  <button className="bg-surface-variant hover:bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 px-4 py-3 rounded-xl text-left transition-all" onClick={() => setInput('What is the weather in San Francisco?')}>
                    <div className="text-xs font-bold text-primary mb-1 uppercase tracking-widest">Utility</div>
                    <div className="text-sm text-on-surface">Weather in San Francisco</div>
                  </button>
                  <button className="bg-surface-variant hover:bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 px-4 py-3 rounded-xl text-left transition-all" onClick={() => setInput('What is 123 * 456 + 789?')}>
                    <div className="text-xs font-bold text-secondary mb-1 uppercase tracking-widest">Math</div>
                    <div className="text-sm text-on-surface">123 * 456 + 789</div>
                  </button>
                  <button className="bg-surface-variant hover:bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 px-4 py-3 rounded-xl text-left transition-all" onClick={() => setInput('What time is it in Tokyo?')}>
                    <div className="text-xs font-bold text-primary mb-1 uppercase tracking-widest">Utility</div>
                    <div className="text-sm text-on-surface">Time in Tokyo</div>
                  </button>
                  <button className="bg-surface-variant hover:bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 px-4 py-3 rounded-xl text-left transition-all" onClick={() => setInput('Give me a random number between 1 and 1000')}>
                    <div className="text-xs font-bold text-secondary mb-1 uppercase tracking-widest">Math</div>
                    <div className="text-sm text-on-surface">Random int (1-1000)</div>
                  </button>
                </div>
              </div>
            )}
            
            {trace.map((step, i) => (
              <div key={i} className={`flex flex-col gap-2 ${step.type === 'user' ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-outline-variant px-2">
                  {step.type === 'user' && <><span className="material-symbols-outlined text-sm text-on-surface">person</span> INPUT</>}
                  {step.type === 'tool_call' && <><span className="material-symbols-outlined text-sm text-primary">build</span> TOOL EXECUTING</>}
                  {step.type === 'tool_result' && <><span className="material-symbols-outlined text-sm text-secondary">output</span> SYNC RESULT</>}
                  {step.type === 'response' && <><span className="material-symbols-outlined text-sm text-primary">auto_awesome</span> ENGINE OUTPUT</>}
                </div>
                
                <div className={`max-w-[90%] p-5 rounded-2xl relative ${
                  step.type === 'user' ? 'bg-gradient-to-br from-primary to-primary-container text-on-primary rounded-br-sm shadow-md text-sm' :
                  step.type === 'tool_call' ? 'bg-[#242a33] border border-primary/20 text-on-surface font-mono text-xs overflow-x-auto shadow-inner rounded-bl-sm' :
                  step.type === 'tool_result' ? 'bg-[#1b2128] border-l-2 border-secondary/50 text-secondary font-mono text-[11px] overflow-x-auto rounded-bl-sm' :
                  'bg-surface-container-high border border-outline-variant/10 text-on-surface text-sm rounded-bl-sm shadow-lg shadow-black/20'
                }`}>
                  <pre className="whitespace-pre-wrap font-inherit m-0 leading-relaxed">{step.content}</pre>
                </div>
              </div>
            ))}
            
            {generating && (
              <div className="flex flex-col gap-2 items-start">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-outline-variant px-2">
                  <span className="material-symbols-outlined text-sm text-primary animate-spin">sync</span> PROCESSING
                </div>
                <div className="bg-surface-container-high border border-outline-variant/10 p-5 rounded-2xl rounded-bl-sm flex gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse delay-75"></span>
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse delay-150"></span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-outline-variant/10 bg-surface-container-low shrink-0 relative z-20">
            <form className="flex items-center gap-4 bg-[#161c25] rounded-full p-2 pr-4 ring-1 ring-outline-variant/20 focus-within:ring-primary/50 transition-shadow shadow-inner" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <span className="material-symbols-outlined ml-3 text-outline-variant text-sm">terminal</span>
              <input
                type="text"
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-on-surface placeholder:text-outline-variant/50 outline-none"
                placeholder="Initiate a sequence that invokes registered tools..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={generating}
              />
              <button 
                type="submit" 
                className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                  input.trim() && !generating
                    ? 'bg-primary text-on-primary shadow-lg hover:shadow-primary/20 hover:bg-primary-container' 
                    : 'bg-surface-container-highest text-outline-variant cursor-not-allowed hidden md:block'
                }`}
                disabled={!input.trim() || generating}
              >
                {generating ? 'Running' : 'Execute'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
