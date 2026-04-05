/**
 * UnifiedChat.tsx — Single unified chat interface with tool toggles
 * 
 * Replaces all separate tab views (Research, Chat, Voice, Vision).
 * Features:
 * - Claude-style bottom input bar with tool toggles
 * - Tool-aware system prompts for contextual LLM responses
 * - Research pipeline integration
 * - Notepad panel
 * - File upload & camera capture
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory, ModelManager } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useDualModelLoader } from '../hooks/useDualModelLoader';
import { ModelBanner } from './ModelBanner';
import { NotePanel } from './NotePanel';
import { runResearchAgent, type PipelineStageId, type PipelineStatus, type FinalResult } from '../agent/agent';
import type { RetrievedSource } from '../agent/retrieval';
import { ModeSelector } from './ModeSelector';
import { getModelForMode, type PotencyMode } from '../agent/modelRouter';

// ── Tool definitions ──
type ToolId = 'note' | 'research' | 'code';

interface ToolDef {
  id: ToolId;
  name: string;
  shortName: string;
  icon: 'edit_note' | 'travel_explore' | 'code';
  isSvgIcon?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: 'note', name: 'Note', shortName: 'Note', icon: 'edit_note' },
  { id: 'research', name: 'Run deep research', shortName: 'Research', icon: 'travel_explore' },
  { id: 'code', name: 'Code', shortName: 'Code', icon: 'code', isSvgIcon: true },
];

// ── System prompts for tool-aware LLM context ──
const SYSTEM_PROMPTS: Record<ToolId | 'default', string> = {
  default: 'You are a helpful AI assistant. Provide concise, accurate answers. Be direct and informative.',
  research: 'You are a deep research agent. Perform thorough research with citations. Provide comprehensive, well-structured analysis with multiple perspectives.',
  code: 'You are an expert code assistant. Provide clean, well-documented code with explanations. Use best practices, include comments, and explain your approach step by step.',
  note: 'You are a writing assistant. Help draft, edit, and organize content. Be clear, creative, and focused on producing high-quality written material.',
};

// ── Pipeline stages (for research mode) ──
const STAGES = [
  { id: 'intent' as PipelineStageId, label: 'Classify', icon: '🎯' },
  { id: 'planning' as PipelineStageId, label: 'Plan', icon: '📋' },
  { id: 'retrieval' as PipelineStageId, label: 'Retrieve', icon: '🌐' },
  { id: 'analysis' as PipelineStageId, label: 'Analyze', icon: '🧠' },
  { id: 'synthesis' as PipelineStageId, label: 'Generate', icon: '✍️' },
  { id: 'followup' as PipelineStageId, label: 'Follow-up', icon: '💡' },
];

// ── Message interface ──
interface Message {
  role: 'user' | 'assistant';
  text: string;
  tool?: ToolId;
  stats?: { tokens: number; tokPerSec: number; latencyMs: number };
  attachments?: { type: 'image'; url: string; name: string }[];
}

// ── Simple Markdown renderer ──
function MarkdownContent({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !text) return;
    const html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>')
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
      .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^\s*[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/((<li>[\s\S]*?<\/li>))+/g, (s) => `<ul>${s}</ul>`)
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[htpuolcd])(.*\S.*)$/gm, '$1');
    ref.current.innerHTML = `<p>${html}</p>`;
  }, [text]);
  return <div ref={ref} className="agent-report-body" />;
}

// ── CodeIcon SVG component ──
function CodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 32 32" fill="currentColor">
      <path d="M22.6,21.2c1.5-2,2.4-4.5,2.4-7.2,0-6.6-5.4-12-12-12-3.3,0-6.4,1.3-8.7,3.8l1.5,1.4c1.8-2.1,4.4-3.2,7.2-3.2,5.5,0,10,4.5,10,10s-4.5,10-10,10c-3,0-5.8-1.3-7.7-3.6l-1.5,1.3c2.2,2.7,5.6,4.3,9.2,4.3,3.2,0,6.1-1.3,8.3-3.3l7.3,7.3,1.4-1.4s-7.4-7.4-7.4-7.4ZM16,18l4-4-4-4-1.42,1.41,2.59,2.59-2.58,2.58,1.41,1.42ZM6,10l-4,4,4,4,1.42-1.41-2.59-2.59,2.58-2.58-1.41-1.42ZM11.3044,9l-2.5405,9.4824,1.9316.5176,2.5405-9.4824s-1.9316-.5176-1.9316-.5176Z"/>
    </svg>
  );
}

// ── Props ──
interface UnifiedChatProps {
  onBrainLog?: (msg: string) => void;
  onAgentStatus?: (agent: string, status: 'idle' | 'running' | 'done' | 'error') => void;
  currentMode: PotencyMode;
  onModeChange: (mode: PotencyMode) => void;
}

export function UnifiedChat({ onBrainLog, onAgentStatus, currentMode, onModeChange }: UnifiedChatProps) {
  const loader = useDualModelLoader();

  // Messages & input
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assistantIdxRef = useRef<number>(-1);

  // Tool state
  const [selectedTool, setSelectedTool] = useState<ToolId | null>(null);
  const [showToolsPopup, setShowToolsPopup] = useState(false);
  const [showPlusPopup, setShowPlusPopup] = useState(false);
  const [notePanelOpen, setNotePanelOpen] = useState(false);

  // File attachment
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);

  // Research state
  const [researchRunning, setResearchRunning] = useState(false);
  const [stageStatuses, setStageStatuses] = useState<Record<PipelineStageId, PipelineStatus>>({
    intent: 'idle', planning: 'idle', retrieval: 'idle',
    analysis: 'idle', synthesis: 'idle', followup: 'idle',
  });
  const [researchStreamText, setResearchStreamText] = useState('');
  const [researchResult, setResearchResult] = useState<FinalResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Refs for popups (click-outside handling)
  const toolsPopupRef = useRef<HTMLDivElement>(null);
  const plusPopupRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, researchStreamText]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Auto-switch model when mode changes
  useEffect(() => {
    // Only switch if models are ready
    if (loader.state === 'ready' && !generating) {
      console.log(`[UnifiedChat] Mode changed to ${currentMode}, ensuring correct model is loaded`);
      loader.ensureForMode(currentMode);
    }
  }, [currentMode, loader, generating]);

  // Close popups on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (toolsPopupRef.current && !toolsPopupRef.current.contains(e.target as Node)) {
        setShowToolsPopup(false);
      }
      if (plusPopupRef.current && !plusPopupRef.current.contains(e.target as Node)) {
        setShowPlusPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Placeholder text based on selected tool
  const placeholderText = selectedTool === 'research'
    ? "Let's do research..."
    : selectedTool === 'code'
    ? 'Write your code...'
    : selectedTool === 'note'
    ? 'Ask AI to help with your note...'
    : 'Message';

  // ── Handle tool selection ──
  const handleToolSelect = (toolId: ToolId) => {
    if (toolId === 'note') {
      setNotePanelOpen(true);
      setSelectedTool('note');
    } else {
      setSelectedTool(toolId);
    }
    setShowToolsPopup(false);
  };

  // ── File handling ──
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeImage = () => {
    setImagePreview(null);
    setImageFile(null);
  };

  // ── Send message ──
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    try {
      // Ensure model is loaded - if not ready, download both models
      if (loader.state !== 'ready') {
        console.log('[UnifiedChat] Model not ready, attempting to load...');
        const ok = await loader.ensureBoth(); // Download both models on first use
        if (!ok) {
          // Show user-friendly error
          setMessages(prev => [
            ...prev,
            { role: 'user', text },
            { role: 'assistant', text: '❌ **Model failed to load**\n\nPlease try:\n1. Refreshing the page\n2. Checking your internet connection\n3. Opening the Model Manager to download the model manually\n\nIf the issue persists, try clearing your browser cache.' },
          ]);
          return;
        }
      } else {
        // Make sure we have the right model for the current mode
        await loader.ensureForMode(currentMode);
      }

      const activeTool = selectedTool;
      const attachments: Message['attachments'] = [];
      if (imagePreview && imageFile) {
        attachments.push({ type: 'image', url: imagePreview, name: imageFile.name });
      }

      // If research tool is selected, run research pipeline instead of regular chat
      if (activeTool === 'research') {
        await runResearch(text, attachments);
        return;
      }

      // Regular chat flow
      setInput('');
      setImagePreview(null);
      setImageFile(null);
      setGenerating(true);

      setMessages(prev => {
        assistantIdxRef.current = prev.length + 1;
        return [
          ...prev,
          { role: 'user', text, tool: activeTool ?? undefined, attachments: attachments.length > 0 ? attachments : undefined },
          { role: 'assistant', text: '', tool: activeTool ?? undefined },
        ];
      });

      try {
        const systemPrompt = SYSTEM_PROMPTS[activeTool || 'default'];
        const modeConfig = getModelForMode(currentMode);
        const fullPrompt = systemPrompt + '\n\nUser: ' + text;

        const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(
          fullPrompt,
          { maxTokens: modeConfig.maxTokens, temperature: modeConfig.temperature }
        );
        cancelRef.current = cancel;

        let accumulated = '';
        for await (const token of stream) {
          // Check if generation was cancelled
          if (cancelRef.current === null) {
            console.log('[UnifiedChat] Generation cancelled by user');
            break;
          }

          accumulated += token;
          setMessages(prev => {
            const updated = [...prev];
            if (updated[assistantIdxRef.current]) {
              updated[assistantIdxRef.current] = { 
                ...updated[assistantIdxRef.current], 
                text: accumulated 
              };
            }
            return updated;
          });
        }

        const result = await resultPromise;
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIdxRef.current]) {
            updated[assistantIdxRef.current] = {
              ...updated[assistantIdxRef.current],
              text: result.text || accumulated,
              stats: { tokens: result.tokensUsed, tokPerSec: result.tokensPerSecond, latencyMs: result.latencyMs },
            };
          }
          return updated;
        });
      } catch (streamErr) {
        // Specific error handling for streaming failures
        const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        console.error('[UnifiedChat] Stream error:', streamErr);
        
        let errorMessage = '⚠️ **Generation error**\n\n';
        
        if (msg.includes('timeout') || msg.includes('timed out')) {
          errorMessage += 'The model took too long to respond. Try:\n- Switching to **Fast mode** for quicker responses\n- Shortening your prompt\n- Refreshing the page';
        } else if (msg.includes('aborted') || msg.includes('cancelled')) {
          errorMessage += 'Generation was cancelled.';
        } else if (msg.includes('memory') || msg.includes('allocation')) {
          errorMessage += 'Out of memory. Try:\n- Closing other browser tabs\n- Refreshing the page\n- Using **Fast mode** (requires less memory)';
        } else {
          errorMessage += `${msg}\n\nTry refreshing the page or switching to **Fast mode**.`;
        }
        
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIdxRef.current]) {
            updated[assistantIdxRef.current] = { 
              ...updated[assistantIdxRef.current], 
              text: errorMessage 
            };
          }
          return updated;
        });
      } finally {
        cancelRef.current = null;
        setGenerating(false);
      }
    } catch (outerErr) {
      // Top-level error handling for catastrophic failures
      const msg = outerErr instanceof Error ? outerErr.message : String(outerErr);
      console.error('[UnifiedChat] Fatal error in send():', outerErr);
      
      setMessages(prev => [
        ...prev,
        { role: 'assistant', text: `❌ **Fatal error**\n\n${msg}\n\nPlease refresh the page. If the issue persists, try:\n1. Clearing browser cache\n2. Checking browser console for errors\n3. Using Chrome/Edge 120+` },
      ]);
      
      setGenerating(false);
      cancelRef.current = null;
    }
  }, [input, generating, loader, selectedTool, imagePreview, imageFile, currentMode]);

  // ── Research pipeline ──
  const runResearch = useCallback(async (query: string, attachments?: Message['attachments']) => {
    setInput('');
    setImagePreview(null);
    setImageFile(null);
    setGenerating(true);
    setResearchRunning(true);
    setResearchStreamText('');
    setResearchResult(null);
    setStageStatuses({ intent: 'idle', planning: 'idle', retrieval: 'idle', analysis: 'idle', synthesis: 'idle', followup: 'idle' });

    // Add user message
    setMessages(prev => [
      ...prev,
      { role: 'user', text: query, tool: 'research', attachments },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const stageToAgent: Record<PipelineStageId, string> = {
      intent: 'classifier', planning: 'planner', retrieval: 'retriever',
      analysis: 'analyst', synthesis: 'writer', followup: 'writer',
    };

    onBrainLog?.(`[QUERY] ${query.slice(0, 80)}`);

    await runResearchAgent(query, {
      onStageUpdate: ({ stage, status, detail, warning }) => {
        setStageStatuses(prev => ({ ...prev, [stage]: status }));
        if (warning) console.warn(`[${stage}] ${warning}`);
        const agent = stageToAgent[stage];
        if (status === 'running') {
          onAgentStatus?.(agent, 'running');
          onBrainLog?.(`[${agent.toUpperCase()}] ${detail || 'working…'}`);
        } else if (status === 'done') {
          onAgentStatus?.(agent, 'done');
          onBrainLog?.(`[${agent.toUpperCase()}] ✓ ${detail || 'complete'}`);
        } else if (status === 'error') {
          onAgentStatus?.(agent, 'error');
          if (warning) onBrainLog?.(`[${agent.toUpperCase()}] ⚠ ${warning}`);
        }
      },
      onToken: (token) => setResearchStreamText(t => t + token),
      onComplete: (r) => {
        setResearchResult(r);
        setResearchStreamText('');
        setResearchRunning(false);
        setGenerating(false);
        abortRef.current = null;
        // Add research result as assistant message
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: r.report, tool: 'research' },
        ]);
        onBrainLog?.(`[DONE] Report generated in ${(r.elapsedMs / 1000).toFixed(1)}s — ${r.sources.length} sources`);
        for (const a of Object.values(stageToAgent)) onAgentStatus?.(a, 'idle');
      },
      onError: (msg) => {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', text: `Research error: ${msg}`, tool: 'research' },
        ]);
        setResearchRunning(false);
        setGenerating(false);
        abortRef.current = null;
        onBrainLog?.(`[ERROR] ${msg}`);
        for (const a of Object.values(stageToAgent)) onAgentStatus?.(a, 'error');
      },
    }, { signal: controller.signal });
  }, [loader, onBrainLog, onAgentStatus]);

  const handleCancel = () => {
    if (researchRunning) {
      abortRef.current?.abort();
      abortRef.current = null;
      setResearchRunning(false);
    }
    cancelRef.current?.();
    setGenerating(false);
  };

  const hasValue = input.trim().length > 0 || imagePreview;

  return (
    <div className="unified-chat-container">
      <ModelBanner 
        state={loader.state} 
        progress={loader.progress} 
        error={loader.error} 
        onLoad={loader.ensureBoth} 
        label="AI Engine"
        showDualDownload={true}
      />

      <div className="unified-chat-layout">
        {/* Main chat area */}
        <div className="unified-chat-main">
          {/* Messages */}
          <div className="unified-chat-messages custom-scrollbar" ref={listRef}>
            {messages.length === 0 && !researchRunning && (
              <div className="unified-chat-empty">
                <div className="unified-chat-empty-logo">
                  <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>PA</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight mt-6" style={{ color: 'var(--text-primary)' }}>
                  How can I help you?
                </h2>
                <p className="text-sm mt-2 max-w-md" style={{ color: 'var(--text-muted)' }}>
                  Ask me anything, run deep research, write code, or take notes. All processing happens locally on your device.
                </p>
                <div className="unified-chat-suggestions">
                  {[
                    'How does the transformer attention mechanism work?',
                    'Compare PostgreSQL vs MongoDB for analytics',
                    'Write a React hook for infinite scrolling',
                    'Explain LoRA vs full fine-tuning for LLMs',
                  ].map((q) => (
                    <button key={q} className="suggestion-chip" onClick={() => setInput(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                {msg.role === 'user' && (
                  <div className="chat-message-user">
                    {msg.attachments?.map((att, j) => (
                      <img key={j} src={att.url} alt={att.name} className="chat-attachment-img" />
                    ))}
                    <p>{msg.text}</p>
                    {msg.tool && (
                      <span className="chat-tool-badge">
                        {TOOLS.find(t => t.id === msg.tool)?.shortName || msg.tool}
                      </span>
                    )}
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div className="chat-message-assistant">
                    {msg.text ? (
                      <MarkdownContent text={msg.text} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '75ms' }} />
                        <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '150ms' }} />
                      </div>
                    )}
                    {msg.stats && (
                      <div className="chat-message-stats">
                        <span>{msg.stats.tokens} tokens</span>
                        <span>{msg.stats.tokPerSec.toFixed(1)} tok/s</span>
                        <span>{msg.stats.latencyMs.toFixed(0)}ms</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Research pipeline visualization */}
            {researchRunning && (
              <div className="research-pipeline-inline">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
                  <span className="text-xs font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--accent)' }}>Research in progress</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {STAGES.map(stage => {
                    const status = stageStatuses[stage.id];
                    return (
                      <div key={stage.id} className={`research-stage-chip ${status}`}>
                        {status === 'running' ? (
                          <span className="w-3 h-3 border border-current rounded-full animate-spin" style={{ borderTopColor: 'transparent' }} />
                        ) : status === 'done' ? (
                          <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1", color: '#34d399' }}>check_circle</span>
                        ) : (
                          <span className="text-xs">{stage.icon}</span>
                        )}
                        <span className="text-[10px] font-semibold">{stage.label}</span>
                      </div>
                    );
                  })}
                </div>
                {researchStreamText && (
                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--glass-border)' }}>
                    <MarkdownContent text={researchStreamText} />
                  </div>
                )}
              </div>
            )}

            {/* Research result sources */}
            {researchResult && researchResult.sources.length > 0 && (
              <div className="research-sources">
                <h4 className="text-xs font-bold tracking-[0.15em] uppercase mb-3 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <span className="material-symbols-outlined text-sm">local_library</span>
                  Sources ({researchResult.sources.length})
                </h4>
                <div className="flex flex-wrap gap-2">
                  {researchResult.sources.map((s: RetrievedSource, i: number) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" className="source-chip">
                      <span className="text-[10px] font-bold" style={{ color: 'var(--accent)' }}>[{i + 1}]</span>
                      <span className="text-xs truncate max-w-[200px]">{s.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="unified-input-wrapper">
            <div className="unified-input-box">
              {/* Image preview */}
              {imagePreview && (
                <div className="unified-input-preview">
                  <img src={imagePreview} alt="Preview" className="unified-input-preview-img" />
                  <button onClick={removeImage} className="unified-input-preview-remove">
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={placeholderText}
                className="unified-input-textarea custom-scrollbar"
                disabled={generating}
              />

              {/* Bottom toolbar */}
              <div className="unified-input-toolbar">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,application/pdf,.txt,.md,.csv,.json" />

                {/* Plus button */}
                <div className="relative" ref={plusPopupRef}>
                  <button
                    className="unified-tool-btn"
                    onClick={() => { setShowPlusPopup(p => !p); setShowToolsPopup(false); }}
                    title="Attach"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5V19" /><path d="M5 12H19" />
                    </svg>
                  </button>
                  {showPlusPopup && (
                    <div className="unified-popup">
                      <button className="unified-popup-item" onClick={() => { setShowPlusPopup(false); /* TODO: camera */ }}>
                        <span className="material-symbols-outlined text-base">photo_camera</span>
                        <span>Camera</span>
                      </button>
                      <button className="unified-popup-item" onClick={() => { setShowPlusPopup(false); fileInputRef.current?.click(); }}>
                        <span className="material-symbols-outlined text-base">upload_file</span>
                        <span>Upload</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Tools button */}
                <div className="relative" ref={toolsPopupRef}>
                  <button
                    className="unified-tool-btn"
                    onClick={() => { setShowToolsPopup(p => !p); setShowPlusPopup(false); }}
                    title="Tools"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" />
                    </svg>
                    {!selectedTool && <span className="text-xs font-medium">Tools</span>}
                  </button>
                  {showToolsPopup && (
                    <div className="unified-popup">
                      {TOOLS.map(tool => (
                        <button
                          key={tool.id}
                          className={`unified-popup-item ${selectedTool === tool.id ? 'active' : ''}`}
                          onClick={() => handleToolSelect(tool.id)}
                        >
                          {tool.isSvgIcon ? (
                            <CodeIcon className="w-4 h-4" />
                          ) : (
                            <span className="material-symbols-outlined text-base">{tool.icon}</span>
                          )}
                          <span>{tool.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active tool badge */}
                {selectedTool && (
                  <>
                    <div className="h-4 w-px" style={{ background: 'var(--glass-border)' }} />
                    <button
                      className="active-tool-badge"
                      onClick={() => {
                        if (selectedTool === 'note') setNotePanelOpen(false);
                        setSelectedTool(null);
                      }}
                    >
                      {TOOLS.find(t => t.id === selectedTool)?.isSvgIcon ? (
                        <CodeIcon className="w-4 h-4" />
                      ) : (
                        <span className="material-symbols-outlined text-sm">
                          {TOOLS.find(t => t.id === selectedTool)?.icon}
                        </span>
                      )}
                      <span className="text-xs font-medium">{TOOLS.find(t => t.id === selectedTool)?.shortName}</span>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </>
                )}

                {/* Right side — mic + send */}
                <div className="ml-auto flex items-center gap-1">
                  {generating ? (
                    <button className="unified-stop-btn" onClick={handleCancel} title="Stop">
                      <span className="material-symbols-outlined text-base">stop</span>
                    </button>
                  ) : (
                    <>
                      <ModeSelector
                        currentMode={currentMode}
                        onModeChange={onModeChange}
                        disabled={generating || researchRunning}
                      />
                      <button className="unified-tool-btn ml-1" title="Voice input">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                        </svg>
                      </button>
                      <button
                        className="unified-send-btn"
                        onClick={send}
                        disabled={!hasValue}
                        title="Send"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5.25L12 18.75" />
                          <path d="M18.75 12L12 5.25L5.25 12" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Note panel (slide-out) */}
        <NotePanel open={notePanelOpen} onClose={() => { setNotePanelOpen(false); if (selectedTool === 'note') setSelectedTool(null); }} />
      </div>
    </div>
  );
}
