import { useMemo, useState } from 'react';
import { localDateKey, type PilotTelemetry } from '../lib/trackerLogic';

interface PilotHeatmapMatrixProps {
  clanData: PilotTelemetry[];
}

export function PilotHeatmapMatrix({ clanData }: PilotHeatmapMatrixProps) {
  const [selectedPilotName, setSelectedPilotName] = useState(clanData[0]?.member.name || '');

  const target = useMemo(() => {
    return clanData.find((d) => d.member.name === selectedPilotName) || clanData[0];
  }, [clanData, selectedPilotName]);

  const past180Days = useMemo(() => {
    const days: string[] = [];
    const today = new Date();
    for (let i = 179; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      d.setDate(d.getDate() - i);
      days.push(localDateKey(d));
    }
    return days;
  }, []);

  if (!clanData.length) {
    return (
      <div className="py-12 text-center font-mono text-xs text-[#8a6875]">
        Synchronizing 180-day matrix telemetry...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <span className="text-xs font-mono text-[#8a6875]">ACTIVE PILOT:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {clanData.map((d) => (
              <button
                type="button"
                key={d.member.name}
                onClick={() => setSelectedPilotName(d.member.name)}
                className={`px-3 py-1 rounded-xl text-xs font-mono transition-all ${
                  target?.member.name === d.member.name
                    ? 'bg-wine-flare text-black font-bold shadow-glow-ruby'
                    : 'bg-black/50 text-[#8a6875] hover:text-white border border-white/[0.05]'
                }`}
              >
                {d.member.name}
              </button>
            ))}
          </div>
        </div>

        {target && (
          <div className="flex items-center space-x-4 font-mono text-xs">
            <div>
              <span className="text-[#8a6875]">CURRENT STREAK:</span>{' '}
              <span className="font-bold text-wine-flare">{target.currentStreak} Days</span>
            </div>
            <div>
              <span className="text-[#8a6875]">PEAK STREAK:</span>{' '}
              <span className="font-bold text-white">{target.maxStreak} Days</span>
            </div>
          </div>
        )}
      </div>

      {target && (
        <div>
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-1.5 min-w-[720px]">
              {Array.from({ length: Math.ceil(past180Days.length / 7) }).map((_, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-1.5">
                  {Array.from({ length: 7 }).map((__, rowIdx) => {
                    const idx = colIdx * 7 + rowIdx;
                    if (idx >= past180Days.length) return null;
                    const dateKey = past180Days[idx];
                    const cnt = target.dailyCounts[dateKey] || 0;

                    let bg = 'bg-white/[0.03] border border-white/[0.02]';
                    if (cnt >= 6) bg = 'bg-wine-flare shadow-glow-ruby border-white';
                    else if (cnt >= 3) bg = 'bg-wine-crimson border-wine-flare/40';
                    else if (cnt >= 1) bg = 'bg-wine-velvet border-wine-ruby/50';

                    return (
                      <div
                        key={dateKey}
                        title={`${dateKey}: ${cnt} solved`}
                        className={`w-3.5 h-3.5 rounded-sm transition-transform hover:scale-150 cursor-pointer ${bg}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs font-mono text-[#8a6875] pt-4 border-t border-white/[0.06]">
            <span>180 Days Chronological Activity</span>
            <div className="flex items-center space-x-2">
              <span className="text-[10px]">Zero</span>
              <span className="w-3 h-3 rounded-sm bg-white/[0.03]"></span>
              <span className="w-3 h-3 rounded-sm bg-wine-velvet"></span>
              <span className="w-3 h-3 rounded-sm bg-wine-crimson"></span>
              <span className="w-3 h-3 rounded-sm bg-wine-flare"></span>
              <span className="text-[10px]">High</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
