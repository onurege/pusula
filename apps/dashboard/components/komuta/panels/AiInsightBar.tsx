export function AiInsightBar({ brief }: { brief: string }) {
  return (
    <div className="ai-insight">
      <div className="ai-icon">✨</div>
      <div className="ai-text">
        <div className="ai-title">UNIQUE AI · Bu Sabahın Yorumu</div>
        <div className="ai-body" dangerouslySetInnerHTML={{ __html: brief }} />
      </div>
    </div>
  );
}
