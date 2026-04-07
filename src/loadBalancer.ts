/**
 * Load Balancer — Memory Management, Process Management & Device-Adaptive Execution
 *
 * Profiles the device hardware and adapts model loading, inference concurrency,
 * and memory pressure handling to the laptop's actual capabilities.
 */

import { ModelManager, ModelCategory, EventBus } from '@runanywhere/web';

// ---------------------------------------------------------------------------
// Device Profiler — detect hardware capabilities
// ---------------------------------------------------------------------------

export interface DeviceProfile {
  /** Total device memory in bytes (estimated) */
  totalMemory: number;
  /** Number of logical CPU cores */
  cpuCores: number;
  /** Whether WebGPU is available */
  hasWebGPU: boolean;
  /** Device memory tier: 'low' (≤4GB), 'mid' (4-8GB), 'high' (>8GB) */
  tier: 'low' | 'mid' | 'high';
  /** Max concurrent inference tasks */
  maxConcurrent: number;
  /** Max total model memory budget in bytes */
  memoryBudget: number;
  /** Preferred model size class */
  preferSmallModels: boolean;
}

let _cachedProfile: DeviceProfile | null = null;

export async function profileDevice(): Promise<DeviceProfile> {
  if (_cachedProfile) return _cachedProfile;

  // Estimate memory from navigator.deviceMemory (Chrome) or fallback
  const navMem = (navigator as any).deviceMemory as number | undefined;
  const totalMemory = navMem ? navMem * 1024 * 1024 * 1024 : 4 * 1024 * 1024 * 1024; // default 4GB

  const cpuCores = navigator.hardwareConcurrency || 4;

  // Check WebGPU
  let hasWebGPU = false;
  try {
    if ('gpu' in navigator) {
      const adapter = await (navigator as any).gpu.requestAdapter();
      hasWebGPU = !!adapter;
    }
  } catch { /* no WebGPU */ }

  // Determine tier
  const memGB = totalMemory / (1024 * 1024 * 1024);
  const tier: DeviceProfile['tier'] =
    memGB <= 4 ? 'low' : memGB <= 8 ? 'mid' : 'high';

  // Set concurrency limits based on cores and tier
  const maxConcurrent = tier === 'low' ? 1 : tier === 'mid' ? 2 : 3;

  // Memory budget for models: use ~40% of estimated RAM on low, 50% mid, 60% high
  const budgetFraction = tier === 'low' ? 0.4 : tier === 'mid' ? 0.5 : 0.6;
  const memoryBudget = Math.floor(totalMemory * budgetFraction);

  const preferSmallModels = tier === 'low';

  _cachedProfile = { totalMemory, cpuCores, hasWebGPU, tier, maxConcurrent, memoryBudget, preferSmallModels };
  return _cachedProfile;
}

// ---------------------------------------------------------------------------
// Memory Pressure Monitor
// ---------------------------------------------------------------------------

type PressureLevel = 'nominal' | 'moderate' | 'critical';
type PressureListener = (level: PressureLevel) => void;

class MemoryMonitor {
  private _level: PressureLevel = 'nominal';
  private _listeners: PressureListener[] = [];
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _profile: DeviceProfile | null = null;

  async start(profile: DeviceProfile) {
    this._profile = profile;
    if (this._intervalId) return;

    // Poll memory pressure every 5 seconds
    this._intervalId = setInterval(() => this._check(), 5000);
    this._check();
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  get level() { return this._level; }

  onPressureChange(fn: PressureListener): () => void {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  private _check() {
    if (!this._profile) return;

    // Calculate current loaded model memory
    const models = ModelManager.getModels();
    let loadedMemory = 0;
    for (const m of models) {
      if (m.status === 'loaded') {
        loadedMemory += m.memoryRequirement ?? 0;
      }
    }

    // Also check JS heap if available
    const perf = (performance as any);
    let jsHeapUsed = 0;
    if (perf.memory) {
      jsHeapUsed = perf.memory.usedJSHeapSize ?? 0;
    }

    const totalUsed = loadedMemory + jsHeapUsed;
    const budget = this._profile.memoryBudget;

    let newLevel: PressureLevel;
    if (totalUsed > budget * 0.85) {
      newLevel = 'critical';
    } else if (totalUsed > budget * 0.65) {
      newLevel = 'moderate';
    } else {
      newLevel = 'nominal';
    }

    if (newLevel !== this._level) {
      this._level = newLevel;
      for (const fn of this._listeners) fn(newLevel);
    }
  }

  /** Get current memory stats */
  getStats(): { loadedMemory: number; jsHeap: number; budget: number; usagePercent: number } {
    const models = ModelManager.getModels();
    let loadedMemory = 0;
    for (const m of models) {
      if (m.status === 'loaded') loadedMemory += m.memoryRequirement ?? 0;
    }
    const perf = (performance as any);
    const jsHeap = perf.memory?.usedJSHeapSize ?? 0;
    const budget = this._profile?.memoryBudget ?? 1;
    const usagePercent = Math.round(((loadedMemory + jsHeap) / budget) * 100);
    return { loadedMemory, jsHeap, budget, usagePercent };
  }
}

// ---------------------------------------------------------------------------
// Task Queue — priority-based inference scheduling
// ---------------------------------------------------------------------------

type TaskPriority = 'high' | 'normal' | 'low';

interface QueuedTask<T = any> {
  id: string;
  priority: TaskPriority;
  category: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  enqueued: number;
}

class TaskQueue {
  private _queue: QueuedTask[] = [];
  private _running = 0;
  private _maxConcurrent = 2;
  private _taskCounter = 0;
  private _activeCategories = new Set<string>();

  setMaxConcurrent(n: number) { this._maxConcurrent = n; }
  get runningCount() { return this._running; }
  get queueLength() { return this._queue.length; }
  get activeCategories() { return new Set(this._activeCategories); }

  /** Enqueue an inference task. Returns a promise that resolves when the task completes. */
  enqueue<T>(category: string, execute: () => Promise<T>, priority: TaskPriority = 'normal'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = {
        id: `task_${++this._taskCounter}`,
        priority,
        category,
        execute,
        resolve,
        reject,
        enqueued: Date.now(),
      };

      // Insert by priority: high first, then normal, then low
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const insertIdx = this._queue.findIndex(t => priorityOrder[t.priority] > priorityOrder[priority]);
      if (insertIdx === -1) {
        this._queue.push(task);
      } else {
        this._queue.splice(insertIdx, 0, task);
      }

      this._drain();
    });
  }

