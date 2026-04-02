/**
 * NotePanel.tsx — Notepad panel for the unified chat
 * 
 * Opens as a slide-out panel when "Note" tool is selected.
 * Based on the notemaker reference design — minimalist editor with AI-assist toolbar.
 */

import { useState, useRef, useCallback } from 'react';

interface NotePanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotePanel({ open, onClose }: NotePanelProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = useCallback(() => {
    const text = `${title}\n\n${content}`;
    navigator.clipboard.writeText(text).catch(() => {});
  }, [title, content]);

  const handleExportTxt = useCallback(() => {
    const text = `${title || 'Untitled Note'}\n\n${content}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'untitled').replace(/\s+/g, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [title, content]);

  if (!open) return null;

  return (
    <div className="note-panel-container">
      {/* Header */}
      <div className="note-panel-header">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-lg" style={{ color: 'var(--accent)' }}>edit_note</span>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Note</h3>
        </div>
        <button onClick={onClose} className="icon-btn" title="Close notepad">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Formatting Toolbar */}
      <div className="note-toolbar">
        <div className="flex items-center gap-0.5">
          <button className="note-toolbar-btn" title="Bold">
            <span className="material-symbols-outlined text-base">format_bold</span>
          </button>
          <button className="note-toolbar-btn" title="Italic">
            <span className="material-symbols-outlined text-base">format_italic</span>
          </button>
          <button className="note-toolbar-btn" title="List">
            <span className="material-symbols-outlined text-base">format_list_bulleted</span>
          </button>
          <div className="w-px h-5 mx-1" style={{ background: 'var(--glass-border)' }} />
          <button className="note-toolbar-btn" title="Link">
            <span className="material-symbols-outlined text-base">link</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button className="note-ai-btn" title="AI Draft">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            <span>Draft</span>
          </button>
          <button className="note-ai-btn" title="Summarize">
            <span className="material-symbols-outlined text-sm">summarize</span>
            <span>Summarize</span>
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="note-editor">
        <input
          className="note-title-input"
          placeholder="Untitled Note"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          ref={textareaRef}
          className="note-content-input custom-scrollbar"
          placeholder="Start writing or use AI to draft content..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      {/* Export Footer */}
      <div className="note-footer">
        <button className="note-export-btn" onClick={handleExportTxt} title="Export as text file">
          <span className="material-symbols-outlined text-base">download</span>
          <span>Export</span>
        </button>
        <button className="note-export-btn" onClick={handleCopy} title="Copy to clipboard">
          <span className="material-symbols-outlined text-base">content_copy</span>
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}
