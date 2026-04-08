/**
 * AgentChatDrawer — Slide-in HITL panel for V2 LangGraph agents.
 *
 * Opens when any agent thread reaches status "waiting_hitl".
 * Shows:
 *   - The agent's question / reason for needing help
 *   - A chat-style message history for the thread
 *   - A text input to respond (Enter or button to send)
 *   - A "Dismiss / let agent timeout" option
 *
 * Usage:
 *   <AgentChatDrawer
 *     thread={activeHitlThread}
 *     onSend={(threadId, response) => sendHitlResponse(threadId, response)}
 *     onClose={() => setActiveHitlThread(null)}
 *   />
 */
import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Bot, Send, X, User } from 'lucide-react';
import type { AgentThread } from '../hooks/useAgentSocket';

interface Message {
  role: 'agent' | 'user';
  content: string;
  ts: string;
}

interface AgentChatDrawerProps {
  thread: AgentThread | null;
  onSend: (threadId: string, response: string) => void;
  onClose: () => void;
}

export default function AgentChatDrawer({ thread, onSend, onClose }: AgentChatDrawerProps) {
  const [input, setInput]       = useState('');
  const [history, setHistory]   = useState<Message[]>([]);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // When a new HITL question arrives, push it into the chat history
  useEffect(() => {
    if (!thread?.hitl_question) return;
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'agent' && last.content === thread.hitl_question) return prev;
      return [...prev, { role: 'agent', content: thread.hitl_question!, ts: new Date().toISOString() }];
    });
  }, [thread?.hitl_question, thread?.thread_id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  if (!thread) return null;

  const handleSend = () => {
    const value = input.trim();
    if (!value) return;
    setHistory(prev => [...prev, { role: 'user', content: value, ts: new Date().toISOString() }]);
    onSend(thread.thread_id, value);
    setInput('');
  };

  const isWaiting = thread.status === 'waiting_hitl';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 200,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed',
          right: 0, top: 0, bottom: 0,
          width: 'min(420px, 96vw)',
          background: 'var(--bg2)',
          borderLeft: '1px solid var(--border)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <Bot size={18} style={{ color: 'var(--gold)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {thread.job_title || 'Agent'}
              {thread.company && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 13 }}>
                  @ {thread.company}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: isWaiting ? 'var(--gold)' : 'var(--text-muted)', marginTop: 1 }}>
              {isWaiting ? 'Waiting for your input' : thread.status}
            </div>
          </div>
          <button
            className="btn-ghost btn-icon-btn"
            onClick={onClose}
            aria-label="Close drawer"
            style={{ flexShrink: 0 }}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* Status banner when waiting */}
        {isWaiting && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 20px',
            background: 'rgba(245,166,35,0.08)',
            borderBottom: '1px solid rgba(245,166,35,0.2)',
            flexShrink: 0,
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--gold)', marginTop: 1, flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
              The agent is paused and needs your answer to continue.
            </div>
          </div>
        )}

        {/* Message history */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {history.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
              No messages yet.
            </div>
          )}
          {history.map((msg, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {msg.role === 'agent' && <Bot size={13} style={{ color: 'var(--gold)' }} />}
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {msg.role === 'agent' ? 'Agent' : 'You'} · {new Date(msg.ts).toLocaleTimeString()}
                </span>
                {msg.role === 'user' && <User size={13} style={{ color: '#60a5fa' }} />}
              </div>
              <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: msg.role === 'user'
                  ? 'rgba(96,165,250,0.15)'
                  : 'rgba(245,166,35,0.08)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(96,165,250,0.25)' : 'rgba(245,166,35,0.2)'}`,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text)',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{
          padding: '12px 20px 16px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={isWaiting ? 'Type your answer… (Enter to send)' : 'Agent is not waiting for input'}
              disabled={!isWaiting}
              rows={2}
              style={{
                flex: 1,
                resize: 'none',
                background: 'var(--bg3)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '10px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
                lineHeight: 1.5,
                opacity: isWaiting ? 1 : 0.5,
              }}
            />
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={!isWaiting || !input.trim()}
              style={{ padding: '10px 14px', flexShrink: 0 }}
              aria-label="Send"
            >
              <Send size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            Shift+Enter for new line · The agent will auto-timeout after 2 min if no reply
          </div>
        </div>
      </div>
    </>
  );
}
