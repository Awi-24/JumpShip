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
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders core LLM fields when open', () => {
    render(<SettingsModal {...defaultProps} />);
    expect(screen.getByText(/LLM Provider/i)).toBeInTheDocument();
    expect(screen.getByText(/Assessment Speed/i)).toBeInTheDocument();
    expect(screen.getByText(/Resume Gen Threshold/i)).toBeInTheDocument();
    expect(screen.getByText('Test Connection')).toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    render(<SettingsModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button is clicked', () => {
    const { container } = render(<SettingsModal {...defaultProps} />);
    const closeBtn = container.querySelector('.modal-close');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
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
    expect(screen.getByPlaceholderText(/sk-/)).toBeInTheDocument();
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
