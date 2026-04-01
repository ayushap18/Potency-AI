<p align="center">
  <img src="public/logo.svg" alt="Potency AI" width="220" />
</p>

<h1 align="center">Potency AI</h1>

<p align="center">
  <strong>Zero-server intelligence. Runs entirely in your browser.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-100%25_Local-ff4500?style=flat-square" />
  <img src="https://img.shields.io/badge/API_keys-none_required-34d399?style=flat-square" />
  <img src="https://img.shields.io/badge/engine-WebAssembly_+_WebGPU-6366f1?style=flat-square" />
  <img src="https://img.shields.io/badge/privacy-your_data_stays_yours-0ea5e9?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-e5e7eb?style=flat-square" />
</p>

---

Potency AI is a full-featured AI workstation that runs **entirely inside your web browser**. No servers. No API keys. No cloud. Every model — language, vision, speech — executes on-device through WebAssembly and WebGPU. Your data never leaves your machine.

Built on the [RunAnywhere SDK](https://docs.runanywhere.ai), it ships a glassmorphic interface with five integrated tools, a live agent brain debugger, and a complete model management system.

---

## What Makes It Different

| | Cloud AI Tools | Potency AI |
|---|---|---|
| **Data Privacy** | Sent to remote servers | Never leaves your device |
| **API Keys** | Required, often paid | None needed — ever |
| **Internet** | Required for every request | Only for initial model download |
| **Latency** | Network round-trip | Instant local inference |
| **Cost** | Per-token billing | Free forever |
| **Offline** | Broken | Fully functional |

---

## Integrated Tools

### 1. Deep Research Agent

A multi-stage autonomous research pipeline:

- **Intent Classification** — Understands query type (comparison, explanation, evaluation)
- **Research Planning** — Breaks the question into sub-tasks with search strategies
- **Source Retrieval** — Fetches real-time data from Wikipedia (CORS-free REST API)
- **Architecture Analysis** — Extracts patterns, tradeoffs, and key insights
- **Report Synthesis** — Streams a complete Markdown report with citations
- **Follow-up Generation** — Suggests deeper exploration paths

The entire pipeline is observable in the **Agent Brain** sidebar — watch each sub-agent (Classifier, Planner, Retriever, Analyst, Writer) activate in real time with live log entries.

### 2. Notes & Chat

A streaming conversation interface backed by local LLM inference:

- Real-time token streaming with typing animation
- Per-message performance metrics (tokens, tok/s, latency)
- Active model indicator with load status
- Clear conversation with one click
- Persistent across tab switches

### 3. Speech-to-Intelligence

A complete voice pipeline — speak naturally, get AI responses read back to you:

- **Voice Activity Detection** (Silero VAD v5) — Detects when you start and stop talking
- **Speech-to-Text** (Whisper Tiny) — Transcribes your speech in real time
- **Language Model** — Generates concise responses to what you said
- **Text-to-Speech** (Piper TTS) — Reads the response back with natural voice
- **Auto-restart Listening** — Continuous conversation without re-tapping
- **Silence Detection** — Waits 2.5s after you pause, accumulates multiple segments
- **Built-in Diagnostics** — Test mic access, model status, and pipeline health

### 4. Vision Engine

Grant AI optical access to your camera:

- **Snapshot Mode** — Capture a single frame and describe it
- **Continuous Mode** — Live feed analysis every 2.5 seconds
- **Smart Frame Diffing** — Skips identical frames to save compute
- **Custom Prompts** — Ask anything: "Read the text", "Count the objects", "Describe the scene"
- **WASM Crash Recovery** — Automatic VLM worker restart with exponential backoff
- **Built-in Diagnostics** — Verify camera, model, worker bridge, SharedArrayBuffer

### 5. Tool Pipeline Explorer

An interactive sandbox for testing function-calling AI:

- Pre-loaded demo tools (weather, calculator, time, random number)
- Visual execution trace showing tool calls, results, and final output
- Register custom tools with typed parameters at runtime
- Auto-execute toggle for hands-free pipeline runs

### 6. Model Manager

Full control over your on-device model library:

- View all models grouped by category (LLM, VLM, STT, TTS, VAD)
- Download, load, unload, and delete models individually
- **Import local models** — Drag-and-drop `.gguf`, `.onnx`, or `.tar.gz` files
- Real-time download progress with percentage tracking
- Storage usage dashboard (used / available OPFS space)

---

## Architecture

```
Browser Tab
├── React UI (Glassmorphic shell with Tailwind CSS v4)
│   ├── Sidebar Navigation (5 tools + settings)
│   ├── Agent Brain Panel (live pipeline debugger)
│   └── Settings Panel (theme, accent color, background)
│
├── RunAnywhere SDK Core (TypeScript, no WASM)
│   ├── ModelManager (download, cache, load orchestration)
│   ├── EventBus (cross-component communication)
│   ├── AudioCapture / VideoCapture (media APIs)
│   └── VoicePipeline (STT → LLM → TTS orchestrator)
│
├── LlamaCPP Backend (WASM)
│   ├── LLM inference (LFM2 1.2B Tool / 350M)
│   ├── VLM inference via Web Worker (LFM2-VL 450M)
│   ├── Tool calling engine
│   └── WebGPU acceleration (auto-detected)
│
└── ONNX Backend (sherpa-onnx WASM)
    ├── STT (Whisper Tiny English)
    ├── TTS (Piper Lessac Medium)
    └── VAD (Silero v5)
```

All models are cached in the browser's **Origin Private File System (OPFS)** — a persistent, sandboxed storage layer. First download pulls from HuggingFace; subsequent loads are instant from cache.

---

## Models

| Model | Category | Size | Purpose |
|-------|----------|------|---------|
| LFM2 1.2B Tool Q4_K_M | LLM | ~800 MB | Research agent, tool calling, chat |
| LFM2 350M Q4_K_M | LLM | ~250 MB | Fast chat fallback |
| LFM2-VL 450M Q4_0 | VLM | ~500 MB | Vision + language (camera analysis) |
| Whisper Tiny English | STT | ~105 MB | Speech recognition |
| Piper Lessac Medium | TTS | ~65 MB | Voice synthesis |
| Silero VAD v5 | VAD | ~5 MB | Voice activity detection |

All models are quantized for efficient browser execution. Import your own `.gguf` or `.onnx` models through the Model Manager.

---

## Quick Start

```bash
git clone https://github.com/ayushap18/Potency-AI.git
cd Potency-AI
npm install
npm run dev
```

Open **http://localhost:5173** in Chrome or Edge.

Models download automatically the first time you use each tool. Subsequent visits load from browser cache.

### Production Build

```bash
npm run build
npm run preview
```

The build output in `dist/` includes all WASM binaries and can be deployed to any static host that supports the required security headers.

---

## Browser Requirements

Potency AI requires modern browser capabilities for on-device neural inference:

| Requirement | Why |
|------------|-----|
| **Chrome 120+** or **Edge 120+** | WebGPU and WASM SIMD support |
| **SharedArrayBuffer** | Multi-threaded WASM execution |
| **Cross-Origin Isolation** | Required for SharedArrayBuffer |
| **OPFS** | Persistent model storage |
| **WebGPU** (optional) | 2-4x faster inference when available |

The Vite dev server automatically sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers.

For production deployment, configure your server to send:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

---

## Project Structure

```
potency-ai/
├── public/
│   └── logo.svg                  # Project logo
├── src/
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Shell layout (header, sidebar, brain panel)
│   ├── runanywhere.ts            # SDK init, model catalog, VLM worker wiring
│   ├── agent/
│   │   ├── agent.ts              # Research pipeline orchestrator
│   │   ├── localLLM.ts           # LLM wrapper with JSON retry logic
│   │   ├── prompts.ts            # Prompt templates with input sanitization
│   │   └── retrieval.ts          # Wikipedia source retrieval
│   ├── components/
│   │   ├── AgentTab.tsx          # Research agent interface
│   │   ├── ChatTab.tsx           # Streaming chat
│   │   ├── VoiceTab.tsx          # Voice pipeline + diagnostics
│   │   ├── VisionTab.tsx         # Camera + VLM + diagnostics
│   │   ├── ToolsTab.tsx          # Tool pipeline sandbox
│   │   ├── ModelManagerPanel.tsx  # Model download/load/import UI
│   │   ├── ModelBanner.tsx       # Download progress indicator
│   │   └── CursorGrid.tsx        # Animated background
│   ├── hooks/
│   │   └── useModelLoader.ts     # Model lifecycle hook
│   ├── context/
│   │   └── ThemeContext.tsx       # Theme, accent color, background
│   ├── workers/
│   │   └── vlm-worker.ts         # VLM Web Worker entry point
│   └── styles/
│       └── index.css             # Tailwind v4 theme tokens
├── vite.config.ts                # Vite config with WASM copy plugin
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## Design System

The interface uses a custom **glassmorphism design system** built on Tailwind CSS v4:

- **Glass panels** with backdrop blur and translucent borders
- **Dynamic theming** — Dark / Light mode with smooth transitions
- **6 accent colors** — Switchable in settings
- **Animated grid background** — Reactive cursor-following grid
- **Responsive layout** — Full sidebar on desktop, slide-out drawer on mobile
- **Material Symbols** icon set throughout

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript 5 |
| Styling | Tailwind CSS v4 (static compilation) |
| Build | Vite 6 |
| AI Runtime | RunAnywhere Web SDK |
| LLM/VLM Engine | llama.cpp compiled to WASM |
| Speech Engine | sherpa-onnx compiled to WASM |
| GPU Acceleration | WebGPU (auto-detected, CPU fallback) |
| Model Storage | Browser OPFS (Origin Private File System) |
| Source Retrieval | Wikipedia REST API |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Roadmap

- [ ] Multi-turn conversation memory for research agent
- [ ] Image generation via on-device Stable Diffusion
- [ ] PDF and document analysis pipeline
- [ ] Collaborative whiteboard with AI annotation
- [ ] Offline-first PWA with service worker caching
- [ ] Custom model fine-tuning in-browser
- [ ] Multi-language STT/TTS support
- [ ] Plugin system for community-built tools

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with local-first principles. Your intelligence, your hardware, your data.</sub>
</p>
