'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import type { Conversation, Message, Contact } from '@/lib/database.types'

// ── Channel badge colours ────────────────────────────────────
const CHANNEL_STYLES: Record<string, string> = {
  whatsapp:  'bg-green-700 text-white',
  messenger: 'bg-blue-600 text-white',
  instagram: 'bg-pink-600 text-white',
  email:     'bg-amber-700 text-white',
}

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp:  '📱',
  messenger: '💬',
  instagram: '📷',
  email:     '✉️',
}

// ── Helpers ──────────────────────────────────────────────────
function formatTime(ts: string) {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function contactLabel(c: Contact | undefined) {
  if (!c) return 'Unknown'
  return c.name ?? c.phone ?? c.email ?? c.instagram_handle ?? c.facebook_id ?? 'Unknown'
}

// ── Main page ────────────────────────────────────────────────
export default function InboxPage() {
  const [conversations, setConversations] = useState<(Conversation & { contact?: Contact })[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selected = conversations.find(c => c.id === selectedId)

  // ── Load conversations ──────────────────────────────────────
  useEffect(() => {
    async function load() {
      const query = supabase
        .from('conversations')
        .select('*, contact:contacts(*)')
        .order('last_message_at', { ascending: false })

      if (filter !== 'all') {
        query.eq('status', filter)
      }

      const { data } = await query
      setConversations((data as any) ?? [])
    }
    load()

    // Realtime subscription for new conversations
    const channel = supabase
      .channel('conversations-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => load())
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [filter])

  // ── Load messages for selected conversation ────────────────
  useEffect(() => {
    if (!selectedId) return

    async function loadMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedId!)
        .order('timestamp', { ascending: true })
      setMessages((data as Message[]) ?? [])
    }
    loadMessages()

    // Mark all as read
    supabase.from('messages').update({ read: true }).eq('conversation_id', selectedId).then(() => {})

    // Realtime subscription for new messages
    const channel = supabase
      .channel(`messages-${selectedId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${selectedId}`
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedId])

  // ── Auto-scroll to latest message ─────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send reply (stub — calls outbound API) ─────────────────
  async function sendReply() {
    if (!replyText.trim() || !selected) return
    setSending(true)
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: selected.id, text: replyText.trim() }),
      })
      if (res.ok) setReplyText('')
    } finally {
      setSending(false)
    }
  }

  // ── Resolve conversation ───────────────────────────────────
  async function resolveConversation() {
    if (!selectedId) return
    await supabase.from('conversations').update({ status: 'resolved' }).eq('id', selectedId)
    setSelectedId(null)
  }

  return (
    <div className="flex h-screen bg-midnight overflow-hidden">

      {/* ── Sidebar: Logo + filter ── */}
      <aside className="w-72 flex flex-col border-r border-white/10 bg-[#0d110f]">

        {/* Logo bar */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold flex items-center justify-center text-midnight font-bold text-sm">EV</div>
          <div>
            <p className="text-ivory text-sm font-semibold leading-none">Exemplary Voyages</p>
            <p className="text-white/40 text-xs mt-0.5">Unified Inbox</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex text-xs border-b border-white/10">
          {(['open', 'all', 'resolved'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 capitalize transition-colors ${
                filter === f ? 'text-gold border-b-2 border-gold' : 'text-white/40 hover:text-white/70'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-white/30 text-xs text-center mt-10 px-4">No conversations yet.<br/>Messages will appear here.</p>
          )}
          {conversations.map(convo => (
            <button
              key={convo.id}
              onClick={() => setSelectedId(convo.id)}
              className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                selectedId === convo.id ? 'bg-white/10' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-ivory text-sm font-medium truncate">
                  {contactLabel(convo.contact)}
                </span>
                <span className="text-white/30 text-xs ml-2 shrink-0">
                  {convo.last_message_at ? formatTime(convo.last_message_at) : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${CHANNEL_STYLES[convo.channel]}`}>
                  {CHANNEL_ICONS[convo.channel]} {convo.channel}
                </span>
                {convo.status === 'resolved' && (
                  <span className="text-[10px] text-white/30">resolved</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Thread view ── */}
      <main className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
            Select a conversation
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="px-6 py-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-ivory font-semibold">{contactLabel(selected.contact)}</p>
                <p className="text-white/40 text-xs">
                  {CHANNEL_ICONS[selected.channel]} {selected.channel}
                  {selected.contact?.phone ? ` · ${selected.contact.phone}` : ''}
                </p>
              </div>
              <button
                onClick={resolveConversation}
                className="text-xs px-3 py-1.5 rounded border border-tea/50 text-tea hover:bg-tea/10 transition-colors"
              >
                ✓ Resolve
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-gold text-midnight rounded-br-sm'
                        : 'bg-white/10 text-ivory rounded-bl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.body}</p>
                    <p className={`text-[10px] mt-1 ${msg.direction === 'outbound' ? 'text-midnight/60' : 'text-white/30'}`}>
                      {formatTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply box */}
            <div className="px-6 py-4 border-t border-white/10">
              <div className="flex gap-3 items-end">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
                  placeholder="Type a reply… (Enter to send)"
                  rows={2}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-ivory text-sm resize-none focus:outline-none focus:border-gold/50 placeholder-white/20"
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !replyText.trim()}
                  className="px-5 py-3 rounded-xl bg-gold text-midnight text-sm font-semibold hover:bg-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── Contact profile panel ── */}
      {selected?.contact && (
        <aside className="w-64 border-l border-white/10 bg-[#0d110f] p-5">
          <p className="text-gold text-xs font-semibold uppercase tracking-widest mb-4">Contact</p>

          <div className="w-12 h-12 rounded-full bg-tea/20 flex items-center justify-center text-tea text-lg font-bold mb-3">
            {contactLabel(selected.contact).charAt(0).toUpperCase()}
          </div>

          <p className="text-ivory font-semibold text-sm">{contactLabel(selected.contact)}</p>

          <div className="mt-4 space-y-2 text-xs text-white/50">
            {selected.contact.phone && (
              <p>📱 {selected.contact.phone}</p>
            )}
            {selected.contact.email && (
              <p>✉️ {selected.contact.email}</p>
            )}
            {selected.contact.instagram_handle && (
              <p>📷 @{selected.contact.instagram_handle}</p>
            )}
            {selected.contact.facebook_id && (
              <p>💬 FB: {selected.contact.facebook_id}</p>
            )}
          </div>

          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-gold text-xs font-semibold uppercase tracking-widest mb-2">Channel</p>
            <span className={`text-[11px] px-2 py-1 rounded font-semibold ${CHANNEL_STYLES[selected.channel]}`}>
              {CHANNEL_ICONS[selected.channel]} {selected.channel}
            </span>
          </div>

          <div className="mt-4">
            <p className="text-gold text-xs font-semibold uppercase tracking-widest mb-2">Status</p>
            <span className={`text-[11px] px-2 py-1 rounded font-semibold ${
              selected.status === 'open' ? 'bg-tea/20 text-tea' :
              selected.status === 'resolved' ? 'bg-white/10 text-white/50' :
              'bg-amber-900/30 text-amber-400'
            }`}>
              {selected.status}
            </span>
          </div>
        </aside>
      )}
    </div>
  )
}