  /** Cancel all queued (not running) tasks */
  clearQueue() {
    for (const task of this._queue) {
      task.reject(new Error('Task cancelled — queue cleared'));
    }
    this._queue = [];
  }

  private async _drain() {
    while (this._running < this._maxConcurrent && this._queue.length > 0) {
      const task = this._queue.shift()!;
      this._running++;
      this._activeCategories.add(task.category);

      task.execute()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this._running--;
          // Remove category if no other tasks of same category are running
          const stillRunning = this._queue.some(t => t.category === task.category);
          if (!stillRunning) this._activeCategories.delete(task.category);
          this._drain();
        });
    }
  }
}

// ---------------------------------------------------------------------------
// Model Lifecycle Manager — smart load/unload based on pressure & usage
// ---------------------------------------------------------------------------

interface ModelUsageEntry {
  modelId: string;
  category: ModelCategory;
  lastUsed: number;
  useCount: number;
  memoryRequirement: number;
}

class ModelLifecycle {
  private _usage: Map<string, ModelUsageEntry> = new Map();

  /** Track that a model was used */
  touch(modelId: string, category: ModelCategory, memReq: number) {
    const existing = this._usage.get(modelId);
    if (existing) {
      existing.lastUsed = Date.now();
      existing.useCount++;
    } else {
      this._usage.set(modelId, {
        modelId, category, lastUsed: Date.now(), useCount: 1, memoryRequirement: memReq,
      });
    }
  }

  /** Get the least recently used loaded model that isn't in the protected set */
  getLRUCandidate(protectedCategories: Set<ModelCategory>): ModelUsageEntry | null {
    const loadedModels = ModelManager.getModels().filter(m => m.status === 'loaded');
    let oldest: ModelUsageEntry | null = null;
    let oldestTime = Infinity;

    for (const m of loadedModels) {
      const cat = m.modality ?? ModelCategory.Language;
      if (protectedCategories.has(cat)) continue;

      const usage = this._usage.get(m.id);
      const lastUsed = usage?.lastUsed ?? 0;
      if (lastUsed < oldestTime) {
        oldestTime = lastUsed;
        oldest = {
          modelId: m.id,
          category: cat,
          lastUsed,
          useCount: usage?.useCount ?? 0,
          memoryRequirement: m.memoryRequirement ?? 0,
        };
      }
    }
    return oldest;
  }

