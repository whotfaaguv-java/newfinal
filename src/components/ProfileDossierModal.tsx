import { X } from 'lucide-react';
import type { PilotTelemetry } from '../lib/trackerLogic';

interface ProfileDossierModalProps {
  member: PilotTelemetry | null;
  onClose: () => void;
}

export function ProfileDossierModal({ member, onClose }: ProfileDossierModalProps) {
  if (!member) return null;
  const {
    member: m,
    cfProfile,
    rankMeta,
    totalCFSolved,
    solvedToday,
    solved7d,
    currentStreak,
    lc,
    cc,
    recentAccepted,
    ratingHistory,
  } = member;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${m.name} Dossier`}
    >
      <div
        className="khojo-glass relative w-full max-w-3xl max-h-[90vh] rounded-3xl overflow-hidden flex flex-col border-wine-flare/40 shadow-glow-wine"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-wine-velvet via-noir to-noir border-b border-white/[0.08] flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-black text-white">{m.name}</h3>
            <p className="text-xs font-mono text-[#8a6875] mt-1">
              CF: <span className="text-wine-flare">@{m.cf}</span> &bull; LC:{' '}
              <span className="text-wine-champagne">@{m.lc || 'N/A'}</span> &bull; CC:{' '}
              <span className="text-wine-rose">@{m.cc || 'N/A'}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dossier"
            className="p-2 rounded-xl bg-white/[0.05] text-[#8a6875] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Tri-Platform Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs">
            <div className="p-4 rounded-2xl bg-black/40 border border-wine-flare/20">
              <span className="text-[10px] text-wine-flare uppercase font-bold block mb-1">
                Codeforces
              </span>
              <span className="text-xl font-bold text-white">{cfProfile.rating || 0}</span>
              <span className="block text-[10px] font-bold mt-0.5" style={{ color: rankMeta.color }}>
                {rankMeta.name}
              </span>
              <span className="block text-[#8a6875] mt-2">Solved: {totalCFSolved}</span>
            </div>

            <div className="p-4 rounded-2xl bg-black/40 border border-wine-champagne/20">
              <span className="text-[10px] text-wine-champagne uppercase font-bold block mb-1">
                LeetCode
              </span>
              <span className="text-xl font-bold text-white">{lc.total} AC</span>
              <span className="block text-[10px] text-[#8a6875] mt-0.5">Rank: #{lc.rank}</span>
              <span className="block text-[#8a6875] mt-2">
                E:{lc.easy} M:{lc.medium} H:{lc.hard}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-black/40 border border-wine-rose/20">
              <span className="text-[10px] text-wine-rose uppercase font-bold block mb-1">
                CodeChef
              </span>
              <span className="text-xl font-bold text-white">{cc.stars}</span>
              <span className="block text-[10px] text-[#8a6875] mt-0.5">Rating: {cc.rating}</span>
              <span className="block text-[#8a6875] mt-2">Global: #{cc.rank}</span>
            </div>
          </div>

          {/* Solved Velocity */}
          <div className="grid grid-cols-3 gap-3 font-mono text-xs text-center">
            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.05]">
              <span className="text-[#8a6875] text-[10px] block">TODAY</span>
              <span className="text-lg font-bold text-wine-flare">+{solvedToday}</span>
            </div>
            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.05]">
              <span className="text-[#8a6875] text-[10px] block">7-DAY PACE</span>
              <span className="text-lg font-bold text-wine-champagne">+{solved7d}</span>
            </div>
            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/[0.05]">
              <span className="text-[#8a6875] text-[10px] block">STREAK</span>
              <span className="text-lg font-bold text-white">{currentStreak}d 🔥</span>
            </div>
          </div>

          {/* Recent Solutions */}
          <div>
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-wine-flare mb-2">
              Recent Codeforces Accepted
            </h4>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {recentAccepted.slice(0, 8).map((sub, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-xl bg-black/40 border border-white/[0.04] flex items-center justify-between text-xs font-mono"
                >
                  <a
                    href={`https://codeforces.com/contest/${sub.problem?.contestId}/problem/${sub.problem?.index}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-white hover:text-wine-flare font-sans truncate max-w-[280px]"
                  >
                    {sub.problem?.contestId}
                    {sub.problem?.index} - {sub.problem?.name}
                  </a>
                  {sub.problem?.rating && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-wine-velvet text-wine-champagne border border-wine-flare/30">
                      ★ {sub.problem.rating}
                    </span>
                  )}
                </div>
              ))}
              {recentAccepted.length === 0 && (
                <p className="text-xs font-mono text-[#8a6875]">No accepted submissions loaded.</p>
              )}
            </div>
          </div>

          {/* Contest Swings */}
          {ratingHistory.length > 0 && (
            <div>
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-wine-champagne mb-2">
                Recent Contest Swings
              </h4>
              <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                {[...ratingHistory]
                  .reverse()
                  .slice(0, 4)
                  .map((c) => {
                    const delta = c.newRating - c.oldRating;
                    return (
                      <div
                        key={c.contestId}
                        className="p-2.5 rounded-xl bg-black/40 border border-white/[0.04] flex items-center justify-between text-xs font-mono"
                      >
                        <span className="truncate max-w-[280px] font-sans text-white">
                          {c.contestName}
                        </span>
                        <span
                          className={`font-bold ${
                            delta >= 0 ? 'text-wine-flare' : 'text-[#8a6875]'
                          }`}
                        >
                          {delta >= 0 ? `+${delta}` : delta} ({c.newRating})
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-black/60 border-t border-white/[0.06] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/[0.06] text-xs font-mono text-white hover:bg-wine-crimson transition-colors"
          >
            CLOSE DOSSIER
          </button>
        </div>
      </div>
    </div>
  );
}
