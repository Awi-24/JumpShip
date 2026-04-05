import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  style?: React.CSSProperties;
}

export default function CustomSelect({ value, onChange, options, className = '', style }: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? value;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleTriggerClick = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // Flip upward if not enough space below
      const spaceBelow = window.innerHeight - rect.bottom;
      const listHeight = Math.min(options.length * 40 + 12, 280);
      const top = spaceBelow < listHeight && rect.top > listHeight
        ? rect.top - listHeight - 4
        : rect.bottom + 4;
      setDropPos({ top, left: rect.left, width: rect.width });
    }
    setOpen(o => !o);
  };

  // Build grouped options
  const groups: { group: string; opts: SelectOption[] }[] = [];
  for (const opt of options) {
    const g = opt.group ?? '';
    let entry = groups.find(e => e.group === g);
    if (!entry) { entry = { group: g, opts: [] }; groups.push(entry); }
    entry.opts.push(opt);
  }

  return (
    <>
      <div
        ref={triggerRef}
        className={`custom-select${open ? ' open' : ''}${className ? ' ' + className : ''}`}
        style={style}
        onClick={handleTriggerClick}
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTriggerClick(); } }}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="custom-select-value">{selectedLabel}</span>
        <svg
          className="custom-select-arrow"
          width="10" height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && createPortal(
        <div
          ref={listRef}
          className="custom-select-list"
          style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, width: dropPos.width, zIndex: 9999 }}
          role="listbox"
        >
          <div className="custom-select-list-body">
            {groups.map(({ group, opts }) => (
              <div key={group || '__default__'}>
                {group && <div className="custom-select-group">{group}</div>}
                {opts.map(opt => (
                  <div
                    key={opt.value}
                    className={`custom-select-option${opt.value === value ? ' selected' : ''}`}
                    role="option"
                    aria-selected={opt.value === value}
                    onMouseDown={e => {
                      e.preventDefault();
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
