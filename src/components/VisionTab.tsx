import React, { useState, useRef, useEffect, useCallback, Component, ErrorInfo } from 'react';
import { ModelCategory, VideoCapture, ModelManager } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

const LIVE_INTERVAL_MS = 2500;
const LIVE_MAX_TOKENS = 30;
const SINGLE_MAX_TOKENS = 80;
const CAPTURE_DIM = 256;
const MAX_CONSECUTIVE_CRASHES = 3;

interface VisionResult { text: string; totalMs: number; }
interface DiagResult { label: string; status: 'pass' | 'fail' | 'checking' | 'skip'; detail?: string; }

class VisionErrorBoundary extends Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Vision pipeline error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col p-8 items-center justify-center text-center space-y-4">
          <span className="material-symbols-outlined text-[48px] text-[var(--danger)]">error</span>
          <h2 className="text-xl font-bold">Vision engine crashed</h2>
          <p className="text-sm text-[var(--text-muted)] max-w-md">{this.state.error?.message || "An unexpected error occurred in the WebAssembly vision thread."}</p>
          <button className="btn-primary" onClick={() => this.setState({hasError: false, error: null})}>Restart Vision Engine</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function VisionTab() {
  return (
    <VisionErrorBoundary>
      <VisionTabInner />
    </VisionErrorBoundary>
  );
}

