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
    <div className="bg-surface-container-high border border-outline-variant/20 rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
      {state === 'idle' && (
        <>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-outline-variant text-xl">download_for_offline</span>
            <span className="text-sm font-medium text-on-surface">No {label} model loaded.</span>
          </div>
          <button 
            className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors w-full md:w-auto" 
            onClick={onLoad}
          >
            Download & Load
          </button>
        </>
      )}
      {state === 'downloading' && (
        <div className="w-full flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs font-bold text-outline-variant uppercase tracking-widest">
             <span className="flex items-center gap-2">
               <span className="material-symbols-outlined text-sm animate-pulse">cloud_download</span>
               Downloading {label}...
             </span>
             <span>{(progress * 100).toFixed(0)}%</span>
          </div>
          <div className="w-full h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 rounded-full" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      {state === 'loading' && (
        <div className="flex items-center gap-3 text-sm font-medium text-on-surface">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
          Loading {label} into neural engine...
        </div>
      )}
      {state === 'error' && (
        <>
          <div className="flex items-center gap-3 text-error flex-1">
            <span className="material-symbols-outlined text-xl">error</span>
            <span className="text-sm font-medium text-error line-clamp-2" title={error || ''}>Error loading {label}: {error}</span>
          </div>
          <button 
            className="bg-error/10 hover:bg-error/20 text-error border border-error/30 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors w-full md:w-auto shrink-0" 
            onClick={onLoad}
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
