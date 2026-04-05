/**
 * useDualModelLoader.ts — Smart dual-model management hook
 * 
 * Manages both LLM models (350M Fast and 1.2B Standard) intelligently:
 * - Downloads both models with a single button click
 * - Automatically switches between them based on Potency mode
 * - Shows combined download progress
 * - Fast model downloads first for quicker initial access
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';
import { getModelIdForMode, type PotencyMode } from '../agent/modelRouter';

export type DualLoaderState = 'idle' | 'downloading' | 'loading' | 'ready' | 'error';

interface DualModelLoaderResult {
  state: DualLoaderState;
  progress: number; // Combined progress (0-1)
  error: string | null;
  ensureBoth: () => Promise<boolean>;
  ensureForMode: (mode: PotencyMode) => Promise<boolean>;
  loadedModels: string[]; // IDs of currently loaded models
  downloadedModels: string[]; // IDs of downloaded (cached) models
}

const FAST_MODEL_ID = 'lfm2-350m-q4_k_m';
const STANDARD_MODEL_ID = 'lfm2-1.2b-tool-q4_k_m';

/**
 * Hook to manage both LLM models (350M and 1.2B).
 * Downloads both intelligently and switches between them based on mode.
 */
export function useDualModelLoader(): DualModelLoaderResult {
  const [state, setState] = useState<DualLoaderState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadedModels, setLoadedModels] = useState<string[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const loadingRef = useRef(false);
  const progressMapRef = useRef<Record<string, number>>({});

  // Update loaded and downloaded models list
  const updateModelStatus = useCallback(() => {
    const loaded = ModelManager.getLoadedModel(ModelCategory.Language);
    setLoadedModels(loaded ? [loaded.id] : []);
    
    // Check which models are downloaded
    const allModels = ModelManager.getModels();
    const downloaded = allModels
      .filter(m => 
        (m.id === FAST_MODEL_ID || m.id === STANDARD_MODEL_ID) &&
        (m.status === 'downloaded' || m.status === 'loaded')
      )
      .map(m => m.id);
    setDownloadedModels(downloaded);
    
    // If both models are downloaded and one is loaded, we're ready
    if (downloaded.length === 2 && loaded) {
      setState('ready');
    } else if (downloaded.length > 0 && loaded) {
      setState('ready');
    }
  }, []);

  // Check initial state on mount
  useEffect(() => {
    updateModelStatus();
  }, [updateModelStatus]);

  // Download a single model with progress tracking
  const downloadModel = useCallback(async (modelId: string): Promise<boolean> => {
    const model = ModelManager.getModels().find(m => m.id === modelId);
    if (!model) {
      console.error(`[DualLoader] Model ${modelId} not found in catalog`);
      return false;
    }

    if (model.status === 'downloaded' || model.status === 'loaded') {
      console.log(`[DualLoader] Model ${modelId} already downloaded`);
      progressMapRef.current[modelId] = 1;
      return true; // Already downloaded
    }

    console.log(`[DualLoader] Starting download of ${modelId}...`);

    return new Promise((resolve) => {
      const unsub = EventBus.shared.on('model.downloadProgress', (evt) => {
        if (evt.modelId === modelId) {
          progressMapRef.current[modelId] = evt.progress ?? 0;
          
          // Calculate combined progress (both models weighted equally)
          const fastProgress = progressMapRef.current[FAST_MODEL_ID] ?? 0;
          const standardProgress = progressMapRef.current[STANDARD_MODEL_ID] ?? 0;
          const combined = (fastProgress + standardProgress) / 2;
          setProgress(combined);
          
          console.log(`[DualLoader] ${modelId} progress: ${(evt.progress ?? 0) * 100}%`);
        }
      });

      ModelManager.downloadModel(modelId)
        .then(() => {
          progressMapRef.current[modelId] = 1;
          console.log(`[DualLoader] ${modelId} download complete`);
          unsub();
          resolve(true);
        })
        .catch((err) => {
          console.error(`[DualLoader] Failed to download ${modelId}:`, err);
          unsub();
          resolve(false);
        });
    });
  }, []);

  // Download both models sequentially (fast first for quicker initial access)
  const ensureBoth = useCallback(async (): Promise<boolean> => {
    if (loadingRef.current) {
      console.log('[DualLoader] Already loading, skipping');
      return false;
    }
    
    loadingRef.current = true;
    setState('downloading');
    setError(null);
    setProgress(0);
    progressMapRef.current = {};

    try {
      console.log('[DualLoader] Starting dual model download...');
      
      // Download fast model first (smaller, gives quick access)
      console.log('[DualLoader] Downloading Fast model (350M)...');
      const fastOk = await downloadModel(FAST_MODEL_ID);
      if (!fastOk) {
        throw new Error('Failed to download Fast model (350M). Please check your internet connection.');
      }

      // Then download standard model (larger, for better quality)
      console.log('[DualLoader] Downloading Standard model (1.2B)...');
      const standardOk = await downloadModel(STANDARD_MODEL_ID);
      if (!standardOk) {
        throw new Error('Failed to download Standard model (1.2B). Please check your internet connection.');
      }

      console.log('[DualLoader] Both models downloaded successfully');

      // Load the fast model by default
      setState('loading');
      console.log('[DualLoader] Loading Fast model...');
      const loaded = await ModelManager.loadModel(FAST_MODEL_ID, { coexist: false });
      if (!loaded) {
        throw new Error('Failed to load Fast model after download');
      }

      console.log('[DualLoader] Fast model loaded successfully');
      setState('ready');
      setProgress(1);
      updateModelStatus();
      return true;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DualLoader] Error in ensureBoth:', err);
      setError(msg);
      setState('error');
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [downloadModel, updateModelStatus]);

  // Ensure the right model is loaded for a given mode
  const ensureForMode = useCallback(async (mode: PotencyMode): Promise<boolean> => {
    const requiredModelId = getModelIdForMode(mode);
    const loaded = ModelManager.getLoadedModel(ModelCategory.Language);

    console.log(`[DualLoader] ensureForMode(${mode}) - required: ${requiredModelId}, loaded: ${loaded?.id}`);

    // Already have the right model loaded
    if (loaded && loaded.id === requiredModelId) {
      console.log('[DualLoader] Correct model already loaded');
      setState('ready');
      return true;
    }

    if (loadingRef.current) {
      console.log('[DualLoader] Already loading, skipping');
      return false;
    }

    loadingRef.current = true;

    try {
      // Check if model is registered
      const model = ModelManager.getModels().find(m => m.id === requiredModelId);
      if (!model) {
        throw new Error(`Model ${requiredModelId} not registered in catalog`);
      }

      // Download if needed
      if (model.status !== 'downloaded' && model.status !== 'loaded') {
        console.log(`[DualLoader] Model ${requiredModelId} not downloaded, downloading...`);
        setState('downloading');
        const ok = await downloadModel(requiredModelId);
        if (!ok) {
          throw new Error(`Failed to download ${requiredModelId}`);
        }
      }

      // Load the model
      console.log(`[DualLoader] Loading ${requiredModelId}...`);
      setState('loading');
      const ok = await ModelManager.loadModel(requiredModelId, { coexist: false });
      if (!ok) {
        throw new Error(`Failed to load ${requiredModelId}`);
      }

      console.log(`[DualLoader] ${requiredModelId} loaded successfully`);
      setState('ready');
      updateModelStatus();
      return true;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DualLoader] Error in ensureForMode:', err);
      setError(msg);
      setState('error');
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [downloadModel, updateModelStatus]);

  return { 
    state, 
    progress, 
    error, 
    ensureBoth, 
    ensureForMode, 
    loadedModels,
    downloadedModels,
  };
}
