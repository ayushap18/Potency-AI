/**
 * ModeSelector.tsx — Gemini-style Potency mode dropdown
 *
 * Pill-shaped button that opens a glassmorphism dropdown with 3 modes:
 *   - Fast: quick answers
 *   - Thinking: structured reasoning
 *   - Pro: multi-pass deep analysis
 *
 * Based on gemini1.png / gemini2.png reference designs.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MODE_INFO, type PotencyMode } from '../agent/modelRouter';

interface ModeSelectorProps {
  currentMode: PotencyMode;
  onModeChange: (mode: PotencyMode) => void;
  disabled?: boolean;
}

const MODES: PotencyMode[] = ['fast', 'thinking', 'pro'];

export function ModeSelector({ currentMode, onModeChange, disabled }: ModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleSelect = useCallback((mode: PotencyMode) => {
    onModeChange(mode);
    setOpen(false);
  }, [onModeChange]);

  const info = MODE_INFO[currentMode];

  return (
    <div className="mode-selector-container" ref={containerRef}>
      {/* Trigger button */}
      <button
        id="mode-selector-trigger"
        className="mode-selector-trigger"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        title={`Current mode: ${info.label}`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="mode-selector-label">{info.label}</span>
        <svg
          className={`mode-selector-chevron ${open ? 'open' : ''}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="mode-selector-dropdown" role="listbox" aria-label="Select Potency mode">
          {/* Header */}
          <div className="mode-selector-header">
            <span className="mode-selector-brand">Potency</span>
          </div>

          {/* Options */}
          {MODES.map((mode) => {
            const modeInfo = MODE_INFO[mode];
            const isActive = mode === currentMode;

            return (
              <button
                key={mode}
                className={`mode-selector-option ${isActive ? 'active' : ''}`}
                onClick={() => handleSelect(mode)}
                role="option"
                aria-selected={isActive}
                id={`mode-option-${mode}`}
              >
                <div className="mode-option-content">
                  <span className="mode-option-label">{modeInfo.label}</span>
                  <span className="mode-option-desc">{modeInfo.description}</span>
                </div>
                {isActive && (
                  <span className="mode-option-check">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
