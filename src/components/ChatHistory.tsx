/**
 * ChatHistory.tsx — Sidebar component for saved chat sessions
 *
 * Shows chats grouped by date (Today, Yesterday, Previous 7 Days, Older).
 * Features: search, context menu (rename, pin, archive, delete).
 * Based on extrachat.png, chatref1.png, chatref2.png reference designs.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { type ChatSession, groupChatsByDate } from '../utils/storage';

interface ChatHistoryProps {
  chats: ChatSession[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, newTitle: string) => void;
  onPinChat: (id: string) => void;
  onArchiveChat: (id: string) => void;
}

interface ContextMenuState {
  chatId: string;
  x: number;
  y: number;
}

export function ChatHistory({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onPinChat,
  onArchiveChat,
}: ChatHistoryProps) {
  const [search, setSearch] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Filter chats by search
  const filteredChats = search.trim()
    ? chats.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.messages.some(m => m.content.toLowerCase().includes(search.toLowerCase())),
      )
    : chats;

  const groups = groupChatsByDate(filteredChats);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, chatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ chatId, x: e.clientX, y: e.clientY });
  }, []);

  const handleMoreClick = useCallback((e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setContextMenu({ chatId, x: rect.right, y: rect.bottom });
  }, []);

  const startRename = useCallback((chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setRenamingId(chatId);
      setRenameValue(chat.title);
      setContextMenu(null);
    }
  }, [chats]);

  const confirmRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      onRenameChat(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRenameChat]);

  return (
    <div className="chat-history-container">
      {/* New Chat Button */}
      <button
        id="new-chat-btn"
        className="chat-history-new-btn"
        onClick={onNewChat}
        title="Start a new chat"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>New Chat</span>
      </button>

      {/* Search */}
      <div className="chat-history-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ opacity: 0.5, flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          id="chat-search-input"
          className="chat-history-search-input"
          placeholder="Search chats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Chat list */}
      <div className="chat-history-list custom-scrollbar">
        {groups.length === 0 && (
          <div className="chat-history-empty">
            <span className="material-symbols-outlined" style={{ fontSize: 32, opacity: 0.3 }}>chat_bubble_outline</span>
            <p>{search ? 'No matching chats' : 'No chats yet'}</p>
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="chat-history-group">
            <div className="chat-history-group-label">{group.label}</div>
            {group.chats.map((chat) => (
              <div
                key={chat.id}
                className={`chat-history-item ${chat.id === activeChatId ? 'active' : ''}`}
                onClick={() => onSelectChat(chat.id)}
                onContextMenu={(e) => handleContextMenu(e, chat.id)}
              >
                {renamingId === chat.id ? (
                  <input
                    ref={renameInputRef}
                    className="chat-history-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={confirmRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRename();
                      if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="chat-history-item-title">
                      {chat.pinned && (
                        <span className="material-symbols-outlined chat-pin-icon" style={{ fontSize: 12 }}>push_pin</span>
                      )}
                      {chat.title}
                    </span>
                    <button
                      className="chat-history-more-btn"
                      onClick={(e) => handleMoreClick(e, chat.id)}
                      title="More options"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="chat-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => startRename(contextMenu.chatId)}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
            Rename
          </button>
          <button onClick={() => { onPinChat(contextMenu.chatId); setContextMenu(null); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>push_pin</span>
            {chats.find(c => c.id === contextMenu.chatId)?.pinned ? 'Unpin' : 'Pin chat'}
          </button>
          <button onClick={() => { onArchiveChat(contextMenu.chatId); setContextMenu(null); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>archive</span>
            Archive
          </button>
          <div className="chat-context-divider" />
          <button className="chat-context-danger" onClick={() => { onDeleteChat(contextMenu.chatId); setContextMenu(null); }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
