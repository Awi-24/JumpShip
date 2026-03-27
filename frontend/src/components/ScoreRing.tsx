interface ScoreRingProps {
  score: number;
}

export default function ScoreRing({ score }: ScoreRingProps) {
  const cls = score >= 80 ? 'high' : score >= 60 ? 'med' : 'low';
  return (
    <div className="match-score">
      <div
        className={`score-ring ${cls}`}
        style={{ '--pct': `${score * 3.6}deg` } as React.CSSProperties}
      >
        <span>{score}</span>
      </div>
      <span className="score-label">MATCH</span>
    </div>
  );
}
