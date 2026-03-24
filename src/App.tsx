import { useState, useEffect } from 'react';
import { initSDK, getAccelerationMode } from './runanywhere';
import { AgentTab } from './components/AgentTab';
import { ChatTab } from './components/ChatTab';
import { VisionTab } from './components/VisionTab';
import { VoiceTab } from './components/VoiceTab';
import { ToolsTab } from './components/ToolsTab';

type Tab = 'home' | 'code' | 'notes' | 'voice' | 'vision' | 'learn';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'home',  icon: 'home', label: 'Home' },
  { id: 'code',  icon: 'developer_mode', label: 'Code Assistant' },
  { id: 'notes', icon: 'description', label: 'Notes' },
  { id: 'voice', icon: 'mic', label: 'Speech to Text' },
  { id: 'vision', icon: 'visibility', label: 'Vision' },
  { id: 'learn', icon: 'school', label: 'Learn' },
];

export function App() {
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');

  useEffect(() => {
    initSDK()
      .then(() => setSdkReady(true))
      .catch((err) => setSdkError(err instanceof Error ? err.message : String(err)));
  }, []);

  const accel = sdkReady ? getAccelerationMode() : null;

  if (sdkError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center text-on-surface">
        <div className="text-error text-6xl mb-4">⚠️</div>
        <h2 className="text-2xl font-bold mb-2">SDK Failed to Load</h2>
        <p className="font-mono text-error/80 mb-4">{sdkError}</p>
        <p className="text-on-surface-variant text-sm">Requires Chrome/Edge 96+ with WebAssembly and SharedArrayBuffer.</p>
      </div>
    );
  }

  if (!sdkReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center p-8 bg-surface text-on-surface">
        <div className="w-12 h-12 border-4 border-surface-container-high border-t-primary rounded-full animate-spin mb-6" />
        <h2 className="text-2xl font-bold mb-2">Loading Potency-AI…</h2>
        <p className="text-on-surface-variant text-sm">Initializing on-device alchemical engine — no data leaves your device</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-surface text-on-surface overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex fixed left-0 top-0 h-full flex-col p-4 z-40 w-[240px] bg-[#222831] dark:bg-[#0e141c]">
        <div className="mb-8 px-4">
          <h1 className="text-xl font-bold tracking-tighter text-primary">Potency-AI</h1>
          <p className="text-[10px] text-primary-container/80 uppercase tracking-widest mt-1">Productivity Suite</p>
        </div>
        <nav className="flex flex-col gap-1 flex-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                activeTab === t.id 
                  ? 'text-[#948979] bg-[#161c25] scale-[0.98]' 
                  : 'text-[#cec5bb] hover:text-[#d2c5b3] hover:bg-[#2f353e]/50'
              }`}
            >
              <span className="material-symbols-outlined" style={activeTab === t.id ? { fontVariationSettings: "'FILL' 1" } : {}}>{t.icon}</span>
              <span className="font-sans text-sm font-medium tracking-tight text-left">{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-auto px-4 py-4 flex items-center gap-3 bg-surface-container-low rounded-xl">
          <div className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center overflow-hidden">
            <span className="material-symbols-outlined text-primary text-sm">account_circle</span>
          </div>
          <div className="flex flex-col text-left">
            <span className="text-xs font-bold text-primary">Alchemist Alpha</span>
            <span className="text-[10px] text-on-surface-variant font-medium">100% Local</span>
          </div>
        </div>
      </aside>

      {/* ── Mobile TopBar ── */}
      <header className="md:hidden bg-surface-dim flex justify-between items-center px-6 py-4 w-full fixed top-0 z-50 shadow-md">
        <h1 className="text-primary font-black tracking-tighter text-xl uppercase">Potency-AI</h1>
        <div className="flex items-center gap-2">
           {accel && (
             <span className="text-[10px] px-2 py-1 bg-surface-container-high text-primary rounded-full uppercase tracking-wider font-bold">
               {accel === 'webgpu' ? 'WebGPU' : 'CPU'}
             </span>
           )}
        </div>
      </header>

      {/* ── Desktop TopBar ── */}
      <header className="hidden md:flex fixed top-0 right-0 left-[240px] h-16 items-center justify-between px-8 z-50 bg-[#0e141c]/80 backdrop-blur-xl shadow-xl shadow-black/20 font-sans">
        <div className="flex items-center gap-6 flex-1">
          <span className="text-lg font-bold text-primary tracking-tight">
            {TABS.find(t => t.id === activeTab)?.label || 'Potency-AI'}
          </span>
          <div className="relative w-full max-w-md group focus-within:ring-1 focus-within:ring-primary/40 rounded-full transition-all">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">search</span>
            <input 
              type="text" 
              className="w-full bg-surface-container-low border-none rounded-full pl-10 pr-4 py-1.5 text-sm text-on-surface focus:ring-0 transition-all outline-none placeholder:text-on-surface-variant/50" 
              placeholder="Search resources..." 
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="hover:bg-surface-variant rounded-full p-2 transition-all text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined">upload</span>
          </button>
          <button className="hover:bg-surface-variant rounded-full p-2 transition-all text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined">photo_camera</span>
          </button>
          <button className="hover:bg-surface-variant rounded-full p-2 transition-all text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </header>

      {/* ── Main Content Area ── */}
      <main className="flex-1 md:ml-[240px] flex flex-col min-h-screen relative pt-16 pb-20 md:pb-0 overflow-y-auto bg-surface custom-scrollbar">
        {/* Home View */}
        {activeTab === 'home' && (
          <div className="p-6 md:p-12 max-w-7xl w-full mx-auto animate-fade-in">
            <section className="mb-16 relative">
              <div className="flex flex-col md:flex-row items-center gap-12">
                <div className="flex-1 space-y-6">
                  <span className="label-md uppercase tracking-[0.3em] text-primary font-bold text-xs">A New Era of Productivity</span>
                  <h2 className="text-5xl lg:text-6xl font-extrabold tracking-tight text-on-surface">Welcome to Potency-AI</h2>
                  <p className="text-on-surface-variant text-lg max-w-xl leading-relaxed">
                    A curated suite of alchemical tools for the modern creator. Harness the power of local intelligent agents to transform your ideas into structural reality.
                  </p>
                  <div className="flex gap-4 pt-4">
                    <button 
                      onClick={() => setActiveTab('code')}
                      className="bg-gradient-to-br from-primary to-primary-container text-on-primary px-8 py-3 rounded-lg font-semibold text-sm transition-transform active:scale-95 shadow-xl shadow-primary/10"
                    >
                      Launch Studio
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Other Views mapped to existing Tabs */}
        <div style={{ display: activeTab === 'code' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%', position: 'relative' }}><AgentTab /></div>
        <div style={{ display: activeTab === 'notes' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%', position: 'relative' }}><ChatTab /></div>
        <div style={{ display: activeTab === 'voice' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%', position: 'relative' }}><VoiceTab /></div>
        <div style={{ display: activeTab === 'vision' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%', position: 'relative' }}><VisionTab /></div>
        
        {/* We map Learn tab to ToolsTab since there is no learning logic right now */}
        <div style={{ display: activeTab === 'learn' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: '100%', position: 'relative' }}><ToolsTab /></div>
      </main>

      {/* ── Mobile BottomBar ── */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 pb-6 pt-3 bg-surface-container-low shadow-[0_-8px_24px_rgba(0,0,0,0.3)] rounded-t-xl">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
              activeTab === t.id 
                ? 'text-primary bg-surface-variant scale-105' 
                : 'text-on-surface-variant opacity-60 hover:opacity-100'
            }`}
          >
            <span className="material-symbols-outlined text-2xl" style={activeTab === t.id ? { fontVariationSettings: "'FILL' 1" } : {}}>{t.icon}</span>
            <span className="font-sans text-[9px] font-bold tracking-tight uppercase mt-1">{t.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
