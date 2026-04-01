/**
 * App.tsx — Potency AI Glassmorphism Shell
 *
 * Sidebar nav + top header + main content area + CursorGrid background.
 * All original SDK init logic and component logic preserved.
 */

import { useState, useEffect, useCallback } from 'react';
import { initSDK, getAccelerationMode } from './runanywhere';
import { AgentTab }  from './components/AgentTab';
import { ChatTab }   from './components/ChatTab';
import { VoiceTab }  from './components/VoiceTab';
import { VisionTab } from './components/VisionTab';
import { ToolsTab }  from './components/ToolsTab';
import { CursorGrid } from './components/CursorGrid';
import { useTheme, ACCENT_COLORS, type AccentColor, type ThemeMode, type BackgroundStyle } from './context/ThemeContext';

// ── Types ──
type ToolView = 'agent' | 'chat' | 'voice' | 'vision' | 'tools';

const NAV_ITEMS: { id: ToolView; icon: string; label: string }[] = [
  { id: 'agent',  icon: '🔬', label: 'Research'       },
  { id: 'chat',   icon: '💬', label: 'Notes / Chat'   },
  { id: 'voice',  icon: '🎙️', label: 'Speech to Text' },
  { id: 'vision', icon: '📷', label: 'Vision'          },
  { id: 'tools',  icon: '🔧', label: 'Tools'           },
];

// ── SVG Icon helpers ──
function BrainIcon() {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );
}

// ── Agent Brain Sidebar ──
const AGENT_CARDS = [
  { key: 'classifier', label: 'CLASS', title: 'Classifier Agent' },
  { key: 'planner',    label: 'PLAN',  title: 'Planner Agent'    },
  { key: 'retriever',  label: 'FETCH', title: 'Retriever Agent'  },
  { key: 'analyst',    label: 'ANAL',  title: 'Analyst Agent'    },
  { key: 'writer',     label: 'WRITE', title: 'Writer Agent'     },
];

type AgentStatus = 'idle' | 'running' | 'done' | 'error';

interface BrainSidebarProps {
  open: boolean;
  agentStatus: Record<string, AgentStatus>;
  brainLog: string[];
  onToggle: () => void;
  activeView: ToolView;
  onViewChange: (v: ToolView) => void;
}

function BrainSidebar({ open, agentStatus, brainLog, activeView, onViewChange }: BrainSidebarProps) {
  const anyActive = Object.values(agentStatus).some(s => s === 'running' || s === 'done');

  return (
    <aside
      id="brain-panel"
      className={`brain-sidebar flex-col flex-shrink-0 ${open ? 'lg:flex' : 'hidden'}`}
      style={{ width: 260, height: 'calc(100vh - 57px)', position: 'sticky', top: 57 }}
    >
      {/* Agent Brain Header */}
      <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        <div className="flex items-center gap-2">
          <div
            id="brain-pulse"
            className={`w-2 h-2 rounded-full transition-colors ${anyActive ? 'active' : ''}`}
            style={{ background: anyActive ? 'var(--success)' : 'var(--text-muted)' }}
          />
          <span className="text-xs font-semibold tracking-widest font-mono" style={{ color: 'var(--text-muted)' }}>AGENT BRAIN</span>
        </div>
        <button
          onClick={() => { /* clear log */ }}
          className="text-[10px] font-mono transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          CLEAR
        </button>
      </div>

      {/* Agent status cards */}
      <div className="p-3 grid grid-cols-5 gap-1" style={{ borderBottom: '1px solid var(--glass-border)' }}>
        {AGENT_CARDS.map((a) => (
          <div
            key={a.key}
            className={`agent-card ${agentStatus[a.key] ?? 'idle'}`}
            title={a.title}
          >
            <div className="agent-icon">{a.label.charAt(0)}</div>
            <div className="agent-label">{a.label}</div>
          </div>
        ))}
      </div>

      {/* Brain feed */}
      <div id="brain-feed" className="flex-1 overflow-y-auto p-3 space-y-1" style={{ fontSize: 11 }}>
        {brainLog.length === 0 ? (
          <div className="text-center py-6" style={{ color: 'var(--text-muted)' }}>// waiting for query...</div>
        ) : (
          brainLog.map((entry, i) => (
            <div key={i} className="brain-entry system px-1">{entry}</div>
          ))
        )}
      </div>

      {/* Watched Pages */}
      <div className="flex-shrink-0 mx-3 mb-3 p-3 rounded-lg glass-panel">
        <h4 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>Watched Pages</h4>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>No pages being watched</p>
      </div>
    </aside>
  );
}

