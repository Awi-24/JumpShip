import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsModal from '../../components/SettingsModal';
import { DEFAULT_SETTINGS } from '../../hooks/useSettings';

describe('SettingsModal', () => {
  const defaultProps = {
    open: true,
    initial: { ...DEFAULT_SETTINGS },
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open=false', () => {
    render(<SettingsModal {...defaultProps} open={false} />);
    expect(screen.queryByRole('heading', { name: /settings/i })).toBeNull();
  });

  it('renders settings title and provider field', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByText(/^Provider$/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onSave with updated settings on Save', () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Save Settings'));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows API key input for cloud providers', () => {
    render(<SettingsModal {...defaultProps} initial={{ ...DEFAULT_SETTINGS, llmProvider: 'openai', llmModel: 'gpt-4o' }} />);
    expect(screen.getByPlaceholderText(/sk-\.\.\./)).toBeInTheDocument();
  });

  it('shows Base URL input for local providers', () => {
    render(<SettingsModal {...defaultProps} initial={{ ...DEFAULT_SETTINGS, llmProvider: 'ollama' }} />);
    expect(screen.getByPlaceholderText(/localhost:11434/)).toBeInTheDocument();
  });

  it('closes on backdrop click', () => {
    const { container } = render(<SettingsModal {...defaultProps} />);
    fireEvent.click(container.querySelector('.modal-backdrop')!);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
