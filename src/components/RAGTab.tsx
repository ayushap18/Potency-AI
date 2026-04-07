/**
 * RAGTab.tsx — RAG (Retrieval-Augmented Generation) interface.
 * Upload documents, ask questions grounded in your data, powered by Gemma 4 via Ollama.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { RAGPipeline, type IngestProgress } from '../rag/ragPipeline';
import { checkOllamaStatus } from '../services/ollama';
import { pushHistory } from '../App';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  sources?: Array<{ source: string; score: number; preview: string }>;
}

interface UploadedDoc {
  name: string;
  chunks: number;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

// Singleton pipeline instance
let pipeline: RAGPipeline | null = null;
function getPipeline(model: string) {
  if (!pipeline) pipeline = new RAGPipeline(model);
  return pipeline;
}

export function RAGTab() {
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [hasEmbedModel, setHasEmbedModel] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemma4:latest');
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check Ollama status on mount
  useEffect(() => {
    const check = async () => {
      const status = await checkOllamaStatus();
      setOllamaStatus(status.running ? 'connected' : 'disconnected');
      if (status.models.length > 0) {
        setAvailableModels(status.models);
        setHasEmbedModel(status.models.some(m => m.includes('nomic-embed-text')));
        const gemma = status.models.find(m => m.includes('gemma4') || m.includes('gemma-4'));
        if (gemma) setSelectedModel(gemma);
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const rag = getPipeline(selectedModel);

    for (const file of Array.from(files)) {
      const docEntry: UploadedDoc = { name: file.name, chunks: 0, status: 'uploading' };
      setDocuments(prev => [...prev.filter(d => d.name !== file.name), docEntry]);

      try {
        const result = await rag.ingestFile(file, (p) => setIngestProgress(p));
        setDocuments(prev =>
          prev.map(d => d.name === file.name ? { ...d, chunks: result.chunks, status: 'ready' as const } : d)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setDocuments(prev =>
          prev.map(d => d.name === file.name ? { ...d, status: 'error' as const, error: msg } : d)
        );
      }
    }
    setIngestProgress(null);
  }, [selectedModel]);

  // Handle drag and drop
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  // Send query
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;
    if (ollamaStatus !== 'connected') return;

    const rag = getPipeline(selectedModel);
    if (rag.storeSize === 0) return;

    setInput('');
    setGenerating(true);
    pushHistory('research', text);

    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev,
      { role: 'user', text },
      { role: 'assistant', text: '' },
    ]);

    cancelRef.current = new AbortController();

    try {
      let accumulated = '';
      let sources: Message['sources'] = [];

      for await (const event of rag.query(text, 5, cancelRef.current.signal)) {
        if (event.type === 'context') {
          sources = event.chunks.map(c => ({
            source: c.chunk.metadata.source,
            score: c.score,
            preview: c.chunk.text.slice(0, 120) + '...',
          }));
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIdx] = { role: 'assistant', text: '', sources };
            return updated;
          });
        } else {
          accumulated += event.text;
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIdx] = { role: 'assistant', text: accumulated, sources };
            return updated;
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', text: `Error: ${msg}` };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [input, generating, ollamaStatus, selectedModel, messages.length]);

  const handleCancel = () => cancelRef.current?.abort();

  const removeDoc = (name: string) => {
    getPipeline(selectedModel).removeSource(name);
    setDocuments(prev => prev.filter(d => d.name !== name));
  };

  // Status indicator
  const statusColor = ollamaStatus === 'connected' ? 'var(--success)' : ollamaStatus === 'disconnected' ? 'var(--ax-error)' : 'var(--text-muted)';
  const statusText = ollamaStatus === 'connected' ? 'Ollama Connected' : ollamaStatus === 'disconnected' ? 'Ollama Not Found' : 'Checking...';

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 space-y-4 h-full relative">

      {/* ── Status Bar ── */}
      <div className="glass-panel p-4 rounded-xl flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {ollamaStatus === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: statusColor }} />
              )}
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: statusColor }} />
            </span>
            <span className="text-xs font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{statusText}</span>
          </div>
          {ollamaStatus === 'connected' && (
            <select
              className="text-[11px] font-mono bg-transparent border rounded px-2 py-1 outline-none"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--glass-border)' }}
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
            >
              {availableModels.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasEmbedModel && (
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              nomic-embed-text
            </span>
          )}
          <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {getPipeline(selectedModel).storeSize} chunks
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ color: 'var(--accent)', background: 'var(--glass-bg)' }}>
            RAG
          </span>
        </div>
      </div>

      {/* ── Disconnected Warning ── */}
      {ollamaStatus === 'disconnected' && (
        <div className="glass-panel p-5 rounded-xl text-center space-y-3">
          <span className="text-4xl">🦙</span>
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Ollama Not Running</h3>
          <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Start Ollama to use RAG with Gemma 4. Run <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: 'var(--glass-bg-hover)', color: 'var(--accent)' }}>ollama serve</code> in your terminal, then make sure Gemma 4 is pulled with <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: 'var(--glass-bg-hover)', color: 'var(--accent)' }}>ollama pull gemma4</code>.
          </p>
        </div>
      )}

      {/* ── Missing Embedding Model Warning ── */}
      {ollamaStatus === 'connected' && !hasEmbedModel && (
        <div className="glass-panel p-5 rounded-xl text-center space-y-3">
          <span className="text-4xl">📦</span>
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Embedding Model Required</h3>
          <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            RAG needs <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background: 'var(--glass-bg-hover)', color: 'var(--accent)' }}>nomic-embed-text</code> for document embeddings. Run:
          </p>
          <code className="block px-3 py-2 rounded-lg text-xs font-mono" style={{ background: 'var(--glass-bg-hover)', color: 'var(--accent)' }}>
            ollama pull nomic-embed-text
          </code>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            It's only ~274MB. Gemma 4 will be used for answering, nomic-embed-text for embeddings.
          </p>
        </div>
      )}

      {/* ── Document Upload Zone ── */}
      {ollamaStatus === 'connected' && hasEmbedModel && (
        <div
          className={`glass-panel rounded-xl transition-all shrink-0 ${dragOver ? 'ring-2' : ''}`}
          style={{ borderColor: dragOver ? 'var(--accent)' : undefined }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                Knowledge Base
              </h3>
              <button
                className="text-[10px] font-mono font-bold uppercase tracking-widest px-3 py-1 rounded-lg glass-panel transition-colors"
                style={{ color: 'var(--accent)' }}
                onClick={() => fileInputRef.current?.click()}
              >
                + Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".txt,.md,.csv,.json,.py,.js,.ts,.html,.log,.yaml,.yml,.xml,.toml,.pdf"
                onChange={e => handleFileUpload(e.target.files)}
              />
            </div>

            {/* Ingest progress */}
            {ingestProgress && (
              <div className="mb-3 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {ingestProgress.stage === 'extracting' && 'Extracting text...'}
                  {ingestProgress.stage === 'chunking' && 'Chunking document...'}
                  {ingestProgress.stage === 'embedding' && `Embedding ${ingestProgress.current}/${ingestProgress.total} chunks...`}
                </span>
              </div>
            )}

            {/* Document list */}
            {documents.length === 0 ? (
              <div className="py-6 text-center">
                <span className="text-3xl block mb-2">📄</span>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Drop files here or click Upload
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Supports .txt, .md, .csv, .json, .py, .js, .ts, .html, .pdf
                </p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                {documents.map(doc => (
                  <div key={doc.name} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">
                        {doc.status === 'ready' ? '✅' : doc.status === 'uploading' ? '⏳' : '❌'}
                      </span>
                      <span className="text-xs font-mono truncate" style={{ color: 'var(--text-primary)' }}>{doc.name}</span>
                      {doc.status === 'ready' && (
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {doc.chunks} chunks
                        </span>
                      )}
                      {doc.status === 'error' && (
                        <span className="text-[10px] font-mono" style={{ color: 'var(--ax-error)' }}>
                          {doc.error}
                        </span>
                      )}
                    </div>
                    <button
                      className="text-xs opacity-50 hover:opacity-100 transition-opacity ml-2"
                      onClick={() => removeDoc(doc.name)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Chat Area ── */}
      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4" ref={listRef}>
        {messages.length === 0 && ollamaStatus === 'connected' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
            <span className="text-6xl mb-4">🧠</span>
            <h3 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>RAG Knowledge Engine</h3>
            <p className="text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
              Upload documents, then ask questions. Gemma 4 will answer using your documents as context.
              All processing runs locally via Ollama.
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%] space-y-2">
              {/* Sources (shown before assistant message) */}
              {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-1">
                  {msg.sources.map((s, j) => (
                    <div
                      key={j}
                      className="px-2 py-1 rounded text-[10px] font-mono"
                      style={{ background: 'var(--glass-bg)', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}
                      title={s.preview}
                    >
                      📎 {s.source} <span style={{ color: 'var(--accent)' }}>({(s.score * 100).toFixed(0)}%)</span>
                    </div>
                  ))}
                </div>
              )}

              <div
                className={`p-5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'glass-panel-strong rounded-br-sm'
                    : 'glass-panel rounded-bl-sm'
                }`}
                style={msg.role === 'user' ? { color: 'var(--accent)', borderColor: 'var(--glass-border-hover)' } : { color: 'var(--text-primary)' }}
              >
                <p className="whitespace-pre-wrap">{msg.text || '...'}</p>
              </div>
            </div>
          </div>
        ))}

        {generating && messages[messages.length - 1]?.text === '' && (
          <div className="flex justify-start">
            <div className="glass-panel p-5 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }} />
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '75ms' }} />
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)', animationDelay: '150ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Input Bar ── */}
      {ollamaStatus === 'connected' && (
        <div className="mt-4 pt-4 shrink-0" style={{ borderTop: '1px solid var(--glass-border)' }}>
          <form
            className="flex items-center gap-4 glass-panel-strong rounded-full p-2 pr-4"
            style={{ boxShadow: 'var(--glass-shadow)' }}
            onSubmit={e => { e.preventDefault(); send(); }}
          >
            <input
              type="text"
              className="flex-1 bg-transparent border-none text-sm px-4 py-2 outline-none"
              style={{ color: 'var(--text-primary)' }}
              placeholder={documents.some(d => d.status === 'ready')
                ? 'Ask a question about your documents...'
                : 'Upload documents first to start querying...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={generating || !documents.some(d => d.status === 'ready')}
            />
            {generating ? (
              <button
                type="button"
                className="px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest glass-panel transition-colors"
                style={{ color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}
                onClick={handleCancel}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="btn-primary px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest"
                disabled={!input.trim() || !documents.some(d => d.status === 'ready')}
              >
                Ask
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