// ── Settings Panel ──
function SettingsPanel({ open, onClose, accel }: { open: boolean; onClose: () => void; accel: string | null }) {
  const { mode, setMode, accentColor, setAccentColor, backgroundStyle, setBackgroundStyle } = useTheme();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />}
      <div
        className={`side-panel fixed inset-y-0 right-0 z-50 overflow-y-auto transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 360 }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold font-mono tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>SETTINGS</h2>
            <button onClick={onClose} className="icon-btn"><CloseIcon /></button>
          </div>

          <div className="space-y-6">
            {/* ── Appearance ── */}
            <div className="glass-panel p-4">
              <h3 className="text-xs font-mono font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--accent)' }}>Appearance</h3>

              {/* Theme Mode */}
              <label className="settings-label">Theme</label>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setMode('light' as ThemeMode)}
                  className={`theme-toggle-btn flex-1 ${mode === 'light' ? 'active' : ''}`}
                >
                  <SunIcon /> Light
                </button>
                <button
                  onClick={() => setMode('dark' as ThemeMode)}
                  className={`theme-toggle-btn flex-1 ${mode === 'dark' ? 'active' : ''}`}
                >
                  <MoonIcon /> Dark
                </button>
              </div>

              {/* Accent Color */}
              <label className="settings-label">Accent Color</label>
              <div className="flex gap-2 mb-4">
                {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setAccentColor(c)}
                    className={`color-swatch ${accentColor === c ? 'active' : ''}`}
                    style={{ backgroundColor: ACCENT_COLORS[c].hex }}
                    title={ACCENT_COLORS[c].label}
                  />
                ))}
              </div>

              {/* Background */}
              <label className="settings-label">Background</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBackgroundStyle('grid' as BackgroundStyle)}
                  className={`theme-toggle-btn flex-1 ${backgroundStyle === 'grid' ? 'active' : ''}`}
                >
                  Grid
                </button>
                <button
                  onClick={() => setBackgroundStyle('none' as BackgroundStyle)}
                  className={`theme-toggle-btn flex-1 ${backgroundStyle === 'none' ? 'active' : ''}`}
                >
                  None
                </button>
              </div>
            </div>

            {/* ── System Info ── */}
            <div>
              <label className="settings-label">Acceleration</label>
              <div className="settings-value">{accel ?? 'Detecting...'}</div>
            </div>
            <div>
              <label className="settings-label">Runtime</label>
              <div className="settings-value font-mono text-[11px]">100% Local · WASM · No API Key</div>
            </div>
            <div>
              <label className="settings-label">Semantic Reranker</label>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>BAAI/bge-small-en-v1.5</span>
              </div>
              <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>local · cosine similarity reranking</p>
            </div>
            <div>
              <label className="settings-label">Research Modes</label>
              <div className="space-y-1 mt-1 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                <div><span style={{ color: 'var(--accent)' }}>AUTO</span> — agent decides depth</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>QUICK</span> — fast / fewer sources</div>
                <div><span style={{ color: 'var(--text-muted)' }}>DEEP</span> — thorough / more sources</div>
              </div>
            </div>
            <div>
              <label className="settings-label">Privacy</label>
              <div className="settings-value text-[11px]" style={{ color: 'var(--success)' }}>No data leaves your device</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── History Panel ──
function HistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />}
      <div
        className={`side-panel fixed inset-y-0 right-0 z-50 overflow-y-auto transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 360 }}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-semibold font-mono tracking-wider text-sm" style={{ color: 'var(--text-primary)' }}>HISTORY</h2>
            <button onClick={onClose} className="icon-btn"><CloseIcon /></button>
          </div>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>// no history yet</p>
        </div>
      </div>
    </>
  );
}

