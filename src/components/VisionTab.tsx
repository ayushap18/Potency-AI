import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory, VideoCapture } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

const LIVE_INTERVAL_MS = 2500;
const LIVE_MAX_TOKENS = 30;
const SINGLE_MAX_TOKENS = 80;
const CAPTURE_DIM = 256;

interface VisionResult { text: string; totalMs: number; }

export function VisionTab() {
  const loader = useModelLoader(ModelCategory.Multimodal);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Describe what you see briefly.');

  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveModeRef = useRef(false);

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

  const describeFrame = useCallback(async (maxTokens: number) => {
    if (processingRef.current) return;
    const cam = captureRef.current;
    if (!cam?.isCapturing) return;
    if (loader.state !== 'ready') { const ok = await loader.ensure(); if (!ok) return; }
    const frame = cam.captureFrame(CAPTURE_DIM);
    if (!frame) return;
    setProcessing(true); processingRef.current = true; setError(null);
    const t0 = performance.now();
    try {
      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) throw new Error('VLM model not loaded in worker');
      const res = await bridge.process(frame.rgbPixels, frame.width, frame.height, prompt, { maxTokens, temperature: 0.6 });
      setResult({ text: res.text, totalMs: performance.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds') || msg.includes('RuntimeError');
      if (isWasmCrash) setResult({ text: 'Recovering from memory error... next frame will retry.', totalMs: 0 });
      else { setError(msg); if (liveModeRef.current) stopLive(); }
    } finally { setProcessing(false); processingRef.current = false; }
  }, [loader, prompt]);

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

  const stopLive = useCallback(() => {
    setLiveMode(false); liveModeRef.current = false;
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
  }, []);

  const toggleLive = useCallback(() => { if (liveMode) stopLive(); else startLive(); }, [liveMode, startLive, stopLive]);

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
        </div>
      </div>
    </div>
  );
}
