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
  // Stable ref so VAD callback always sees the latest processSpeech without stale closure
  const processSpeechRef = useRef<((audio: Float32Array) => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
    };
  }, []);

  // Ensure all 4 models are loaded
  const ensureModels = useCallback(async (): Promise<boolean> => {
    setVoiceState('loading-models');
    setError(null);

    const results = await Promise.all([
      vadLoader.ensure(),
      sttLoader.ensure(),
      llmLoader.ensure(),
      ttsLoader.ensure(),
    ]);

    if (results.every(Boolean)) {
      setVoiceState('idle');
      return true;
    }

    setError('Failed to load one or more voice models');
    setVoiceState('idle');
    return false;
  }, [vadLoader, sttLoader, llmLoader, ttsLoader]);

  // Start listening
  const startListening = useCallback(async () => {
    setTranscript('');
    setResponse('');
    setError(null);

    // Load models if needed
    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);

    if (anyMissing) {
      const ok = await ensureModels();
      if (!ok) return;
    }

    setVoiceState('listening');

    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;

    if (!pipelineRef.current) {
      pipelineRef.current = new VoicePipeline();
    }

    // Start VAD + mic
    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          processSpeechRef.current?.(segment.samples);
        }
      }
    });

    await mic.start(
      (chunk) => { VAD.processSamples(chunk); },
      (level) => { setAudioLevel(level); },
    );
  }, [ensureModels]);

  // Process a speech segment through the full pipeline
  const processSpeech = useCallback(async (audioData: Float32Array) => {

    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    // Stop mic during processing
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('processing');

    try {
      const result = await pipeline.processTurn(audioData, {
        maxTokens: 60,
        temperature: 0.7,
        systemPrompt: 'You are a helpful voice assistant. Keep responses concise — 1-2 sentences max.',
      }, {
        onTranscription: (text) => {
          setTranscript(text);
        },
        onResponseToken: (_token, accumulated) => {
          setResponse(accumulated);
        },
        onResponseComplete: (text) => {
          setResponse(text);
        },
        onSynthesisComplete: async (audio, sampleRate) => {
          setVoiceState('speaking');
          const player = new AudioPlayback({ sampleRate });
          await player.play(audio, sampleRate);
          player.dispose();
        },
        onStateChange: (s) => {
          if (s === 'processingSTT') setVoiceState('processing');
          if (s === 'generatingResponse') setVoiceState('processing');
          if (s === 'playingTTS') setVoiceState('speaking');
        },
      });

      if (result) {
        setTranscript(result.transcription);
        setResponse(result.response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  // Keep ref in sync so VAD callback always calls the latest version
  processSpeechRef.current = processSpeech;

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  // Which loaders are still loading?
  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader },
    { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader },
    { label: 'TTS', loader: ttsLoader },
  ].filter((l) => l.loader.state !== 'ready');

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 bg-surface space-y-8 animate-fade-in custom-scrollbar">
      {pendingLoaders.length > 0 && voiceState === 'idle' && (
        <ModelBanner
          state={pendingLoaders[0].loader.state}
          progress={pendingLoaders[0].loader.progress}
          error={pendingLoaders[0].loader.error}
          onLoad={ensureModels}
          label={`Voice (${pendingLoaders.map((l) => l.label).join(', ')})`}
        />
      )}

      {error && <div className="bg-error-container text-on-error-container p-4 rounded-lg"><span className="font-mono text-sm">{error}</span></div>}

      <div className="max-w-6xl mx-auto w-full space-y-8 relative">
        <section className="relative bg-surface-container-low rounded-2xl p-12 overflow-hidden flex flex-col items-center justify-center text-center shadow-lg border border-outline-variant/10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -mr-32 -mt-32"></div>
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-secondary/5 blur-[80px] rounded-full -ml-24 -mb-24"></div>
          
          <div className="mb-4 relative z-10">
            <span className="text-primary text-xs font-bold tracking-[0.2em] uppercase">
              {voiceState === 'idle' ? 'Ready to Listen' : voiceState}
            </span>
            <h1 className="text-4xl font-headline font-extrabold text-on-surface tracking-tight mt-2">Speech to Intelligence</h1>
          </div>

          <div className="my-12 flex flex-col items-center gap-10 w-full relative z-10">
            <div className="relative group">
              <div 
                className={`absolute inset-0 bg-primary/20 rounded-full blur-2xl group-hover:bg-primary/40 transition-all duration-500
                 ${voiceState === 'listening' ? 'animate-pulse bg-primary/50' : ''}`}
                style={voiceState === 'listening' ? { transform: `scale(${1 + audioLevel * 2})` } : {}}
              ></div>
              <button 
                onClick={voiceState === 'idle' ? startListening : stopListening}
                disabled={voiceState === 'loading-models'}
                className="relative w-32 h-32 rounded-full bg-gradient-to-br from-primary to-primary-container flex items-center justify-center mic-glow transition-transform active:scale-95 z-10"
              >
                <span className={`material-symbols-outlined text-4xl ${voiceState === 'listening' ? 'text-primary' : 'text-on-primary'}`} style={{fontVariationSettings: "'FILL' 1"}}>
                  {voiceState === 'listening' ? 'stop' : 'mic'}
                </span>
              </button>
            </div>
            
            {voiceState === 'listening' && (
              <div className="flex items-end justify-center gap-1 h-16 w-full max-w-md opacity-60">
                 {Array.from({length: 12}).map((_, i) => (
                    <div key={i} className="waveform-bar" style={{ height: Math.max(4, Math.random() * (audioLevel * 100 + 10)) + 'px' }}></div>
                 ))}
              </div>
            )}
          </div>

          <p className="text-on-surface-variant max-w-md mx-auto text-lg leading-relaxed relative z-10">
             {voiceState === 'idle' && 'Tap to start recording. Our AI will transcribe, clean, and summarize your thoughts in real-time.'}
             {voiceState === 'loading-models' && 'Loading engine modules...'}
             {voiceState === 'processing' && 'Extracting semantic structure...'}
             {voiceState === 'speaking' && 'Audio output synthesis...'}
          </p>
        </section>

        {(transcript || response) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start relative z-10">
            {transcript && (
              <div className="bg-surface-container-highest rounded-2xl p-8 min-h-[400px] flex flex-col border border-outline-variant/10 shadow-lg">
                 <div className="flex items-center justify-between mb-8">
                   <div className="flex items-center gap-3">
                     <span className="material-symbols-outlined text-primary">notes</span>
                     <h3 className="text-xl font-bold text-on-surface">Live Transcript</h3>
                   </div>
                 </div>
                 <div className="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar text-on-surface">
                   <p className="leading-relaxed text-sm">{transcript}</p>
                 </div>
              </div>
            )}

            {response && (
              <div className="bg-surface-container-lowest rounded-2xl p-8 min-h-[400px] flex flex-col border border-primary/20 shadow-lg shadow-primary/5">
                 <div className="flex items-center justify-between mb-8">
                   <div className="flex items-center gap-3">
                     <span className="material-symbols-outlined text-primary">auto_awesome</span>
                     <h3 className="text-xl font-bold text-on-surface">AI Extraction</h3>
                   </div>
                 </div>
                 <div className="flex-1 overflow-y-auto pr-4 space-y-6 custom-scrollbar text-on-surface">
                   <p className="leading-relaxed text-sm italic border-l-2 border-primary/40 pl-4">{response}</p>
                 </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
