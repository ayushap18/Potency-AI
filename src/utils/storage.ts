/**
 * storage.ts — IndexedDB wrapper for local-first persistence
 *
 * Stores:
 *   - chats: Chat sessions with messages
 *   - notes: Note documents
 *   - preferences: User settings
 *
 * No cloud, no server — everything stays in the browser.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Optional metadata (agent status, research report, etc.) */
  meta?: Record<string, unknown>;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
}

export interface NoteDocument {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserPreferences {
  defaultMode: 'fast' | 'thinking' | 'pro';
  theme: string;
  sidebarCollapsed: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'potency-ai';
const DB_VERSION = 1;
const STORE_CHATS = 'chats';
const STORE_NOTES = 'notes';
const STORE_PREFS = 'preferences';

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Failed to open IndexedDB'));

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Chats store
      if (!db.objectStoreNames.contains(STORE_CHATS)) {
        const chatStore = db.createObjectStore(STORE_CHATS, { keyPath: 'id' });
        chatStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        chatStore.createIndex('pinned', 'pinned', { unique: false });
      }

      // Notes store
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        const noteStore = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
        noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // Preferences store
      if (!db.objectStoreNames.contains(STORE_PREFS)) {
        db.createObjectStore(STORE_PREFS, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      _db = (event.target as IDBOpenDBRequest).result;
      resolve(_db);
    };
  });
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

// ---------------------------------------------------------------------------
// Chat operations
// ---------------------------------------------------------------------------

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveChat(chat: ChatSession): Promise<void> {
  chat.updatedAt = Date.now();
  await dbPut(STORE_CHATS, chat);
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  return dbGet<ChatSession>(STORE_CHATS, id);
}

export async function deleteChat(id: string): Promise<void> {
  await dbDelete(STORE_CHATS, id);
}

export async function listChats(): Promise<ChatSession[]> {
  const all = await dbGetAll<ChatSession>(STORE_CHATS);
  // Sort: pinned first, then by updatedAt descending
  return all
    .filter(c => !c.archived)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    });
}

export async function searchChats(query: string): Promise<ChatSession[]> {
  const all = await listChats();
  const q = query.toLowerCase();
  return all.filter(c =>
    c.title.toLowerCase().includes(q) ||
    c.messages.some(m => m.content.toLowerCase().includes(q)),
  );
}

/**
 * Auto-generate a title from the first user message if not set.
 */
export function autoTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Chat';
  const text = firstUser.content.trim();
  if (text.length <= 50) return text;
  return text.slice(0, 47) + '...';
}

export function createNewChat(): ChatSession {
  const now = Date.now();
  return {
    id: generateId(),
    title: 'New Chat',
    messages: [],
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
  };
}

// ---------------------------------------------------------------------------
// Notes operations
// ---------------------------------------------------------------------------

export async function saveNote(note: NoteDocument): Promise<void> {
  note.updatedAt = Date.now();
  await dbPut(STORE_NOTES, note);
}

export async function getNote(id: string): Promise<NoteDocument | undefined> {
  return dbGet<NoteDocument>(STORE_NOTES, id);
}

export async function deleteNote(id: string): Promise<void> {
  await dbDelete(STORE_NOTES, id);
}

export async function listNotes(): Promise<NoteDocument[]> {
  const all = await dbGetAll<NoteDocument>(STORE_NOTES);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createNewNote(): NoteDocument {
  const now = Date.now();
  return {
    id: generateId(),
    title: '',
    content: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

const DEFAULT_PREFS: UserPreferences = {
  defaultMode: 'fast',
  theme: 'dark',
  sidebarCollapsed: false,
};

export async function getPreferences(): Promise<UserPreferences> {
  const stored = await dbGet<{ key: string; value: UserPreferences }>(STORE_PREFS, 'user-prefs');
  return stored?.value ?? { ...DEFAULT_PREFS };
}

export async function savePreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const current = await getPreferences();
  const merged = { ...current, ...prefs };
  await dbPut(STORE_PREFS, { key: 'user-prefs', value: merged });
}

// ---------------------------------------------------------------------------
// Date grouping helper for ChatHistory UI
// ---------------------------------------------------------------------------

export interface ChatGroup {
  label: string;
  chats: ChatSession[];
}

export function groupChatsByDate(chats: ChatSession[]): ChatGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;

  const groups: ChatGroup[] = [];
  const todayChats: ChatSession[] = [];
  const yesterdayChats: ChatSession[] = [];
  const weekChats: ChatSession[] = [];
  const olderChats: ChatSession[] = [];

  for (const chat of chats) {
    const t = chat.updatedAt;
    if (t >= today) todayChats.push(chat);
    else if (t >= yesterday) yesterdayChats.push(chat);
    else if (t >= week) weekChats.push(chat);
    else olderChats.push(chat);
  }

  if (todayChats.length) groups.push({ label: 'Today', chats: todayChats });
  if (yesterdayChats.length) groups.push({ label: 'Yesterday', chats: yesterdayChats });
  if (weekChats.length) groups.push({ label: 'Previous 7 Days', chats: weekChats });
  if (olderChats.length) groups.push({ label: 'Older', chats: olderChats });

  return groups;
}
