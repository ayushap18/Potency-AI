/**
 * NotePanel.tsx — Notepad panel for the unified chat
 * 
 * Opens as a slide-out panel when "Note" tool is selected.
 * Features:
 * - Rich text editor (contentEditable)
 * - AI integration (Draft/Summarize)
 * - IndexedDB persistence 
 * - Multiple notes support
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { callLLM } from '../agent/localLLM';
import { saveNote, listNotes, createNewNote, getNote, deleteNote, type NoteDocument } from '../utils/storage';
import type { PotencyMode } from '../agent/modelRouter';

interface NotePanelProps {
  open: boolean;
  onClose: () => void;
  currentMode?: PotencyMode;
}

export function NotePanel({ open, onClose, currentMode = 'fast' }: NotePanelProps) {
  const [notes, setNotes] = useState<NoteDocument[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Load notes
  useEffect(() => {
    if (open) {
      listNotes().then(all => {
        setNotes(all);
        if (all.length > 0 && !activeNoteId) {
          selectNote(all[0].id);
        } else if (all.length === 0) {
          handleNewNote();
        }
      });
    }
  }, [open, activeNoteId]);

  // Save mechanism
  useEffect(() => {
    if (!activeNoteId || !open) return;
    const timeout = setTimeout(() => {
      getNote(activeNoteId).then(existing => {
        if (existing) {
          const updated = { ...existing, title, content: contentHtml };
          saveNote(updated);
          setNotes(prev => prev.map(n => n.id === activeNoteId ? { ...updated, updatedAt: Date.now() } : n).sort((a,b)=>b.updatedAt - a.updatedAt));
        }
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [title, contentHtml, activeNoteId, open]);

  const selectNote = async (id: string) => {
    const note = await getNote(id);
    if (note) {
      setActiveNoteId(note.id);
      setTitle(note.title);
      setContentHtml(note.content);
      if (editorRef.current) {
        editorRef.current.innerHTML = note.content;
      }
    }
  };

  const handleNewNote = async () => {
    const fresh = createNewNote();
    await saveNote(fresh);
    setNotes(prev => [fresh, ...prev]);
    setActiveNoteId(fresh.id);
    setTitle('');
    setContentHtml('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
      setTitle('');
      setContentHtml('');
      if (editorRef.current) editorRef.current.innerHTML = '';
    }
  };

  // Formatting
  const format = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setContentHtml(editorRef.current.innerHTML);
      editorRef.current.focus();
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      setContentHtml(editorRef.current.innerHTML);
    }
  };

  // AI Features
  const handleAiDraft = async () => {
    if (!contentHtml && editorRef.current?.innerText.trim().length === 0) return;
    if (isAiLoading) return;
    setIsAiLoading(true);
    try {
      const plainText = editorRef.current?.innerText || contentHtml;
      const resp = await callLLM(
        "You are an AI writing assistant. Continue, expand, or rewrite the following text professionally. Respond directly with the drafted text in markdown/plain text format.",
        plainText,
        undefined, undefined, undefined, currentMode
      );
      const safeHtml = resp.replace(/\n/g, '<br>');
      const newHtml = contentHtml + '<br><br><strong>[AI Draft]:</strong><br>' + safeHtml;
      setContentHtml(newHtml);
      if (editorRef.current) {
        editorRef.current.innerHTML = newHtml;
        editorRef.current.focus();
      }
    } catch (err) {
      console.error('AI Draft failed', err);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!contentHtml && editorRef.current?.innerText.trim().length === 0) return;
    if (isAiLoading) return;
    setIsAiLoading(true);
    try {
      const plainText = editorRef.current?.innerText || contentHtml;
      const resp = await callLLM(
        "You are an AI writing assistant. Summarize the following text clearly and concisely using bullet points.",
        plainText,
        undefined, undefined, undefined, currentMode
      );
      const safeHtml = resp.replace(/\n/g, '<br>');
      const newHtml = '<strong>[AI Summary]:</strong><br>' + safeHtml + '<br><br>' + contentHtml;
      setContentHtml(newHtml);
      if (editorRef.current) {
        editorRef.current.innerHTML = newHtml;
        editorRef.current.focus();
      }
    } catch (err) {
      console.error('AI Summarize failed', err);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleExportTxt = useCallback(() => {
    const text = title + '\n\n' + (editorRef.current?.innerText || '');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'untitled').replace(/\s+/g, '-').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [title]);

  if (!open) return null;

  return (
    <div className="note-panel-container flex">
      {/* Sidebar (List of Notes) */}
      <div className="w-48 border-r border-[#ffffff10] bg-[#ffffff02] flex flex-col h-full shrink-0">
        <div className="p-3 border-b border-[#ffffff10] flex justify-between items-center">
          <span className="text-xs font-bold text-[#ffffffa0] uppercase tracking-wider">Notes</span>
          <button onClick={handleNewNote} className="icon-btn w-6 h-6 rounded hover:bg-[#ffffff15]" title="New note">
            <span className="material-symbols-outlined text-sm">add</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {notes.map(n => (
            <div 
              key={n.id} 
              onClick={() => selectNote(n.id)}
              className={`p-3 border-b border-[#ffffff10] cursor-pointer hover:bg-[#ffffff08] group ${activeNoteId === n.id ? 'bg-[#ffffff10]' : ''}`}
            >
              <div className="flex justify-between items-start">
                <div className="truncate text-sm font-medium text-[#ffffffd0] flex-1">
                  {n.title || 'Untitled Note'}
                </div>
                <button 
                  onClick={(e) => handleDeleteNote(n.id, e)} 
                  className="opacity-0 group-hover:opacity-100 text-[#ff5f5f] hover:text-[#ff8f8f]"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
              <div className="text-xs text-[#ffffff50] truncate mt-1">
                {new Date(n.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col relative h-full w-full max-w-full overflow-hidden">
        {/* Header */}
        <div className="note-panel-header shrink-0">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-lg" style={{ color: 'var(--accent)' }}>edit_note</span>
            <input
              ref={titleRef}
              className="bg-transparent border-none text-base font-semibold focus:outline-none w-64 text-[#ffffffd0]"
              placeholder="Untitled Note"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <button onClick={onClose} className="icon-btn" title="Close notepad">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Formatting Toolbar */}
        <div className="note-toolbar shrink-0">
          <div className="flex items-center gap-0.5">
            <button className="note-toolbar-btn" onClick={() => format('bold')} title="Bold">
              <span className="material-symbols-outlined text-base">format_bold</span>
            </button>
            <button className="note-toolbar-btn" onClick={() => format('italic')} title="Italic">
              <span className="material-symbols-outlined text-base">format_italic</span>
            </button>
            <button className="note-toolbar-btn" onClick={() => format('insertUnorderedList')} title="List">
              <span className="material-symbols-outlined text-base">format_list_bulleted</span>
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isAiLoading && <span className="material-symbols-outlined text-sm animate-spin text-[var(--accent)]">sync</span>}
            <button className="note-ai-btn" onClick={handleAiDraft} disabled={isAiLoading || !activeNoteId} title="AI Draft">
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              <span>Draft</span>
            </button>
            <button className="note-ai-btn" onClick={handleSummarize} disabled={isAiLoading || !activeNoteId} title="Summarize">
              <span className="material-symbols-outlined text-sm">summarize</span>
              <span>Summarize</span>
            </button>
          </div>
        </div>

        {/* Editor */}
        {activeNoteId ? (
          <div className="note-editor flex-1 p-0 relative">
            <div
              ref={editorRef}
              className="w-full h-full p-6 outline-none text-[#ffffffb0] whitespace-pre-wrap overflow-y-auto custom-scrollbar"
              contentEditable
              onInput={handleInput}
              suppressContentEditableWarning
              style={{ fontSize: '14px', lineHeight: '1.6' }}
            />
            {!contentHtml && (
              <div className="absolute top-6 left-6 text-[#ffffff30] pointer-events-none">
                Start writing or use AI to draft content...
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#ffffff30] text-sm">
            Select or create a note
          </div>
        )}

        {/* Export Footer */}
        <div className="note-footer shrink-0 justify-end">
          <button className="btn-secondary text-xs px-3 py-1.5" onClick={handleExportTxt} disabled={!activeNoteId}>
            Export .txt
          </button>
        </div>
      </div>
    </div>
  );
}
