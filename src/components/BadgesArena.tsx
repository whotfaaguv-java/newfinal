import { Code2, Crown, Flame, Shield, Target, Zap } from 'lucide-react';
import type { PilotTelemetry } from '../lib/trackerLogic';

interface BadgesArenaProps {
  clanData: PilotTelemetry[];
  onSelectPilot: (pilot: PilotTelemetry) => void;
}

export function BadgesArena({ clanData, onSelectPilot }: BadgesArenaProps) {
  const badges = [
    {
      id: 'b1',
      title: 'Centurion Vanguard',
      desc: '100+ verified unique Codeforces solutions.',
      Icon: Target,
      unlocked: clanData.filter((d) => d.totalCFSolved >= 100),
    },
    {
      id: 'b2',
      title: 'Iron Streak',
      desc: 'Sustained consecutive problem solving streak of 5+ days.',
      Icon: Flame,
      unlocked: clanData.filter((d) => d.maxStreak >= 5),
    },
    {
      id: 'b3',
      title: 'Expert Stratum',
      desc: 'Achieved 1600+ peak rating on Codeforces.',
      Icon: Shield,
      unlocked: clanData.filter((d) => (d.cfProfile.maxRating || 0) >= 1600),
    },
    {
      id: 'b4',
      title: 'LeetCode Elite',
      desc: 'Solved 100+ problems on LeetCode matrix.',
      Icon: Code2,
      unlocked: clanData.filter((d) => d.lc.total >= 100),
    },
    {
      id: 'b5',
      title: 'Lightning Rapid',
      desc: 'Solved 5 or more problems within a single 24h window.',
      Icon: Zap,
      unlocked: clanData.filter(
        (d) => d.solvedToday >= 5 || Object.values(d.dailyCounts).some((c) => c >= 5)
      ),
    },
    {
      id: 'b6',
      title: 'Grandmaster Stratosphere',
      desc: 'Eclipsed the 2400+ rating zenith.',
      Icon: Crown,
      unlocked: clanData.filter((d) => (d.cfProfile.maxRating || 0) >= 2400),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {badges.map((b) => {
        const Icon = b.Icon;
        return (
          <div key={b.id} className="khojo-glass rounded-3xl p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-wine-flare to-wine-bordeaux flex items-center justify-center text-white shadow-glow-ruby">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-base">{b.title}</h4>
                  <span className="text-[10px] font-mono text-wine-flare">
                    {b.unlocked.length} Pilots Unlocked
                  </span>
                </div>
              </div>
              <p className="text-xs text-[#ab8d99] font-sans leading-relaxed">{b.desc}</p>
            </div>

            <div className="mt-6 pt-3 border-t border-white/[0.06] flex items-center gap-1.5 flex-wrap">
              {b.unlocked.length > 0 ? (
                b.unlocked.map((p) => (
                  <button
                    type="button"
                    key={p.member.name}
                    onClick={() => onSelectPilot(p)}
                    className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-black/50 text-wine-champagne border border-white/[0.08] hover:border-wine-flare cursor-pointer transition-colors"
                  >
                    {p.member.name}
                  </button>
                ))
              ) : (
                <span className="text-[10px] font-mono text-[#573d47]">Locked by all operatives</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
