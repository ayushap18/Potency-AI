import { useState, useEffect, useCallback, useRef } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';

type ModelStatus = 'registered' | 'downloading' | 'downloaded' | 'loading' | 'loaded' | 'error';

interface ModelInfo {
  id: string;
  name: string;
  modality: ModelCategory;
  status: ModelStatus;
  memoryRequirement: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  [ModelCategory.Language]: 'LLM',
  [ModelCategory.Multimodal]: 'VLM',
  [ModelCategory.SpeechRecognition]: 'STT',
  [ModelCategory.SpeechSynthesis]: 'TTS',
  [ModelCategory.Audio]: 'VAD',
};

const CATEGORY_ICONS: Record<string, string> = {
  [ModelCategory.Language]: 'psychology',
  [ModelCategory.Multimodal]: 'visibility',
  [ModelCategory.SpeechRecognition]: 'mic',
  [ModelCategory.SpeechSynthesis]: 'volume_up',
  [ModelCategory.Audio]: 'graphic_eq',
};

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function ModelManagerPanel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ modelCount: number; totalSize: number; available: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshModels = useCallback(() => {
    const all = ModelManager.getModels();
    setModels(all.map(m => ({
      id: m.id,
      name: m.name,
      modality: m.modality ?? ModelCategory.Language,
      status: m.status as ModelStatus,
      memoryRequirement: m.memoryRequirement ?? 0,
    })));
  }, []);

  useEffect(() => {
    refreshModels();

    // Listen for model changes
    const unsub = ModelManager.onChange(refreshModels);

    // Listen for download progress
    const unsubProgress = EventBus.shared.on('model.downloadProgress', (evt) => {
      setDownloadProgress(prev => ({ ...prev, [evt.modelId]: evt.progress ?? 0 }));
    });

    // Refresh storage info
    ModelManager.getStorageInfo().then(setStorageInfo).catch(() => {});

    return () => { unsub(); unsubProgress(); };
  }, [refreshModels]);

  const handleDownload = useCallback(async (modelId: string) => {
    setError(null);
    setDownloadProgress(prev => ({ ...prev, [modelId]: 0 }));
    try {
      await ModelManager.downloadModel(modelId);
      refreshModels();
      ModelManager.getStorageInfo().then(setStorageInfo).catch(() => {});
    } catch (err) {
      setError(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshModels]);

  const handleLoad = useCallback(async (modelId: string) => {
    setError(null);
    setLoading(prev => ({ ...prev, [modelId]: true }));
    try {
      const ok = await ModelManager.loadModel(modelId, { coexist: true });
      if (!ok) setError(`Failed to load model ${modelId}`);
      refreshModels();
    } catch (err) {
      setError(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(prev => ({ ...prev, [modelId]: false }));
    }
  }, [refreshModels]);

  const handleUnload = useCallback(async (modelId: string) => {
    setError(null);
    try {
      await ModelManager.unloadModel(modelId);
      refreshModels();
    } catch (err) {
      setError(`Unload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshModels]);

  const handleDelete = useCallback(async (modelId: string) => {
    setError(null);
    try {
      await ModelManager.deleteModel(modelId);
      refreshModels();
      ModelManager.getStorageInfo().then(setStorageInfo).catch(() => {});
    } catch (err) {
      setError(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [refreshModels]);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const modelId = await ModelManager.importModel(file);
      refreshModels();
      ModelManager.getStorageInfo().then(setStorageInfo).catch(() => {});
      // Auto-load if it's a GGUF file
      if (file.name.endsWith('.gguf')) {
        await ModelManager.loadModel(modelId, { coexist: true });
        refreshModels();
      }
    } catch (err) {
      setError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [refreshModels]);

  // Group models by category
  const grouped = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    const cat = CATEGORY_LABELS[m.modality] || m.modality;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold tracking-widest uppercase font-mono flex items-center gap-2" style={{ color: 'var(--accent)' }}>
            <span className="material-symbols-outlined text-sm">model_training</span>
            Model Manager
          </h3>
          {storageInfo && (
            <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-muted)' }}>
              {storageInfo.modelCount} models · {formatBytes(storageInfo.totalSize)} used · {formatBytes(storageInfo.available)} available
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="glass-panel px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            {importing ? 'Importing...' : 'Import Local Model'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".gguf,.onnx,.tar.gz"
            onChange={handleImportFile}
          />
          <button
            className="glass-panel px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest flex items-center gap-1"
            style={{ color: 'var(--text-secondary)' }}
            onClick={refreshModels}
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="glass-panel rounded-xl p-3 flex items-start gap-3" style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)' }}>
          <span className="material-symbols-outlined text-sm mt-0.5" style={{ color: 'var(--ax-error)' }}>error</span>
          <span className="text-xs" style={{ color: 'var(--ax-error)' }}>{error}</span>
          <button className="ml-auto text-xs font-bold" style={{ color: 'var(--text-muted)' }} onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Model groups */}
      {Object.entries(grouped).map(([category, categoryModels]) => (
        <div key={category} className="glass-panel rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4 pb-3" style={{ borderBottom: '1px solid var(--glass-border)' }}>
            <span className="material-symbols-outlined text-sm" style={{ color: 'var(--accent)' }}>
              {CATEGORY_ICONS[categoryModels[0]?.modality] || 'memory'}
            </span>
            <h4 className="text-xs font-bold tracking-[0.15em] uppercase font-mono" style={{ color: 'var(--text-primary)' }}>
              {category} Models
            </h4>
            <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
              {categoryModels.filter(m => m.status === 'loaded').length}/{categoryModels.length} loaded
            </span>
          </div>

          <div className="space-y-3">
            {categoryModels.map(model => {
              const isDownloaded = model.status === 'downloaded' || model.status === 'loaded' || model.status === 'loading';
              const isLoaded = model.status === 'loaded';
              const isDownloading = model.status === 'downloading';
              const isLoading = loading[model.id];
              const progress = downloadProgress[model.id];

              return (
                <div key={model.id} className="glass-panel-strong rounded-xl p-4 transition-all">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                          background: isLoaded ? 'var(--success)' : isDownloaded ? 'var(--accent)' : 'var(--text-muted)',
                        }} />
                        <span className="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>{model.name}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 ml-4">
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{model.id}</span>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{formatBytes(model.memoryRequirement)}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
                          background: isLoaded ? 'rgba(52,211,153,0.1)' : 'var(--glass-bg)',
                          color: isLoaded ? 'var(--success)' : 'var(--text-muted)',
                        }}>
                          {isLoading ? 'loading…' : model.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-1 flex-shrink-0">
                      {!isDownloaded && !isDownloading && (
                        <button
                          className="glass-panel px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--accent)' }}
                          onClick={() => handleDownload(model.id)}
                        >
                          Download
                        </button>
                      )}
                      {isDownloaded && !isLoaded && (
                        <button
                          className="btn-primary px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                          onClick={() => handleLoad(model.id)}
                          disabled={isLoading}
                        >
                          {isLoading ? 'Loading…' : 'Load'}
                        </button>
                      )}
                      {isLoaded && (
                        <button
                          className="glass-panel px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.2)' }}
                          onClick={() => handleUnload(model.id)}
                        >
                          Unload
                        </button>
                      )}
                      {isDownloaded && !isLoaded && (
                        <button
                          className="glass-panel px-2 py-1.5 rounded-lg text-[10px]"
                          style={{ color: 'var(--text-muted)' }}
                          onClick={() => handleDelete(model.id)}
                          title="Delete model from storage"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Download progress bar */}
                  {isDownloading && progress !== undefined && (
                    <div className="mt-3 ml-4">
                      <div className="flex justify-between text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
                        <span>Downloading...</span>
                        <span>{(progress * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--glass-bg)' }}>
                        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress * 100}%`, background: 'var(--accent)' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {models.length === 0 && (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
          <span className="material-symbols-outlined text-4xl mb-4">inventory_2</span>
          <p className="text-sm">No models registered</p>
        </div>
      )}

      {/* Import help text */}
      <div className="glass-panel rounded-xl p-4 text-center">
        <p className="text-[10px] font-mono leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Supported formats: <strong>.gguf</strong> (LLM/VLM), <strong>.onnx</strong> (STT/TTS/VAD), <strong>.tar.gz</strong> (archives)
          <br />
          Models are stored in browser OPFS storage — no data leaves your device.
        </p>
      </div>
    </div>
  );
}
