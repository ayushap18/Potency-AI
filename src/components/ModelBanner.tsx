import type { LoaderState } from '../hooks/useModelLoader';

interface Props {
  state: LoaderState;
  progress: number;
  error: string | null;
  onLoad: () => void;
  label: string;
}

export function ModelBanner({ state, progress, error, onLoad, label }: Props) {
  if (state === 'ready') return null;

  return (
    <div className="glass-panel-strong rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
      {state === 'idle' && (
        <>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-xl" style={{ color: 'var(--text-muted)' }}>download_for_offline</span>
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No {label} model loaded.</span>
          </div>
          <button
            className="btn-primary px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest w-full md:w-auto"
            onClick={onLoad}
          >
            Download & Load
          </button>
        </>
      )}
      {state === 'downloading' && (
        <div className="w-full flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm animate-pulse">cloud_download</span>
              Downloading {label}...
            </span>
            <span>{(progress * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--glass-bg-strong)' }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress * 100}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      )}
      {state === 'loading' && (
        <div className="flex items-center gap-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          Loading {label} into neural engine...
        </div>
      )}
      {state === 'error' && (
        <>
          <div className="flex items-center gap-3 flex-1" style={{ color: 'var(--ax-error)' }}>
            <span className="material-symbols-outlined text-xl">error</span>
            <span className="text-sm font-medium line-clamp-2" title={error || ''}>Error loading {label}: {error}</span>
          </div>
          <button
            className="glass-panel px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest w-full md:w-auto shrink-0"
            style={{ color: 'var(--ax-error)', borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)' }}
            onClick={onLoad}
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
