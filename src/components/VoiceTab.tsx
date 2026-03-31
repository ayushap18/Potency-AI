import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, ModelCategory, ModelManager, AudioCapture, AudioPlayback, SpeechActivity } from '@runanywhere/web';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'processing' | 'speaking';

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

  const micRef = useRef<AudioCapture | null>(null);
  const pipelineRef = useRef<VoicePipeline | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);
  const processSpeechRef = useRef<((audio: Float32Array) => void) | null>(null);

  useEffect(() => {
    return () => { micRef.current?.stop(); vadUnsub.current?.(); };
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
    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio) || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language) || !ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);
    if (anyMissing) { const ok = await ensureModels(); if (!ok) return; }
    setVoiceState('listening');
    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;
    if (!pipelineRef.current) pipelineRef.current = new VoicePipeline();
    VAD.reset();
    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) processSpeechRef.current?.(segment.samples);
      }
    });
    await mic.start((chunk) => { VAD.processSamples(chunk); }, (level) => { setAudioLevel(level); });
  }, [ensureModels]);

  const processSpeech = useCallback(async (audioData: Float32Array) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    micRef.current?.stop(); vadUnsub.current?.(); setVoiceState('processing');
    try {
      const result = await pipeline.processTurn(audioData, { maxTokens: 60, temperature: 0.7, systemPrompt: 'You are a helpful voice assistant. Keep responses concise — 1-2 sentences max.' }, {
        onTranscription: (text) => setTranscript(text),
        onResponseToken: (_token, accumulated) => setResponse(accumulated),
        onResponseComplete: (text) => setResponse(text),
        onSynthesisComplete: async (audio, sampleRate) => {
          setVoiceState('speaking');
          const player = new AudioPlayback({ sampleRate });
          await player.play(audio, sampleRate); player.dispose();
        },
        onStateChange: (s) => {
          if (s === 'processingSTT') setVoiceState('processing');
          if (s === 'generatingResponse') setVoiceState('processing');
          if (s === 'playingTTS') setVoiceState('speaking');
        },
      });
      if (result) { setTranscript(result.transcription); setResponse(result.response); }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    setVoiceState('idle'); setAudioLevel(0);
  }, []);

  processSpeechRef.current = processSpeech;

  const stopListening = useCallback(() => {
    micRef.current?.stop(); vadUnsub.current?.(); setVoiceState('idle'); setAudioLevel(0);
  }, []);

  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader }, { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader }, { label: 'TTS', loader: ttsLoader },
  ].filter((l) => l.loader.state !== 'ready');

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
                onClick={voiceState === 'idle' ? startListening : stopListening}
                disabled={voiceState === 'loading-models'}
                className="relative w-32 h-32 rounded-full glass-panel-strong flex items-center justify-center transition-transform active:scale-95 z-10"
                style={{ borderColor: 'var(--glass-border-hover)', boxShadow: '0 0 30px var(--accent-dim)' }}
              >
                <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1", color: voiceState === 'listening' ? 'var(--ax-error)' : 'var(--accent)' }}>
                  {voiceState === 'listening' ? 'stop' : 'mic'}
                </span>
              </button>
            </div>

            {voiceState === 'listening' && (
              <div className="flex items-end justify-center gap-1 h-16 w-full max-w-md opacity-60">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="rounded-full transition-all" style={{
                    width: 4, height: Math.max(4, Math.random() * (audioLevel * 100 + 10)),
                    background: 'var(--accent)',
                  }} />
                ))}
              </div>
            )}
          </div>

          <p className="max-w-md mx-auto text-lg leading-relaxed relative z-10" style={{ color: 'var(--text-secondary)' }}>
            {voiceState === 'idle' && 'Tap to start recording. Our AI will transcribe, clean, and summarize your thoughts in real-time.'}
            {voiceState === 'loading-models' && 'Loading engine modules...'}
            {voiceState === 'processing' && 'Extracting semantic structure...'}
            {voiceState === 'speaking' && 'Audio output synthesis...'}
          </p>
        </section>

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
