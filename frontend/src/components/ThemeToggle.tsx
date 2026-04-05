import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  /** Visually compact (icon only, nav bar) */
  compact?: boolean;
}

export default function ThemeToggle({ className = '', compact }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? 'theme-toggle--compact' : ''} ${className}`.trim()}
      onClick={toggleTheme}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
    >
      {isLight ? <Moon size={compact ? 18 : 20} strokeWidth={2} /> : <Sun size={compact ? 18 : 20} strokeWidth={2} />}
      {!compact && <span>{isLight ? 'Dark' : 'Light'}</span>}
    </button>
  );
}