function VisionTabInner() {
  const loader = useModelLoader(ModelCategory.Multimodal);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Describe what you see briefly.');
  const [recovering, setRecovering] = useState(false);

  // Diagnostics
  const [showDiag, setShowDiag] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagResult[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);

  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveModeRef = useRef(false);
  const crashCountRef = useRef(0);
  const lastFrameRef = useRef<Uint8Array | null>(null);

  processingRef.current = processing;
  liveModeRef.current = liveMode;

  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;
    setError(null);
    try {
      const cam = new VideoCapture({ facingMode: 'environment' });
      await cam.start();
      captureRef.current = cam;
      const mount = videoMountRef.current;
      if (mount) {
        const el = cam.videoElement;
        el.style.width = '100%';
        el.style.borderRadius = '12px';
        mount.appendChild(el);
      }
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowed') || msg.includes('Permission'))
        setError('Camera permission denied. Check your browser settings.');
      else if (msg.includes('NotFound') || msg.includes('DevicesNotFound'))
        setError('No camera found on this device.');
      else if (msg.includes('NotReadable') || msg.includes('TrackStartError'))
        setError('Camera is in use by another application.');
      else setError(`Camera error: ${msg}`);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      const cam = captureRef.current;
      if (cam) { cam.stop(); cam.videoElement.parentNode?.removeChild(cam.videoElement); captureRef.current = null; }
    };
  }, []);

  const stopLive = useCallback(() => {
    setLiveMode(false); liveModeRef.current = false;
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
  }, []);

  /** Check if frame is significantly different from last frame (simple pixel diff) */
  const isFrameDifferent = useCallback((newFrame: Uint8Array): boolean => {
    if (!lastFrameRef.current) return true;
    if (lastFrameRef.current.length !== newFrame.length) return true;

    // Sample every 100th pixel for performance
    let diffCount = 0;
    const threshold = 30; // per-channel diff threshold
    const sampleStep = 100;

    for (let i = 0; i < newFrame.length; i += sampleStep * 3) {
      const diff = Math.abs(newFrame[i] - lastFrameRef.current[i]) +
                   Math.abs(newFrame[i + 1] - lastFrameRef.current[i + 1]) +
                   Math.abs(newFrame[i + 2] - lastFrameRef.current[i + 2]);
      if (diff > threshold * 3) diffCount++;
    }

    // If more than 10% of sampled pixels changed significantly
    return diffCount > (newFrame.length / sampleStep / 3) * 0.1;
  }, []);

  /** Attempt to recover VLM after a crash */
  const recoverVLM = useCallback(async () => {
    setRecovering(true);
    setResult({ text: 'Recovering VLM model...', totalMs: 0 });

    try {
      // Use ModelManager to reload (it handles VLM worker internally)
      const models = ModelManager.getModels().filter(m => m.modality === ModelCategory.Multimodal);
      if (models.length === 0) {
        throw new Error('No VLM model found');
      }

      // Unload and reload through ModelManager
      await ModelManager.unloadModel(models[0].id);
      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
      await ModelManager.loadModel(models[0].id);

      crashCountRef.current = 0;
      setResult({ text: 'Recovery successful. Ready for next frame.', totalMs: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`VLM recovery failed: ${msg}. Please refresh the page.`);
      // Stop live mode on recovery failure
      stopLive();
    } finally {
      setRecovering(false);
    }
  }, [stopLive]);

  const describeFrame = useCallback(async (maxTokens: number) => {
    if (processingRef.current || recovering) return;
    const cam = captureRef.current;
    if (!cam?.isCapturing) return;
    if (loader.state !== 'ready') { const ok = await loader.ensure(); if (!ok) return; }
    const frame = cam.captureFrame(CAPTURE_DIM);
    if (!frame) return;

    // Skip frame if scene hasn't changed (live mode optimization)
    if (liveModeRef.current && !isFrameDifferent(frame.rgbPixels)) {
      return;
    }

    setProcessing(true); processingRef.current = true; setError(null);
    const t0 = performance.now();
    try {
      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) throw new Error('VLM model not loaded in worker');
      const res = await bridge.process(frame.rgbPixels, frame.width, frame.height, prompt, { maxTokens, temperature: 0.6 });
      setResult({ text: res.text, totalMs: performance.now() - t0 });
      // Success - reset crash count and save frame
      crashCountRef.current = 0;
      lastFrameRef.current = new Uint8Array(frame.rgbPixels);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds') || msg.includes('RuntimeError') || msg.includes('unreachable');

      if (isWasmCrash) {
        crashCountRef.current++;
        console.error(`[VisionTab] WASM crash #${crashCountRef.current}:`, msg);

        if (crashCountRef.current >= MAX_CONSECUTIVE_CRASHES) {
          setError(`VLM crashed ${MAX_CONSECUTIVE_CRASHES} times. Disabling live mode.`);
          stopLive();
        } else {
          // Attempt recovery
          recoverVLM();
        }
      } else {
        setError(msg);
        stopLive();
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [loader, prompt, recovering, isFrameDifferent, recoverVLM, stopLive]);

  const describeSingle = useCallback(async () => {
    if (!captureRef.current?.isCapturing) { await startCamera(); return; }
    await describeFrame(SINGLE_MAX_TOKENS);
  }, [startCamera, describeFrame]);

  const startLive = useCallback(async () => {
    if (!captureRef.current?.isCapturing) await startCamera();
    setLiveMode(true); liveModeRef.current = true;
    describeFrame(LIVE_MAX_TOKENS);
    liveIntervalRef.current = setInterval(() => {
      if (!processingRef.current && liveModeRef.current) describeFrame(LIVE_MAX_TOKENS);
    }, LIVE_INTERVAL_MS);
  }, [startCamera, describeFrame]);

  const toggleLive = useCallback(() => { if (liveMode) stopLive(); else startLive(); }, [liveMode, startLive, stopLive]);

  // ── Diagnostics ──
  const runDiagnostics = useCallback(async () => {
    setDiagRunning(true);
    const results: DiagResult[] = [];
    const update = (r: DiagResult[]) => setDiagResults([...r]);

    // 1. Check camera access
    results.push({ label: 'Camera Access', status: 'checking' });
    update(results);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      results[results.length - 1] = { label: 'Camera Access', status: 'pass', detail: 'Permission granted' };
    } catch (err) {
      results[results.length - 1] = { label: 'Camera Access', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }
    update(results);

    // 2. Check VLM model status
    results.push({ label: 'VLM Model', status: 'checking' });
    update(results);
    const vlmModels = ModelManager.getModels().filter(m => m.modality === ModelCategory.Multimodal);
    if (vlmModels.length === 0) {
      results[results.length - 1] = { label: 'VLM Model', status: 'fail', detail: 'No VLM model registered' };
    } else {
      const model = vlmModels[0];
      if (model.status === 'loaded') {
        results[results.length - 1] = { label: 'VLM Model', status: 'pass', detail: `${model.name} — loaded` };
      } else {
        results[results.length - 1] = { label: 'VLM Model', status: 'fail', detail: `${model.name} — ${model.status}` };
      }
    }
    update(results);

    // 3. Check VLM Worker Bridge
    results.push({ label: 'VLM Worker Bridge', status: 'checking' });
    update(results);
    try {
      const bridge = VLMWorkerBridge.shared;
      if (bridge.isModelLoaded) {
        results[results.length - 1] = { label: 'VLM Worker Bridge', status: 'pass', detail: 'Initialized and model loaded' };
      } else if (bridge.isInitialized) {
        results[results.length - 1] = { label: 'VLM Worker Bridge', status: 'fail', detail: 'Initialized but no model loaded' };
      } else {
        results[results.length - 1] = { label: 'VLM Worker Bridge', status: 'fail', detail: 'Not initialized' };
      }
    } catch (err) {
      results[results.length - 1] = { label: 'VLM Worker Bridge', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
    }
    update(results);

    // 4. Check VideoCapture can be created
    results.push({ label: 'VideoCapture API', status: 'checking' });
    update(results);
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
      results[results.length - 1] = { label: 'VideoCapture API', status: 'pass', detail: 'getUserMedia available' };
    } else {
      results[results.length - 1] = { label: 'VideoCapture API', status: 'fail', detail: 'getUserMedia not available (HTTPS required)' };
    }
    update(results);

    // 5. Check SharedArrayBuffer (needed for WASM threading)
    results.push({ label: 'SharedArrayBuffer', status: 'checking' });
    update(results);
    if (typeof SharedArrayBuffer !== 'undefined') {
      results[results.length - 1] = { label: 'SharedArrayBuffer', status: 'pass', detail: 'Available (Cross-Origin Isolation OK)' };
    } else {
      results[results.length - 1] = { label: 'SharedArrayBuffer', status: 'fail', detail: 'Not available — check COOP/COEP headers' };
    }
    update(results);

    // 6. Quick inference test (if model is loaded)
    results.push({ label: 'VLM Inference Test', status: 'checking' });
    update(results);
    const bridge = VLMWorkerBridge.shared;
    if (bridge.isModelLoaded && captureRef.current?.isCapturing) {
      try {
        const frame = captureRef.current.captureFrame(128);
        if (frame) {
          const t0 = performance.now();
          const res = await bridge.process(frame.rgbPixels, frame.width, frame.height, 'What do you see?', { maxTokens: 10, temperature: 0.1 });
          const ms = performance.now() - t0;
          results[results.length - 1] = { label: 'VLM Inference Test', status: 'pass', detail: `"${res.text.slice(0, 40)}..." (${(ms / 1000).toFixed(1)}s)` };
        } else {
          results[results.length - 1] = { label: 'VLM Inference Test', status: 'skip', detail: 'No frame captured' };
        }
      } catch (err) {
        results[results.length - 1] = { label: 'VLM Inference Test', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
      }
    } else {
      results[results.length - 1] = { label: 'VLM Inference Test', status: 'skip', detail: bridge.isModelLoaded ? 'Camera not active' : 'Model not loaded' };
    }
    update(results);

    setDiagRunning(false);
  }, []);

  return (
    <div className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto custom-scrollbar h-full relative">
      <ModelBanner state={loader.state} progress={loader.progress} error={loader.error} onLoad={loader.ensure} label="Vision Engine (VLM)" />

      <div className="flex flex-col md:flex-row gap-6 h-full min-h-[500px]">
        {/* Camera */}
        <div className="w-full md:w-1/2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 font-mono" style={{ color: 'var(--text-muted)' }}>
              <span className="material-symbols-outlined text-sm">visibility</span> Optical Sensor
            </h3>
            {liveMode && (
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest glass-panel px-2 py-1" style={{ color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--ax-error)' }} /> Live Feed
              </span>
            )}
          </div>

          <div className="relative flex-1 glass-panel rounded-2xl overflow-hidden flex items-center justify-center min-h-[300px]">
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10" style={{ color: 'var(--text-muted)' }}>
                <span className="material-symbols-outlined text-6xl mb-4">videocam_off</span>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Sensor Offline</p>
                <p className="text-xs">Initialize camera to begin visual processing</p>
              </div>
            )}
            <div ref={videoMountRef} className="absolute inset-0 w-full h-full object-cover z-0" style={{ borderRadius: 0 }} />
            {processing && (
              <div className="absolute top-0 left-0 w-full h-1 z-20" style={{ background: 'var(--accent)', boxShadow: '0 0 15px var(--accent-glow)', animation: 'scan 2s ease-in-out infinite' }} />
            )}
          </div>

          {error && (
            <div className="glass-panel rounded-xl p-3 flex items-start gap-3" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
              <span className="material-symbols-outlined text-lg mt-0.5" style={{ color: 'var(--ax-error)' }}>error</span>
              <span className="text-xs leading-relaxed" style={{ color: 'var(--ax-error)' }}>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            {!cameraActive ? (
              <button className="flex-1 btn-primary py-3 rounded-xl text-xs font-bold tracking-widest uppercase flex items-center justify-center gap-2" onClick={startCamera}>
                <span className="material-symbols-outlined text-[18px]">power_settings_new</span> Initialize Sensor
              </button>
            ) : (
              <>
                <button
                  className="flex-1 btn-primary py-3 rounded-xl text-xs font-bold tracking-widest uppercase flex items-center justify-center gap-2"
                  onClick={describeSingle} disabled={processing || liveMode}
                >
                  <span className="material-symbols-outlined text-[18px]">{processing && !liveMode ? 'sync' : 'center_focus_strong'}</span>
                  {processing && !liveMode ? 'Analyzing...' : 'Snapshot Analysis'}
                </button>
                <button
                  className={`flex-1 py-3 rounded-xl text-xs font-bold tracking-widest uppercase flex items-center justify-center gap-2 glass-panel transition-all`}
                  style={liveMode ? { color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' } : { color: 'var(--text-secondary)' }}
                  onClick={toggleLive} disabled={processing && !liveMode}
                >
                  <span className="material-symbols-outlined text-[18px]">{liveMode ? 'stop_circle' : 'stream'}</span>
                  {liveMode ? 'Halt Live' : 'Continuous Mode'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Output */}
        <div className="w-full md:w-1/2 flex flex-col gap-4">
          <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 font-mono" style={{ color: 'var(--text-muted)' }}>
            <span className="material-symbols-outlined text-sm">settings_input_component</span> Process Parameters
          </h3>
          <div className="glass-panel-strong rounded-xl p-1">
            <input
              className="w-full bg-transparent border-none p-3 text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
              type="text" placeholder="Directive details (e.g. 'Identify text visible in this frame')"
              value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={liveMode}
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            {[
              { label: 'Describe', prompt: 'Describe what you see briefly.' },
              { label: 'Read Text', prompt: 'Read and output any text visible in the frame.' },
              { label: 'Layout', prompt: 'Analyze the layout and structure of the visible scene.' }
            ].map(p => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.prompt)}
                disabled={liveMode}
                className="text-[10px] uppercase tracking-wider font-bold px-3 py-1 rounded-full border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: prompt === p.prompt ? 'var(--accent)' : 'var(--text-muted)' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <h3 className="text-sm font-bold tracking-widest uppercase flex items-center gap-2 mt-4 font-mono" style={{ color: 'var(--text-muted)' }}>
            <span className="material-symbols-outlined text-sm">data_object</span> Engine Output
          </h3>

          <div className="flex-1 glass-panel-elevated rounded-2xl p-6 overflow-y-auto custom-scrollbar relative">
            {!result && !processing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center opacity-30 pointer-events-none p-6 text-center">
                <span className="material-symbols-outlined text-4xl mb-4" style={{ color: 'var(--accent)' }}>analytics</span>
                <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Awaiting optical data</p>
              </div>
            )}
            {result && (
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex-1 text-sm leading-loose whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{result.text}</div>
                {result.totalMs > 0 && (
                  <div className="mt-6 pt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest" style={{ borderTop: '1px solid var(--glass-border)', color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} /> Status: Complete
                    </span>
                    <span>Latency: {(result.totalMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Diagnostics button */}
          <button
            className="glass-panel px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all self-center"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => { setShowDiag(!showDiag); if (!showDiag && diagResults.length === 0) runDiagnostics(); }}
          >
            <span className="material-symbols-outlined text-sm align-middle mr-1">monitor_heart</span>
            {showDiag ? 'Hide' : 'Run'} Diagnostics
          </button>

          {showDiag && (
            <div className="glass-panel-elevated rounded-2xl p-5 space-y-2">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold tracking-widest uppercase font-mono" style={{ color: 'var(--accent)' }}>
                  Vision Pipeline Diagnostics
                </h4>
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
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: 'var(--text-primary)', minWidth: 140 }}>{r.label}</span>
                  <span className="text-[10px] font-mono truncate" style={{ color: r.status === 'pass' ? 'var(--success)' : r.status === 'fail' ? 'var(--ax-error)' : 'var(--text-muted)' }}>
                    {r.status === 'checking' ? 'Checking...' : r.detail || r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