  /** Auto-unload least recently used model to free memory */
  async freeMemory(protectedCategories: Set<ModelCategory>): Promise<boolean> {
    const candidate = this.getLRUCandidate(protectedCategories);
    if (!candidate) return false;

    try {
      await ModelManager.unloadModel(candidate.modelId);
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Load Balancer — the main orchestrator
// ---------------------------------------------------------------------------

export interface LoadBalancerStats {
  device: DeviceProfile;
  memory: { loadedMemory: number; jsHeap: number; budget: number; usagePercent: number };
  pressure: PressureLevel;
  queue: { running: number; queued: number; activeCategories: string[] };
}

class LoadBalancerImpl {
  private _profile: DeviceProfile | null = null;
  private _monitor = new MemoryMonitor();
  private _queue = new TaskQueue();
  private _lifecycle = new ModelLifecycle();
  private _initialized = false;
  private _listeners: Array<(stats: LoadBalancerStats) => void> = [];
  private _statsInterval: ReturnType<typeof setInterval> | null = null;

  /** Initialize the load balancer. Call once at app startup after SDK init. */
  async init(): Promise<DeviceProfile> {
    if (this._initialized && this._profile) return this._profile;

    const profile = await profileDevice();
    this._profile = profile;
    this._queue.setMaxConcurrent(profile.maxConcurrent);

    // Start memory monitoring
    await this._monitor.start(profile);

    // React to memory pressure
    this._monitor.onPressureChange((level) => {
      if (level === 'critical') {
        // Auto-unload LRU model that isn't actively being used
        const activeCategories = this._queue.activeCategories;
        const protectedCats = new Set<ModelCategory>();
        if (activeCategories.has('llm')) protectedCats.add(ModelCategory.Language);
        if (activeCategories.has('vlm')) protectedCats.add(ModelCategory.Multimodal);
        if (activeCategories.has('stt')) protectedCats.add(ModelCategory.SpeechRecognition);
        if (activeCategories.has('tts')) protectedCats.add(ModelCategory.SpeechSynthesis);

        this._lifecycle.freeMemory(protectedCats);
      }
      this._notifyListeners();
    });

    // Broadcast stats periodically
    this._statsInterval = setInterval(() => this._notifyListeners(), 3000);

    this._initialized = true;
    return profile;
  }

  get profile(): DeviceProfile | null { return this._profile; }
  get pressure(): PressureLevel { return this._monitor.level; }
  get isInitialized() { return this._initialized; }

  /** Get current stats snapshot */
  getStats(): LoadBalancerStats | null {
    if (!this._profile) return null;
    return {
      device: this._profile,
      memory: this._monitor.getStats(),
      pressure: this._monitor.level,
      queue: {
        running: this._queue.runningCount,
        queued: this._queue.queueLength,
        activeCategories: [...this._queue.activeCategories],
      },
    };
  }

  /** Subscribe to stats updates */
  onStats(fn: (stats: LoadBalancerStats) => void): () => void {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  /**
   * Schedule an inference task through the load balancer.
   * Manages concurrency, memory pressure, and model lifecycle.
   */
  async scheduleInference<T>(
    category: string,
    execute: () => Promise<T>,
    priority: TaskPriority = 'normal',
  ): Promise<T> {
    if (!this._initialized) await this.init();

    // If memory pressure is critical, try to free memory first
    if (this._monitor.level === 'critical') {
      const activeCategories = this._queue.activeCategories;
      const protectedCats = new Set<ModelCategory>();
      if (activeCategories.has('llm') || category === 'llm') protectedCats.add(ModelCategory.Language);
      if (activeCategories.has('vlm') || category === 'vlm') protectedCats.add(ModelCategory.Multimodal);
      await this._lifecycle.freeMemory(protectedCats);
    }

    return this._queue.enqueue(category, execute, priority);
  }

  /** Mark a model as recently used — helps LRU decisions */
  touchModel(modelId: string, category: ModelCategory, memReq: number) {
    this._lifecycle.touch(modelId, category, memReq);
  }

  /**
   * Smart model ensure — picks the best model for the device tier.
   * On low-tier devices, prefers smaller models.
   */
  getBestModelId(category: ModelCategory): string | null {
    const models = ModelManager.getModels().filter(m => m.modality === category);
    if (models.length === 0) return null;

    // Check if one is already loaded
    const loaded = models.find(m => m.status === 'loaded');
    if (loaded) return loaded.id;

    // On low-tier, prefer smallest model
    if (this._profile?.preferSmallModels) {
      const sorted = [...models].sort((a, b) => (a.memoryRequirement ?? 0) - (b.memoryRequirement ?? 0));
      return sorted[0].id;
    }

    // Otherwise prefer largest (most capable)
    const sorted = [...models].sort((a, b) => (b.memoryRequirement ?? 0) - (a.memoryRequirement ?? 0));
    return sorted[0].id;
  }

  /** Check if loading a model would exceed memory budget */
  canLoadModel(memoryRequirement: number): boolean {
    if (!this._profile) return true;
    const stats = this._monitor.getStats();
    return (stats.loadedMemory + memoryRequirement) < this._profile.memoryBudget;
  }

  /** Clear all queued tasks */
  clearQueue() { this._queue.clearQueue(); }

  /** Cleanup */
  destroy() {
    this._monitor.stop();
    this._queue.clearQueue();
    if (this._statsInterval) clearInterval(this._statsInterval);
    this._listeners = [];
  }

  private _notifyListeners() {
    const stats = this.getStats();
    if (!stats) return;
    for (const fn of this._listeners) fn(stats);
  }
}

// Singleton instance
export const LoadBalancer = new LoadBalancerImpl();
