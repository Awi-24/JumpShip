import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ScoreRing from '../../components/ScoreRing';

describe('ScoreRing', () => {
  it('renders the score value', () => {
    render(<ScoreRing score={85} />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('MATCH')).toBeInTheDocument();
  });

  it('applies high class for score >= 80', () => {
    const { container } = render(<ScoreRing score={90} />);
    expect(container.querySelector('.score-ring.high')).toBeTruthy();
  });

  it('applies med class for score >= 60 and < 80', () => {
    const { container } = render(<ScoreRing score={70} />);
    expect(container.querySelector('.score-ring.med')).toBeTruthy();
  });

  it('applies low class for score < 60', () => {
    const { container } = render(<ScoreRing score={45} />);
    expect(container.querySelector('.score-ring.low')).toBeTruthy();
  });

  it('renders score 0 correctly', () => {
    render(<ScoreRing score={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders score 100 with high class', () => {
    const { container } = render(<ScoreRing score={100} />);
    expect(container.querySelector('.score-ring.high')).toBeTruthy();
  });
});
