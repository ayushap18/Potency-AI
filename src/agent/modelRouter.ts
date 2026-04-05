/**
 * modelRouter.ts — 3-Mode model selection and timeout/fallback logic
 *
 * Supports three modes:
 *   - Fast:     LFM2-350M — quick answers, low latency
 *   - Thinking: LFM2-1.2B-Tool — structured reasoning, tool calling
 *   - Pro:      LFM2-1.2B-Tool with multi-pass chain-of-thought
 *
 * Each mode has its own model config (temperature, max tokens, timeout).
 * If a mode's model isn't loaded, falls back to the next fastest available.
 * All calls enforce a 3-minute (180s) global timeout.
 */

import { ModelManager, ModelCategory } from '@runanywhere/web';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PotencyMode = 'fast' | 'thinking' | 'pro';

export interface ModelConfig {
  modelId: string;
  name: string;
  description: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  /** Pro mode uses multiple LLM passes for deeper analysis */
  multiPass: boolean;
  /** Number of reasoning passes for Pro mode */
  passes: number;
}

export interface ModeInfo {
  mode: PotencyMode;
  label: string;
  description: string;
  icon: string; // Material Symbols icon name
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOBAL_TIMEOUT_MS = 180_000; // 3 minutes hard limit

/** Model IDs matching the catalog in runanywhere.ts */
const MODEL_IDS = {
  FAST: 'lfm2-350m-q4_k_m',
  STANDARD: 'lfm2-1.2b-tool-q4_k_m',
} as const;

/** Mode metadata for UI display */
export const MODE_INFO: Record<PotencyMode, ModeInfo> = {
  fast: {
    mode: 'fast',
    label: 'Fast',
    description: 'Answers quickly',
    icon: 'bolt',
  },
  thinking: {
    mode: 'thinking',
    label: 'Thinking',
    description: 'Solves complex problems',
    icon: 'psychology',
  },
  pro: {
    mode: 'pro',
    label: 'Pro',
    description: 'Deep multi-pass research analysis',
    icon: 'neurology',
  },
};

/** Model configs per mode */
const MODE_CONFIGS: Record<PotencyMode, ModelConfig> = {
  fast: {
    modelId: MODEL_IDS.FAST,
    name: 'LFM2 350M',
    description: 'Lightweight, fast responses',
    temperature: 0.7,
    maxTokens: 512,
    timeoutMs: 60_000, // 1 minute
    multiPass: false,
    passes: 1,
  },
  thinking: {
    modelId: MODEL_IDS.STANDARD,
    name: 'LFM2 1.2B Tool',
    description: 'Structured reasoning with tool calling',
    temperature: 0.5,
    maxTokens: 1024,
    timeoutMs: 120_000, // 2 minutes
    multiPass: false,
    passes: 1,
  },
  pro: {
    modelId: MODEL_IDS.STANDARD,
    name: 'LFM2 1.2B Tool (Multi-Pass)',
    description: 'Chain-of-thought with deep analysis',
    temperature: 0.3,
    maxTokens: 2048,
    timeoutMs: GLOBAL_TIMEOUT_MS, // 3 minutes
    multiPass: true,
    passes: 3, // Initial analysis → Refinement → Final synthesis
  },
};

/** Fallback order: if requested mode's model unavailable, try these */
const FALLBACK_ORDER: PotencyMode[] = ['fast', 'thinking', 'pro'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the model config for a given mode.
 * Falls back to next-fastest mode if the model isn't loaded.
 */
export function getModelForMode(mode: PotencyMode): ModelConfig {
  const config = MODE_CONFIGS[mode];

  // Check if the model for this mode is loaded
  const loaded = ModelManager.getLoadedModel(ModelCategory.Language);
  if (loaded && loaded.id === config.modelId) {
    return config;
  }

  // Check if any model is loaded — use it with the mode's settings
  if (loaded) {
    // Use the loaded model but with the requested mode's params
    return { ...config, modelId: loaded.id, name: loaded.name };
  }

  // No model loaded — return the config anyway; caller will handle loading
  return config;
}

/**
 * Determine the best available mode based on what's currently loaded.
 * Useful when the user selects a mode but the model isn't ready.
 */
export function getBestAvailableMode(preferred: PotencyMode): PotencyMode {
  const loaded = ModelManager.getLoadedModel(ModelCategory.Language);
  if (!loaded) return preferred; // No model loaded, return preferred (caller will load it)

  // If the preferred mode's model is loaded, use it
  const config = MODE_CONFIGS[preferred];
  if (loaded.id === config.modelId) return preferred;

  // Find which mode matches the loaded model
  for (const fallback of FALLBACK_ORDER) {
    if (MODE_CONFIGS[fallback].modelId === loaded.id) {
      return fallback;
    }
  }

  return 'fast'; // Ultimate fallback
}

/**
 * Get the model ID that needs to be loaded for a given mode.
 */
export function getModelIdForMode(mode: PotencyMode): string {
  return MODE_CONFIGS[mode].modelId;
}

/**
 * Check if the model for a given mode is currently loaded.
 */
export function isModelLoadedForMode(mode: PotencyMode): boolean {
  const loaded = ModelManager.getLoadedModel(ModelCategory.Language);
  return !!loaded && loaded.id === MODE_CONFIGS[mode].modelId;
}

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if exceeded.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'Operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${(timeoutMs / 1000).toFixed(0)}s`));
    }, timeoutMs);

    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Execute an LLM operation with automatic fallback on timeout.
 * If the operation exceeds the mode's timeout, retries with Fast mode.
 */
export async function withFallback<T>(
  mode: PotencyMode,
  operation: (config: ModelConfig) => Promise<T>,
  onFallback?: (fromMode: PotencyMode, toMode: PotencyMode) => void,
): Promise<T> {
  const config = getModelForMode(mode);

  try {
    return await withTimeout(
      operation(config),
      config.timeoutMs,
      `${config.name} (${mode})`,
    );
  } catch (err) {
    if (err instanceof TimeoutError && mode !== 'fast') {
      // Fallback to fast mode
      const fastConfig = getModelForMode('fast');
      onFallback?.(mode, 'fast');

      return await withTimeout(
        operation(fastConfig),
        fastConfig.timeoutMs,
        `${fastConfig.name} (fast fallback)`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Usage Tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  llmCalls: number;
  totalTimeMs: number;
}

export class UsageTracker {
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _llmCalls = 0;
  private _startTime = performance.now();

  track(input: number, output: number): void {
    this._inputTokens += input;
    this._outputTokens += output;
    this._llmCalls += 1;
  }

  get usage(): TokenUsage {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      llmCalls: this._llmCalls,
      totalTimeMs: performance.now() - this._startTime,
    };
  }

  reset(): void {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._llmCalls = 0;
    this._startTime = performance.now();
  }
}