// ── Main App ──
export function App() {
  const { mode, toggleMode } = useTheme();
  const [sdkReady,  setSdkReady]  = useState(false);
  const [sdkError,  setSdkError]  = useState<string | null>(null);
  const [accel,     setAccel]     = useState<string | null>(null);

  // Shell UI state
  const [brainOpen,    setBrainOpen]    = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen,  setHistoryOpen]  = useState(false);
  const [activeView,   setActiveView]   = useState<ToolView>('agent');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Brain sidebar data
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentStatus>>({
    classifier: 'idle', planner: 'idle', retriever: 'idle', analyst: 'idle', writer: 'idle',
  });
  const [brainLog, setBrainLog] = useState<string[]>([]);

  // Connectivity
  const [connectivity, setConnectivity] = useState<'checking' | 'good' | 'poor'>('checking');

  // ── SDK init ──
  useEffect(() => {
    initSDK()
      .then(() => {
        setSdkReady(true);
        setAccel(getAccelerationMode());
      })
      .catch((err: unknown) =>
        setSdkError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  // ── Connectivity check ──
  useEffect(() => {
    const check = async () => {
      try {
        const start = Date.now();
        await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' });
        setConnectivity(Date.now() - start < 1500 ? 'good' : 'poor');
      } catch {
        setConnectivity('poor');
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Brain log helpers ──
  const pushBrainLog = useCallback((msg: string) => {
    setBrainLog(prev => [...prev.slice(-80), msg]);
  }, []);

  const updateAgentStatus = useCallback((agent: string, status: AgentStatus) => {
    setAgentStatus(prev => ({ ...prev, [agent]: status }));
    if (status === 'running') pushBrainLog(`[${agent.toUpperCase()}] starting…`);
    if (status === 'done')    pushBrainLog(`[${agent.toUpperCase()}] complete ✓`);
  }, [pushBrainLog]);

  // Connectivity dot
  const connDot = connectivity === 'good'
    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
    : connectivity === 'poor'
    ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
    : '';
  const connLabel = connectivity === 'good' ? 'online' : connectivity === 'poor' ? 'poor' : 'checking…';

  // ── Loading / error screens ──
  if (sdkError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <CursorGrid />
        <div className="text-6xl mb-4 relative z-10">⚠️</div>
        <h2 className="text-2xl font-bold mb-2 relative z-10">SDK Failed to Load</h2>
        <p className="font-mono relative z-10" style={{ color: 'var(--ax-error)' }}>{sdkError}</p>
        <p className="text-sm relative z-10 mt-4" style={{ color: 'var(--text-muted)' }}>Requires Chrome/Edge 96+ with WebAssembly and SharedArrayBuffer.</p>
      </div>
    );
  }

  if (!sdkReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center p-8" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <CursorGrid />
        <div
          className="w-12 h-12 border-4 rounded-full mb-6 relative z-10"
          style={{ borderColor: 'var(--glass-border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}
        />
        <h2 className="text-2xl font-bold mb-2 relative z-10">Loading Potency AI…</h2>
        <p className="text-sm relative z-10" style={{ color: 'var(--text-muted)' }}>Initializing on-device neural engine — no data leaves your device</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen antialiased overflow-x-hidden flex flex-col" style={{ color: 'var(--text-primary)' }}>
      {/* ── Background ── */}
      <CursorGrid />

      {/* ══════════════ HEADER ══════════════ */}
      <header
        className="sticky top-0 z-50 flex-shrink-0"
        style={{
          background: 'var(--header-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid var(--glass-border)',
        }}
      >
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          {/* Logo + Title */}
          <div className="flex items-center gap-3">
            {/* Mobile sidebar toggle */}
            <button
              className="lg:hidden header-btn mr-1"
              onClick={() => setSidebarCollapsed(c => !c)}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div
              className="w-9 h-9 rounded-xl ax-logo flex items-center justify-center font-bold text-sm tracking-wide"
            >
              PA
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Potency AI</h1>
              <p className="text-[10px] -mt-0.5 font-mono tracking-widest" style={{ color: 'var(--text-muted)' }}>DEEP RESEARCH AGENT</p>
            </div>
          </div>

          {/* Status badges + icon buttons */}
          <div className="flex items-center gap-2">
            {/* Connectivity badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel" style={{ borderRadius: '9999px' }}>
              <span className={`w-2 h-2 rounded-full ${connDot}`} style={{ background: connectivity === 'checking' ? 'var(--text-muted)' : undefined }} />
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{connLabel}</span>
            </div>

            {/* Acceleration badge */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-panel" style={{ borderRadius: '9999px' }}>
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: 'var(--success)' }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: 'var(--success)' }} />
              </span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>
                {accel ? `Local (${accel})` : 'Local'}
              </span>
            </div>

            {/* Theme toggle */}
            <button onClick={toggleMode} className="header-btn" title="Toggle theme">
              {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Brain toggle */}
            <button
              onClick={() => setBrainOpen(o => !o)}
              className={`header-btn ${brainOpen ? 'active' : ''}`}
              title="Agent Brain"
            >
              <BrainIcon />
            </button>

            {/* Settings */}
            <button
              onClick={() => { setSettingsOpen(o => !o); setHistoryOpen(false); }}
              className="header-btn"
              title="Settings"
            >
              <SettingsIcon />
            </button>

            {/* History */}
            <button
              onClick={() => { setHistoryOpen(o => !o); setSettingsOpen(false); }}
              className="header-btn"
              title="History"
            >
              <HistoryIcon />
            </button>
          </div>
        </div>
      </header>

      {/* ══════════════ MAIN LAYOUT ══════════════ */}
      <div className="relative z-10 flex flex-1" style={{ minHeight: 'calc(100vh - 57px)' }}>

        {/* ── Left Sidebar Nav ── */}
        <aside
          className={`flex-shrink-0 flex-col hidden lg:flex ${sidebarCollapsed ? 'lg:hidden' : ''}`}
          style={{
            width: 220,
            height: 'calc(100vh - 57px)',
            position: 'sticky',
            top: 57,
            background: 'var(--sidebar-bg)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRight: '1px solid var(--glass-border)',
          }}
        >
          <div className="p-4 flex-1">
            <div className="space-y-1 mt-2">
              {NAV_ITEMS.map(nav => (
                <button
                  key={nav.id}
                  onClick={() => setActiveView(nav.id)}
                  className={`sidebar-nav-item ${activeView === nav.id ? 'active' : ''}`}
                >
                  <span className="text-lg">{nav.icon}</span>
                  <span>{nav.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Bottom actions */}
          <div className="p-4" style={{ borderTop: '1px solid var(--glass-border)' }}>
            <button
              onClick={() => { setSettingsOpen(true); setHistoryOpen(false); }}
              className="sidebar-nav-item"
            >
              <SettingsIcon />
              <span>Settings</span>
            </button>
          </div>
        </aside>

        {/* ── Mobile sidebar overlay ── */}
        {sidebarCollapsed && (
          <>
            <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30 lg:hidden" onClick={() => setSidebarCollapsed(false)} />
            <aside
              className="fixed inset-y-0 left-0 z-40 flex flex-col lg:hidden"
              style={{
                width: 260,
                top: 57,
                background: 'var(--sidebar-bg)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderRight: '1px solid var(--glass-border)',
              }}
            >
              <div className="p-4 flex-1">
                <div className="space-y-1 mt-2">
                  {NAV_ITEMS.map(nav => (
                    <button
                      key={nav.id}
                      onClick={() => { setActiveView(nav.id); setSidebarCollapsed(false); }}
                      className={`sidebar-nav-item ${activeView === nav.id ? 'active' : ''}`}
                    >
                      <span className="text-lg">{nav.icon}</span>
                      <span>{nav.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </>
        )}

        {/* ── Agent Brain Sidebar ── */}
        <BrainSidebar
          open={brainOpen}
          agentStatus={agentStatus}
          brainLog={brainLog}
          onToggle={() => setBrainOpen(o => !o)}
          activeView={activeView}
          onViewChange={(v) => setActiveView(v)}
        />

        {/* ── Main Content ── */}
        <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
          <div style={{ display: activeView === 'agent' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%' }}>
            <AgentTab onBrainLog={pushBrainLog} onAgentStatus={updateAgentStatus} />
          </div>
          <div style={{ display: activeView === 'chat'   ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%' }}><ChatTab /></div>
          <div style={{ display: activeView === 'voice'  ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%' }}><VoiceTab /></div>
          <div style={{ display: activeView === 'vision' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%' }}><VisionTab /></div>
          <div style={{ display: activeView === 'tools'  ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%' }}><ToolsTab /></div>
        </main>
      </div>

      {/* ══════════════ SIDE PANELS ══════════════ */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} accel={accel} />
      <HistoryPanel  open={historyOpen}  onClose={() => setHistoryOpen(false)} />
    </div>
  );
}