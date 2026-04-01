import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, ModelCategory, ModelManager, AudioCapture, AudioPlayback, SpeechActivity } from '@runanywhere/web';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'waiting-pause' | 'processing' | 'speaking';

// Time to wait after speech pauses before auto-processing
const SILENCE_TIMEOUT_MS = 2500;

// Diagnostics result for self-check
interface DiagResult { label: string; status: 'pass' | 'fail' | 'checking' | 'skip'; detail?: string; }

export function VoiceTab() {
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  const ttsLoader = useModelLoader(ModelCategory.SpeechSynthesis, true);
  const vadLoader = useModelLoader(ModelCategory.Audio, true);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Diagnostics
  const [showDiag, setShowDiag] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagResult[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);

  const micRef = useRef<AudioCapture | null>(null);
  const pipelineRef = useRef<VoicePipeline | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);
  const processSpeechRef = useRef<((audio: Float32Array) => void) | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedSamplesRef = useRef<Float32Array[]>([]);
  // Track audio playback so we don't set idle prematurely
  const playbackDoneRef = useRef<Promise<void> | null>(null);
  const autoRestartRef = useRef(true);

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  const ensureModels = useCallback(async (): Promise<boolean> => {
    setVoiceState('loading-models');
    setError(null);
    const results = await Promise.all([vadLoader.ensure(), sttLoader.ensure(), llmLoader.ensure(), ttsLoader.ensure()]);
    if (results.every(Boolean)) { setVoiceState('idle'); return true; }
    setError('Failed to load one or more voice models');
    setVoiceState('idle');
    return false;
  }, [vadLoader, sttLoader, llmLoader, ttsLoader]);

  const startListening = useCallback(async () => {
    setTranscript(''); setResponse(''); setError(null);
    accumulatedSamplesRef.current = [];
    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio) || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language) || !ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);
    if (anyMissing) { const ok = await ensureModels(); if (!ok) return; }
    setVoiceState('listening');
    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;
    if (!pipelineRef.current) pipelineRef.current = new VoicePipeline();
    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      // Clear any existing silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          // Accumulate samples
          accumulatedSamplesRef.current.push(segment.samples);

          // Show "waiting for more speech" state
          setVoiceState('waiting-pause');

          // Set timeout to process after silence
          silenceTimeoutRef.current = setTimeout(() => {
            // Combine all accumulated samples
            const totalLength = accumulatedSamplesRef.current.reduce((sum, arr) => sum + arr.length, 0);
            if (totalLength > 0) {
              const combined = new Float32Array(totalLength);
              let offset = 0;
              for (const arr of accumulatedSamplesRef.current) {
                combined.set(arr, offset);
                offset += arr.length;
              }
              accumulatedSamplesRef.current = [];
              processSpeechRef.current?.(combined);
            }
          }, SILENCE_TIMEOUT_MS);
        }
      } else if (activity === SpeechActivity.Started) {
        setVoiceState('listening');
      }
    });

    await mic.start((chunk) => { VAD.processSamples(chunk); }, (level) => { setAudioLevel(level); });
  }, [ensureModels]);

  const stopListening = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    accumulatedSamplesRef.current = [];
    micRef.current?.stop();
    vadUnsub.current?.();
    autoRestartRef.current = false;
    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  const processSpeech = useCallback(async (audioData: Float32Array) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    micRef.current?.stop(); vadUnsub.current?.(); setVoiceState('processing');

    // Promise that resolves when audio playback finishes
    let resolvePlayback: () => void;
    playbackDoneRef.current = new Promise<void>((r) => { resolvePlayback = r; });

    try {
      const result = await pipeline.processTurn(audioData, { maxTokens: 60, temperature: 0.7, systemPrompt: 'You are a helpful voice assistant. Keep responses concise — 1-2 sentences max.' }, {
        onTranscription: (text) => setTranscript(text),
        onResponseToken: (_token, accumulated) => setResponse(accumulated),
        onResponseComplete: (text) => setResponse(text),
        onSynthesisComplete: async (audio, sampleRate) => {
          setVoiceState('speaking');
          try {
            const player = new AudioPlayback({ sampleRate });
            await player.play(audio, sampleRate);
            player.dispose();
          } finally {
            resolvePlayback!();
          }
        },
        onStateChange: (s) => {
          if (s === 'processingSTT') setVoiceState('processing');
          if (s === 'generatingResponse') setVoiceState('processing');
          if (s === 'playingTTS') setVoiceState('speaking');
        },
      });
      if (result) { setTranscript(result.transcription); setResponse(result.response); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      resolvePlayback!();
    }

    // Wait for audio playback to actually finish before going idle
    await playbackDoneRef.current;
    playbackDoneRef.current = null;

    setVoiceState('idle');
    setAudioLevel(0);

    // Auto-restart listening for continuous conversation
    if (autoRestartRef.current) {
      // Small delay so the user sees the response before we start listening again
      setTimeout(() => {
        if (autoRestartRef.current) {
          startListening();
        }
      }, 800);
    }
  }, [startListening]);

  processSpeechRef.current = processSpeech;

  // ── Diagnostics ──
  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    const results: DiagResult[] = [];
    const update = (r: DiagResult[]) => setDiagResults([...r]);

    // 1. Check microphone access
    results.push({ label: 'Microphone Access', status: 'checking' });
    update(results);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      results[results.length - 1] = { label: 'Microphone Access', status: 'pass', detail: 'Permission granted' };
    } catch (err) {
      results[results.length - 1] = { label: 'Microphone Access', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }
    update(results);

    // 2. Check VAD model
    results.push({ label: 'VAD Model (Silero)', status: 'checking' });
    update(results);
    const vadLoaded = !!ModelManager.getLoadedModel(ModelCategory.Audio);
    if (vadLoaded) {
      results[results.length - 1] = { label: 'VAD Model (Silero)', status: 'pass', detail: 'Loaded' };
    } else {
      const vadModels = ModelManager.getModels().filter(m => m.modality === ModelCategory.Audio);
      if (vadModels.length > 0) {
        results[results.length - 1] = { label: 'VAD Model (Silero)', status: 'fail', detail: `Available but not loaded (${vadModels[0].status})` };
      } else {
        results[results.length - 1] = { label: 'VAD Model (Silero)', status: 'fail', detail: 'No VAD model registered' };
      }
    }
    update(results);

    // 3. Check STT model
    results.push({ label: 'STT Model (Whisper)', status: 'checking' });
    update(results);
    const sttLoaded = !!ModelManager.getLoadedModel(ModelCategory.SpeechRecognition);
    if (sttLoaded) {
      results[results.length - 1] = { label: 'STT Model (Whisper)', status: 'pass', detail: 'Loaded' };
    } else {
      const sttModels = ModelManager.getModels().filter(m => m.modality === ModelCategory.SpeechRecognition);
      if (sttModels.length > 0) {
        results[results.length - 1] = { label: 'STT Model (Whisper)', status: 'fail', detail: `Available but not loaded (${sttModels[0].status})` };
      } else {
        results[results.length - 1] = { label: 'STT Model (Whisper)', status: 'fail', detail: 'No STT model registered' };
      }
    }
    update(results);

    // 4. Check LLM model
    results.push({ label: 'LLM Model', status: 'checking' });
    update(results);
    const llmLoaded = !!ModelManager.getLoadedModel(ModelCategory.Language);
    if (llmLoaded) {
      results[results.length - 1] = { label: 'LLM Model', status: 'pass', detail: 'Loaded' };
    } else {
      const llmModels = ModelManager.getModels().filter(m => m.modality === ModelCategory.Language);
      if (llmModels.length > 0) {
        results[results.length - 1] = { label: 'LLM Model', status: 'fail', detail: `Available but not loaded (${llmModels[0].status})` };
      } else {
        results[results.length - 1] = { label: 'LLM Model', status: 'fail', detail: 'No LLM model registered' };
      }
    }
    update(results);

    // 5. Check TTS model
    results.push({ label: 'TTS Model (Piper)', status: 'checking' });
    update(results);
    const ttsLoaded = !!ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);
    if (ttsLoaded) {
      results[results.length - 1] = { label: 'TTS Model (Piper)', status: 'pass', detail: 'Loaded' };
    } else {
      const ttsModels = ModelManager.getModels().filter(m => m.modality === ModelCategory.SpeechSynthesis);
      if (ttsModels.length > 0) {
        results[results.length - 1] = { label: 'TTS Model (Piper)', status: 'fail', detail: `Available but not loaded (${ttsModels[0].status})` };
      } else {
        results[results.length - 1] = { label: 'TTS Model (Piper)', status: 'fail', detail: 'No TTS model registered' };
      }
    }
    update(results);

    // 6. Check VoicePipeline can be instantiated
    results.push({ label: 'Voice Pipeline', status: 'checking' });
    update(results);
    try {
      const p = new VoicePipeline();
      results[results.length - 1] = { label: 'Voice Pipeline', status: 'pass', detail: `State: ${p.state}` };
    } catch (err) {
      results[results.length - 1] = { label: 'Voice Pipeline', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }
    update(results);

    // 7. Check AudioPlayback support
    results.push({ label: 'Audio Playback', status: 'checking' });
    update(results);
    try {
      const ctx = new AudioContext();
      await ctx.close();
      results[results.length - 1] = { label: 'Audio Playback', status: 'pass', detail: 'AudioContext available' };
    } catch (err) {
      results[results.length - 1] = { label: 'Audio Playback', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }
    update(results);

    setDiagRunning(false);
  }, []);

  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader }, { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader }, { label: 'TTS', loader: ttsLoader },
  ].filter((l) => l.loader.state !== 'ready');

  const allModelsReady = pendingLoaders.length === 0 || (vadLoader.state === 'ready' && sttLoader.state === 'ready' && llmLoader.state === 'ready' && ttsLoader.state === 'ready');

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 space-y-8 custom-scrollbar">
      {pendingLoaders.length > 0 && voiceState === 'idle' && (
        <ModelBanner state={pendingLoaders[0].loader.state} progress={pendingLoaders[0].loader.progress}
          error={pendingLoaders[0].loader.error} onLoad={ensureModels}
          label={`Voice (${pendingLoaders.map((l) => l.label).join(', ')})`} />
      )}

      {error && (
        <div className="glass-panel rounded-lg p-4" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
          <span className="font-mono text-sm" style={{ color: 'var(--ax-error)' }}>{error}</span>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full space-y-8 relative">
        <section className="relative glass-panel-elevated rounded-2xl p-12 overflow-hidden flex flex-col items-center justify-center text-center">
          <div className="mb-4 relative z-10">
            <span className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: 'var(--accent)' }}>
              {voiceState === 'idle' ? 'Ready to Listen' : voiceState}
            </span>
            <h1 className="text-4xl font-extrabold tracking-tight mt-2" style={{ color: 'var(--text-primary)' }}>Speech to Intelligence</h1>
          </div>

          <div className="my-12 flex flex-col items-center gap-10 w-full relative z-10">
            <div className="relative group">
              <div
                className={`absolute inset-0 rounded-full blur-2xl transition-all duration-500 ${voiceState === 'listening' ? 'animate-pulse' : ''}`}
                style={{
                  background: `radial-gradient(ellipse, var(--accent-dim) 0%, transparent 70%)`,
                  transform: voiceState === 'listening' ? `scale(${1 + audioLevel * 2})` : 'scale(1)',
                }}
              />
              <button
                onClick={() => {
                  if (voiceState === 'idle') {
                    autoRestartRef.current = true;
                    startListening();
                  } else {
                    stopListening();
                  }
                }}
                disabled={voiceState === 'loading-models'}
                className="relative w-32 h-32 rounded-full glass-panel-strong flex items-center justify-center transition-transform active:scale-95 z-10"
                style={{ borderColor: 'var(--glass-border-hover)', boxShadow: '0 0 30px var(--accent-dim)' }}
              >
                <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1", color: voiceState === 'listening' || voiceState === 'waiting-pause' ? 'var(--ax-error)' : 'var(--accent)' }}>
                  {voiceState === 'listening' || voiceState === 'waiting-pause' ? 'stop' : 'mic'}
                </span>
              </button>
            </div>

            {(voiceState === 'listening' || voiceState === 'waiting-pause') && (
              <div className="flex items-end justify-center gap-1 h-16 w-full max-w-md opacity-60">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-full transition-all" style={{
                    width: 4, height: Math.max(4, Math.random() * (audioLevel * 100 + 10)),
                    background: voiceState === 'waiting-pause' ? 'var(--accent-dim)' : 'var(--accent)',
                  }} />
                ))}
              </div>
            )}
          </div>

          <p className="max-w-md mx-auto text-lg leading-relaxed relative z-10" style={{ color: 'var(--text-secondary)' }}>
            {voiceState === 'idle' && 'Tap to start recording. Our AI will transcribe, clean, and summarize your thoughts in real-time.'}
            {voiceState === 'loading-models' && 'Loading engine modules...'}
            {voiceState === 'listening' && 'Listening... speak naturally.'}
            {voiceState === 'waiting-pause' && 'Pause detected. Continue speaking or wait 2.5s to process...'}
            {voiceState === 'processing' && 'Extracting semantic structure...'}
            {voiceState === 'speaking' && 'Audio output synthesis...'}
          </p>

          {/* Status indicators */}
          {allModelsReady && voiceState === 'idle' && (
            <div className="mt-6 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest" style={{ color: 'var(--success)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
              All voice models loaded — ready
            </div>
          )}
        </section>

        {/* Diagnostics panel */}
        <div className="flex justify-center">
          <button
            className="glass-panel px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => { setShowDiag(!showDiag); if (!showDiag && diagResults.length === 0) runDiagnostics(); }}
          >
            <span className="material-symbols-outlined text-sm align-middle mr-1">monitor_heart</span>
            {showDiag ? 'Hide' : 'Run'} Diagnostics
          </button>
        </div>

        {showDiag && (
          <div className="glass-panel-elevated rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold tracking-widest uppercase font-mono" style={{ color: 'var(--accent)' }}>
                Voice Pipeline Diagnostics
              </h3>
              <button
                className="glass-panel px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--text-secondary)' }}
                onClick={runDiagnostics}
                disabled={diagRunning}
              >
                {diagRunning ? 'Running...' : 'Re-run'}
              </button>
            </div>
            {diagResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ background: 'var(--glass-bg)' }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                  background: r.status === 'pass' ? 'var(--success)' : r.status === 'fail' ? 'var(--ax-error)' : r.status === 'checking' ? 'var(--accent)' : 'var(--text-muted)',
                  animation: r.status === 'checking' ? 'pulse 1s infinite' : 'none',
                }} />
                <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--text-primary)', minWidth: 160 }}>{r.label}</span>
                <span className="text-[10px] font-mono" style={{ color: r.status === 'pass' ? 'var(--success)' : r.status === 'fail' ? 'var(--ax-error)' : 'var(--text-muted)' }}>
                  {r.status === 'checking' ? 'Checking...' : r.detail || r.status}
                </span>
              </div>
            ))}
            {diagResults.length === 0 && !diagRunning && (
              <p className="text-xs font-mono text-center py-4" style={{ color: 'var(--text-muted)' }}>Click "Re-run" to check voice pipeline health</p>
            )}
          </div>
        )}

        {(transcript || response) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start relative z-10">
            {transcript && (
              <div className="glass-panel-elevated rounded-2xl p-8 min-h-[400px] flex flex-col">
                <div className="flex items-center gap-3 mb-8">
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent)' }}>notes</span>
                  <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Live Transcript</h3>
                </div>
                <div className="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar">
                  <p className="leading-relaxed text-sm" style={{ color: 'var(--text-primary)' }}>{transcript}</p>
                </div>
              </div>
            )}
            {response && (
              <div className="glass-panel-elevated rounded-2xl p-8 min-h-[400px] flex flex-col" style={{ borderColor: 'var(--glass-border-hover)' }}>
                <div className="flex items-center gap-3 mb-8">
                  <span className="material-symbols-outlined" style={{ color: 'var(--accent)' }}>auto_awesome</span>
                  <h3 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>AI Extraction</h3>
                </div>
                <div className="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar">
                  <p className="leading-relaxed text-sm italic pl-4" style={{ color: 'var(--text-primary)', borderLeft: '2px solid var(--accent)' }}>{response}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
