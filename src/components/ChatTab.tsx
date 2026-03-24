import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  stats?: { tokens: number; tokPerSec: number; latencyMs: number };
}

export function ChatTab() {
  const loader = useModelLoader(ModelCategory.Language);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const assistantIdxRef = useRef<number>(-1);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    // Ensure model is loaded
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setInput('');
    setGenerating(true);

    // Append user + empty assistant message atomically; capture the correct assistant index
    setMessages((prev) => {
      assistantIdxRef.current = prev.length + 1;
      return [
        ...prev,
        { role: 'user' as const, text },
        { role: 'assistant' as const, text: '' },
      ];
    });

    try {
      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(text, {
        maxTokens: 512,
        temperature: 0.7,
      });
      cancelRef.current = cancel;

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        setMessages((prev) => {
          const updated = [...prev];
          updated[assistantIdxRef.current] = { role: 'assistant', text: accumulated };
          return updated;
        });
      }

      const result = await resultPromise;
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdxRef.current] = {
          role: 'assistant',
          text: result.text || accumulated,
          stats: {
            tokens: result.tokensUsed,
            tokPerSec: result.tokensPerSecond,
            latencyMs: result.latencyMs,
          },
        };
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const updated = [...prev];
        updated[assistantIdxRef.current] = { role: 'assistant', text: `Error: ${msg}` };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
    }
  }, [input, generating, loader]);

  const handleCancel = () => {
    cancelRef.current?.();
  };

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 bg-surface space-y-6 h-full relative">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM Engine"
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6" ref={listRef}>
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
            <span className="material-symbols-outlined text-6xl mb-4 text-outline-variant">forum</span>
            <h3 className="text-xl font-bold text-on-surface mb-2">Neural Interactive Session</h3>
            <p className="text-sm text-outline-variant max-w-sm">
              Type a message below to converse with the on-device AI. Processing occurs entirely in local memory.
            </p>
          </div>
        )}
        
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div 
              className={`max-w-[85%] p-5 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-gradient-to-br from-primary to-primary-container text-on-primary rounded-br-sm shadow-lg shadow-primary/10' 
                  : 'bg-surface-container-low border border-outline-variant/10 text-on-surface rounded-bl-sm'
              }`}
            >
              <p className="whitespace-pre-wrap word-break">{msg.text || '...'}</p>
              
              {msg.stats && (
                <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-[10px] font-mono opacity-60">
                  <div className="flex gap-4">
                    <span>{msg.stats.tokens} tokens</span>
                    <span>{msg.stats.tokPerSec.toFixed(1)} tok/s</span>
                  </div>
                  <span>{msg.stats.latencyMs.toFixed(0)}ms</span>
                </div>
              )}
            </div>
          </div>
        ))}
        {generating && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="bg-surface-container-low border border-outline-variant/10 p-5 rounded-2xl rounded-bl-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse delay-75"></span>
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse delay-150"></span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-outline-variant/10">
        <form
          className="flex items-center gap-4 bg-surface-container-high rounded-full p-2 pr-4 focus-within:ring-1 focus-within:ring-primary/40 transition-shadow shadow-md shadow-black/20"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <input
            type="text"
            className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-on-surface placeholder:text-outline-variant px-4 py-2 outline-none"
            placeholder="Transmit data to the neural core..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={generating}
          />
          {generating ? (
            <button 
              type="button" 
              className="px-6 py-2 rounded-full bg-error/20 text-error text-xs font-bold uppercase tracking-widest hover:bg-error/30 transition-colors" 
              onClick={handleCancel}
            >
              Halt
            </button>
          ) : (
            <button 
              type="submit" 
              className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                input.trim() 
                  ? 'bg-primary text-on-primary shadow-lg hover:shadow-primary/20 hover:bg-primary-container' 
                  : 'bg-surface-variant text-on-surface-variant opacity-50 cursor-not-allowed'
              }`}
              disabled={!input.trim()}
            >
              Transmit
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
