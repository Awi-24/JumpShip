/**
 * useAgentSocket — WebSocket hook for the V2 LangGraph agent system.
 *
 * Connects to ws://localhost:8000/api/ws/agents and dispatches typed events.
 * Replaces the SSE connection in the old AgentQueue.
 */
import { useEffect, useRef, useCallback, useState } from 'react';

export type AgentEventType =
  | 'pong'
  | 'thread_update'
  | 'trace_event'
  | 'hitl_needed'
  | 'error'
  | 'model_selected';

export interface AgentEvent {
  type: AgentEventType;
  [key: string]: unknown;
}

export interface AgentThread {
  thread_id:     string;
  graph_name:    string;
  job_title:     string;
  company:       string;
  status:        'running' | 'success' | 'failed' | 'waiting_hitl' | 'cancelled';
  summary:       string;
  fields_filled: Record<string, string>;
  error:         string;
  hitl_question?: string;
  created_at?:   string;
  updated_at?:   string;
}

type EventHandler = (event: AgentEvent) => void;

const WS_URL = `ws://${window.location.hostname}:8000/api/ws/agents`;
const RECONNECT_DELAY_MS = 3000;

export function useAgentSocket(onEvent?: EventHandler) {
  const wsRef              = useRef<WebSocket | null>(null);
  const reconnectTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef         = useRef<EventHandler | undefined>(onEvent);

  // Keep the handler ref current without triggering reconnects
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (ev) => {
      try {
        const event: AgentEvent = JSON.parse(ev.data);
        onEventRef.current?.(event);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Auto-reconnect
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendHitlResponse = useCallback((threadId: string, response: string) => {
    send({ type: 'hitl_response', thread_id: threadId, response });
  }, [send]);

  const cancelThread = useCallback((threadId: string) => {
    send({ type: 'cancel', thread_id: threadId });
  }, [send]);

  return { connected, send, sendHitlResponse, cancelThread };
}
