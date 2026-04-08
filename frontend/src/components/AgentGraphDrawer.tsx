/**
 * AgentGraphDrawer — Visualizes a LangGraph agent's workflow.
 *
 * Fetches the graph as a PNG or Mermaid string from the backend.
 * Shows a slide-in panel with the graph.
 */
import { useState, useEffect } from 'react';
import { X, Share2, ZoomIn, Info } from 'lucide-react';

interface AgentGraphDrawerProps {
  graphName: 'scout' | 'matcher' | 'apply' | 'inbox' | null;
  onClose: () => void;
}

export default function AgentGraphDrawer({ graphName, onClose }: AgentGraphDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [imgUrl, setImgUrl]   = useState<string | null>(null);
  const [mermaid, setMermaid] = useState<string | null>(null);

  useEffect(() => {
    if (!graphName) return;

    setLoading(true);
    setError(null);
    setImgUrl(null);
    setMermaid(null);

    const url = `/api/agents/graphs/${graphName}/svg`; // We called it svg but it returns png/json

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load graph');
        
        const contentType = res.headers.get('content-type');
        if (contentType?.includes('image/png')) {
          const blob = await res.blob();
          setImgUrl(URL.createObjectURL(blob));
        } else {
          const data = await res.json();
          setMermaid(data.mermaid);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [graphName]);

  if (!graphName) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 300,
          backdropFilter: 'blur(3px)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          right: 0, top: 0, bottom: 0,
          width: 'min(720px, 98vw)',
          background: 'var(--bg1)',
          borderLeft: '1px solid var(--border)',
          zIndex: 301,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-12px 0 60px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, textTransform: 'capitalize' }}>
              {graphName} Agent Workflow
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Interactive LangGraph logic diagram
            </div>
          </div>
          <button className="btn-ghost btn-icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {loading && (
            <div style={{ textAlign: 'center' }}>
              <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px' }} />
              <div style={{ color: 'var(--text-muted)' }}>Generating graph visualization...</div>
            </div>
          )}

          {error && (
            <div style={{ textAlign: 'center', color: '#f87171' }}>
              <Info size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
              <div>{error}</div>
              <div style={{ fontSize: 12, marginTop: 8, opacity: 0.8 }}>
                Make sure 'pyppeteer' or 'playwright' is installed in the python environment.
              </div>
            </div>
          )}

          {imgUrl && (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={imgUrl}
                alt={`${graphName} graph`}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', filter: 'invert(0.9) hue-rotate(180deg)' }} // Adjust for dark mode if needed
              />
            </div>
          )}

          {mermaid && (
            <div style={{ width: '100%' }}>
              <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
                Mermaid visualization (Live rendering coming soon)
              </div>
              <pre style={{
                background: 'var(--bg3)',
                padding: 20,
                borderRadius: 8,
                fontSize: 11,
                overflowX: 'auto',
                border: '1px solid var(--border)',
                color: 'var(--gold)',
              }}>
                {mermaid}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 12 }}>
          <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }}>
            <ZoomIn size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Reset Zoom
          </button>
          <button className="btn-secondary" style={{ flex: 1, fontSize: 13 }}>
            <Share2 size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Export SVG
          </button>
        </div>
      </div>
    </>
  );
}
