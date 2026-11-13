import { useEffect, useMemo, useState } from 'react';
import type { PilotTelemetry } from '../lib/trackerLogic';

interface InteractiveTrajectoryGraphProps {
  clanData: PilotTelemetry[];
}

export function InteractiveTrajectoryGraph({ clanData }: InteractiveTrajectoryGraphProps) {
  const [selectedPilots, setSelectedPilots] = useState<string[]>(() =>
    clanData.slice(0, 4).map((d) => d.member.name)
  );

  useEffect(() => {
    if (selectedPilots.length === 0 && clanData.length > 0) {
      setSelectedPilots(clanData.slice(0, 4).map((d) => d.member.name));
    }
  }, [clanData, selectedPilots.length]);

  const togglePilot = (name: string) => {
    if (selectedPilots.includes(name)) {
      if (selectedPilots.length === 1) return;
      setSelectedPilots(selectedPilots.filter((n) => n !== name));
    } else {
      setSelectedPilots([...selectedPilots, name]);
    }
  };

  const lineColors = ['#ff1e66', '#ffd6e0', '#a78bfa', '#38bdf8', '#f59e0b'];

  const graphData = useMemo(() => {
    const filtered = clanData.filter((d) => selectedPilots.includes(d.member.name));
    let allTs: number[] = [];
    filtered.forEach((d) => {
      d.ratingHistory.forEach((c) => allTs.push(c.ratingUpdateTimeSeconds));
    });
    allTs = [...new Set(allTs)].sort((a, b) => a - b);

    if (!allTs.length) return { minR: 1000, maxR: 2600, series: [], allTs: [] };

    let minR = 9999;
    let maxR = 0;

    const series = filtered.map((d, i) => {
      const pts: { ts: number; r: number; contest: string }[] = [];
      d.ratingHistory.forEach((c) => {
        minR = Math.min(minR, c.newRating);
        maxR = Math.max(maxR, c.newRating);
        pts.push({ ts: c.ratingUpdateTimeSeconds, r: c.newRating, contest: c.contestName });
      });
      return { name: d.member.name, color: lineColors[i % lineColors.length], pts };
    });

    minR = Math.max(0, Math.floor((minR - 100) / 100) * 100);
    maxR = Math.ceil((maxR + 100) / 100) * 100;

    return { minR, maxR, series, allTs };
  }, [clanData, selectedPilots]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-mono text-[#8a6875]">TOGGLE TRAJECTORIES:</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {clanData.map((d) => {
            const active = selectedPilots.includes(d.member.name);
            return (
              <button
                type="button"
                key={d.member.name}
                onClick={() => togglePilot(d.member.name)}
                className={`px-3 py-1 rounded-xl text-xs font-mono transition-all ${
                  active
                    ? 'bg-wine-crimson text-white font-bold shadow-glow-ruby'
                    : 'bg-black/50 text-[#8a6875] border border-white/[0.05]'
                }`}
              >
                {d.member.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full h-72 sm:h-80 select-none">
        {graphData.series.length > 0 && graphData.allTs.length > 0 ? (
          (() => {
            const w = 840;
            const h = 280;
            const pad = { top: 20, right: 30, bottom: 30, left: 50 };
            const graphW = w - pad.left - pad.right;
            const graphH = h - pad.top - pad.bottom;

            const minTs = graphData.allTs[0];
            const maxTs = graphData.allTs[graphData.allTs.length - 1];
            const tsSpan = Math.max(1, maxTs - minTs);
            const rSpan = Math.max(1, graphData.maxR - graphData.minR);

            const getX = (ts: number) => pad.left + ((ts - minTs) / tsSpan) * graphW;
            const getY = (r: number) => pad.top + (1 - (r - graphData.minR) / rSpan) * graphH;

            return (
              <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full overflow-visible">
                {[0, 0.33, 0.66, 1].map((pct, idx) => {
                  const y = pad.top + pct * graphH;
                  const val = Math.round(graphData.maxR - pct * rSpan);
                  return (
                    <g key={idx}>
                      <line
                        x1={pad.left}
                        y1={y}
                        x2={w - pad.right}
                        y2={y}
                        stroke="rgba(255, 214, 224, 0.08)"
                        strokeDasharray="3 3"
                      />
                      <text
                        x={pad.left - 8}
                        y={y + 3}
                        textAnchor="end"
                        fill="#8a6875"
                        fontSize="10"
                        fontFamily="JetBrains Mono"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

                {graphData.series.map((s) => {
                  if (!s.pts.length) return null;
                  const dStr = s.pts
                    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(pt.ts)} ${getY(pt.r)}`)
                    .join(' ');
                  return (
                    <g key={s.name}>
                      <path
                        d={dStr}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {s.pts.map((pt, pIdx) => (
                        <circle key={pIdx} cx={getX(pt.ts)} cy={getY(pt.r)} r="3" fill={s.color}>
                          <title>{`${s.name}: ${pt.r} (${pt.contest})`}</title>
                        </circle>
                      ))}
                    </g>
                  );
                })}
              </svg>
            );
          })()
        ) : (
          <div className="h-full flex items-center justify-center text-xs font-mono text-[#8a6875]">
            Insufficient contest telemetry recorded.
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-6 pt-2 border-t border-white/[0.06] flex-wrap font-mono text-xs">
        {graphData.series.map((s) => (
          <div key={s.name} className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }}></span>
            <span className="text-white font-bold">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
