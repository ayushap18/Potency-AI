import { useState, useEffect } from 'react';
import { initSDK, getAccelerationMode } from './runanywhere';
import { AgentTab } from './components/AgentTab';
import { ChatTab } from './components/ChatTab';
import { VisionTab } from './components/VisionTab';
import { VoiceTab } from './components/VoiceTab';
import { ToolsTab } from './components/ToolsTab';

type Tab = 'agent' | 'chat' | 'vision' | 'voice' | 'tools';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'agent',  icon: '🔬', label: 'Research' },
  { id: 'chat',   icon: '💬', label: 'Chat'     },
  { id: 'vision', icon: '📷', label: 'Vision'   },
  { id: 'voice',  icon: '🎙️', label: 'Voice'   },
  { id: 'tools',  icon: '🔧', label: 'Tools'    },
];

export function App() {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('agent');

  useEffect(() => {
    initSDK()
      .then(() => setSdkReady(true))
      .catch((err) => setSdkError(err instanceof Error ? err.message : String(err)));
  }, []);

  const accel = sdkReady ? getAccelerationMode() : null;

  if (sdkError) {
    return (
      <div className="app-loading">
        <div className="error-icon">⚠️</div>
        <h2>SDK Failed to Load</h2>
        <p className="error-text">{sdkError}</p>
        <p className="error-hint">Requires Chrome/Edge 96+ with WebAssembly and SharedArrayBuffer.</p>
      </div>
    );
  }

  if (!sdkReady) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <h2>Loading NexusAI…</h2>
        <p>Initializing on-device AI engine — no data leaves your device</p>
      </div>
    );
  }

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">⚡</span>
          <span className="brand-name">NexusAI</span>
          <span className="brand-tagline">100% Local</span>
        </div>
        <div className="header-status">
          {accel && (
            <span className={`accel-badge ${accel === 'webgpu' ? 'gpu' : 'cpu'}`}>
              {accel === 'webgpu' ? '⚡ WebGPU' : '🖥 CPU'}
            </span>
          )}
          <span className="local-indicator">
            <span className="live-dot" />
            Private
          </span>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main className="tab-content">
        <div style={{ display: activeTab === 'agent'  ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}><AgentTab /></div>
        <div style={{ display: activeTab === 'chat'   ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}><ChatTab /></div>
        <div style={{ display: activeTab === 'vision' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}><VisionTab /></div>
        <div style={{ display: activeTab === 'voice'  ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}><VoiceTab /></div>
        <div style={{ display: activeTab === 'tools'  ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}><ToolsTab /></div>
      </main>
    </div>
  );
}
