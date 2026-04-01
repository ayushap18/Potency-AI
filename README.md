# Potency-AI (Obsidian Alchemist)

Potency-AI is a curated suite of alchemical tools for the modern creator, featuring an advanced local AI UI built over the [`@runanywhere/web`](https://www.npmjs.com/package/@runanywhere/web) SDK. It runs **100% locally** via WebAssembly — no external servers, no API keys, and complete privacy.

Recently rebuilt with the custom **"Stitch" Obsidian Alchemist Design System** using Tailwind CSS v4, the interface provides a premium, responsive glassmorphic experience featuring a robust sidebar & bottom navigation architecture.

## 🌟 Key Features

| Tool | Capability |
|-----|-------------|
| **Code Assistant (Agent)** | A state-of-the-art Local Research Agent pipeline supporting recursive tool-calling schemas and intermediate reasoning (using LFM2 350M/1.7B). |
| **Notes (Chat)** | A seamless, streaming markdown chat interface for pure textual interaction with live token metrics. |
| **Speech to Text (Voice)** | Speak naturally—utilizes real-time Voice Activity Detection (VAD) coupled with Whisper to transcribe continuously, generating AI responses and running Text-to-Speech (TTS) back to you. |
| **Vision** | Grant the AI optical access to your camera to describe and analyze your environment using LFM2-VL (Vision Language Model). |
| **Learn (Tools)** | A dedicated interactive Sandbox to register, visualize, and test custom agentic tools with dynamic pipelines. |

## 🚀 Quick Start

Ensure you have Node.js installed, then run:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). 

> **Note:** Models are downloaded the very first time you trigger them and cached directly in your browser's persistent Origin Private File System (OPFS).

## 🧩 Architectural Upgrades

### Tailwind CSS v4 Migration
The UI now uses native statically-compiled **Tailwind CSS v4** (`@tailwindcss/postcss`). This entirely eliminates browser-side CSS parsing CPU bottlenecks, freeing up maximum core performance for the WebAssembly AI pipeline.

* **Theme Architecture:** Defined directly natively in `src/styles/index.css` under the `@theme` directive.
* **Colors:** Deep charcoal surfaces `var(--color-surface-dim)`, paired with rusted metallic glowing accents like `var(--color-primary)`.

### Local Agent Iteration
Inside `src/agent/localAgent.ts`, we now wrap the underlying SDK's generation features in a robust class. The agent safely handles recursive iterations for function schemas (like searching the web, analyzing documents) before finalizing answers to the user UI.

## 📂 Project Structure

```
src/
├── main.tsx              # React Root App Mount
├── App.tsx               # App Shell (Sidebar layout & Router)
├── runanywhere.ts        # SDK initialization & OPFS Model definitions
├── agent/
│   ├── localLLM.ts       # Standalone generation helpers
│   └── localAgent.ts     # The recursive tool-calling agent framework
├── workers/
│   └── vlm-worker.ts     # Dedicated VLM execution thread
├── components/
│   ├── AgentTab.tsx      # The Code Assistant interface
│   ├── ChatTab.tsx       # Standard Notes/Chat 
│   ├── VisionTab.tsx     # Camera Optical analyzer
│   ├── VoiceTab.tsx      # Advanced speech node processing
│   ├── ToolsTab.tsx      # Multi-step pipeline tracer (Learn)
│   └── ModelBanner.tsx   # Floating OPFS download indicator
└── styles/
    └── index.css         # Tailwind v4 Base & Theme Tokens
```

## ⚙️ Browser Requirements

Because Potency-AI processes highly optimized Neural Networks on-device via WebGPU and WASM SIMD:

- **Browser**: Chrome 120+ or Edge 120+ (Firefox is supported but requires manual WebGPU flags).
- **Security Headers**: Must be served with Cross-Origin Isolation headers to unlock `SharedArrayBuffer` threading.
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: credentialless`

## 📖 SDK Documentation

Powered natively by the [RunAnywhere.ai SDK](https://docs.runanywhere.ai). Feel free to check out their documentation to add your custom GGUF/ONNX models into the `MODELS` catalog.

## License

MIT
