import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const POPULAR_LOCATIONS = [
  {
    group: 'Remote & Hybrid',
    items: [
      'Remote',
      'Hybrid',
    ],
  },
  {
    group: '🇧🇷 Brasil',
    items: [
      'Brasil (todo o país)',
      'Brasil (Remoto)',
      'São Paulo',
      'Rio de Janeiro',
      'Belo Horizonte',
      'Curitiba',
      'Porto Alegre',
      'Brasília',
      'Florianópolis',
      'Salvador',
      'Recife',
      'Fortaleza',
      'Campinas',
    ],
  },
  {
    group: '🇺🇸 United States',
    items: [
      'United States (country-wide)',
      'United States (Remote)',
      'New York, NY',
      'San Francisco, CA',
      'Seattle, WA',
      'Austin, TX',
      'Boston, MA',
      'Chicago, IL',
      'Los Angeles, CA',
      'Miami, FL',
      'Denver, CO',
    ],
  },
  {
    group: '🇨🇦 Canada',
    items: ['Canada (country-wide)', 'Canada (Remote)', 'Toronto', 'Vancouver', 'Montreal'],
  },
  {
    group: '🇬🇧 United Kingdom',
    items: ['United Kingdom (country-wide)', 'UK (Remote)', 'London', 'Manchester', 'Edinburgh'],
  },
  {
    group: '🇩🇪 Germany',
    items: ['Germany (country-wide)', 'Germany (Remote)', 'Berlin', 'Munich', 'Hamburg', 'Frankfurt'],
  },
  {
    group: '🇫🇷 France',
    items: ['France (country-wide)', 'France (Remote)', 'Paris', 'Lyon', 'Toulouse'],
  },
  {
    group: '🇪🇸 Spain',
    items: ['Spain (country-wide)', 'Spain (Remote)', 'Madrid', 'Barcelona', 'Valencia'],
  },
  {
    group: '🇵🇹 Portugal',
    items: ['Portugal (country-wide)', 'Portugal (Remote)', 'Lisbon', 'Porto'],
  },
  {
    group: '🇳🇱 Netherlands',
    items: ['Netherlands (country-wide)', 'Netherlands (Remote)', 'Amsterdam', 'Rotterdam'],
  },
  {
    group: '🇮🇪 Ireland',
    items: ['Ireland (country-wide)', 'Ireland (Remote)', 'Dublin', 'Cork'],
  },
  {
    group: '🇨🇭 Switzerland',
    items: ['Switzerland (country-wide)', 'Zurich', 'Geneva', 'Basel'],
  },
  {
    group: '🇸🇪 Sweden',
    items: ['Sweden (country-wide)', 'Stockholm', 'Gothenburg', 'Malmö'],
  },
  {
    group: '🇵🇱 Poland',
    items: ['Poland (country-wide)', 'Warsaw', 'Kraków', 'Wrocław'],
  },
  {
    group: '🇲🇽 Mexico',
    items: ['Mexico (country-wide)', 'Mexico City', 'Guadalajara', 'Monterrey'],
  },
  {
    group: '🇦🇷 Argentina',
    items: ['Argentina (country-wide)', 'Buenos Aires', 'Córdoba'],
  },
  {
    group: '🇨🇴 Colombia',
    items: ['Colombia (country-wide)', 'Bogotá', 'Medellín'],
  },
  {
    group: '🇨🇱 Chile',
    items: ['Chile (country-wide)', 'Santiago'],
  },
  {
    group: '🇦🇺 Australia',
    items: ['Australia (country-wide)', 'Australia (Remote)', 'Sydney', 'Melbourne', 'Brisbane'],
  },
  {
    group: '🇮🇳 India',
    items: ['India (country-wide)', 'India (Remote)', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Pune'],
  },
  {
    group: '🇯🇵 Japan',
    items: ['Japan (country-wide)', 'Japan (Remote)', 'Tokyo', 'Osaka'],
  },
  {
    group: '🇸🇬 Singapore',
    items: ['Singapore (country-wide)', 'Singapore'],
  },
];

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function LocationSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? POPULAR_LOCATIONS
        .map(g => ({
          ...g,
          items: g.items.filter(loc =>
            loc.toLowerCase().includes(query.toLowerCase())
          ),
        }))
        .filter(g => g.items.length > 0)
    : POPULAR_LOCATIONS;

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        listRef.current && !listRef.current.contains(t)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 360 && rect.top > 360 ? rect.top - 360 - 4 : rect.bottom + 4;
      setDropPos({ top, left: rect.left, width: Math.max(rect.width, 280) });
    }
    setQuery('');
    setOpen(o => !o);
  };

  const pick = (loc: string) => {
    onChange(loc);
    setOpen(false);
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={`custom-select${open ? ' open' : ''}`}
        onClick={handleOpen}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(); } }}
      >
        <span className="custom-select-value">{value || 'Remote'}</span>
        <svg className="custom-select-arrow" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && createPortal(
        <div
          ref={listRef}
          className="custom-select-list location-select-list"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
        >
          {/* Search bar: fixed at top, never scrolls */}
          <div className="location-search-wrap">
            <input
              ref={inputRef}
              className="location-search-input"
              placeholder="Search country, city, or remote…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            />
          </div>

          {/* Scrollable options body */}
          <div className="custom-select-list-body">
            {query.trim() && !filtered.some(g => g.items.some(i => i.toLowerCase() === query.toLowerCase())) && (
              <div
                className="custom-select-option"
                style={{ fontStyle: 'italic', color: 'var(--gold)' }}
                onMouseDown={e => { e.preventDefault(); pick(query.trim()); }}
              >
                Use "{query.trim()}"
              </div>
            )}

            {filtered.map(g => (
              <div key={g.group}>
                <div className="custom-select-group">{g.group}</div>
                {g.items.map(loc => (
                  <div
                    key={loc}
                    className={`custom-select-option${loc === value ? ' selected' : ''}`}
                    onMouseDown={e => { e.preventDefault(); pick(loc); }}
                  >
                    {loc}
                  </div>
                ))}
              </div>
            ))}

            {filtered.length === 0 && (
              <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                No matches. Type a city or country name, or use "{query.trim()}"
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
