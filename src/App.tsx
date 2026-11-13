import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Award,
  Calendar,
  Crosshair,
  Crown,
  Flame,
  LineChart,
  Radar,
  RefreshCw,
  Terminal,
  Trash2,
  Trophy,
  UserPlus,
} from 'lucide-react';
import { PrismStage } from './components/PrismStage';
import { WineNebulaCanvas } from './components/WineNebulaCanvas';
import { PilotHeatmapMatrix } from './components/PilotHeatmapMatrix';
import { InteractiveTrajectoryGraph } from './components/InteractiveTrajectoryGraph';
import { BadgesArena } from './components/BadgesArena';
import { ProfileDossierModal } from './components/ProfileDossierModal';
import {
  CACHE_EXPIRY,
  CACHE_KEY_DATA,
  CACHE_KEY_MEMBERS,
  computeSquadMetrics,
  computeSubmissionMetrics,
  DEFAULT_MEMBERS,
  getRankMeta,
  sortPilots,
  type CfProfile,
  type CfRatingPoint,
  type CfSubmission,
  type MemberConfig,
  type PilotTelemetry,
  type SortFilter,
} from './lib/trackerLogic';

let lastCfReq = 0;
async function fetchCodeforcesJson<T = unknown>(url: string): Promise<T> {
  const wait = Math.max(0, 2050 - (Date.now() - lastCfReq));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCfReq = Date.now();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Codeforces returned HTTP ${res.status}`);
    const j = await res.json();
    if (j.status !== 'OK') throw new Error(j.comment || 'Codeforces gateway error');
    return j as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithTimeout<T = unknown>(url: string, timeoutMs = 7000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function AnimatedNumber({ value }: { value: number | string | undefined }) {
  const [displayVal, setDisplayVal] = useState<number | string | undefined>(
    typeof value === 'number' ? 0 : value
  );

  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      setDisplayVal(value);
      return;
    }
    const duration = 1200;
    const startTime = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const progress = Math.max(0, Math.min(1, (now - startTime) / duration));
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setDisplayVal(Math.floor(easeOut * value));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDisplayVal(value);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value]);

  if (typeof displayVal === 'number') {
    return <span>{displayVal.toLocaleString()}</span>;
  }
  return <span>{displayVal ?? '—'}</span>;
}

export default function App() {
  const [members, setMembers] = useState<MemberConfig[]>(() => {
    try {
      const s = localStorage.getItem(CACHE_KEY_MEMBERS);
      if (!s) return DEFAULT_MEMBERS;
      const savedMembers = JSON.parse(s) as MemberConfig[];
      const gauravExists = savedMembers.some(
        (m) => (m.cf || '').toLowerCase() === 'whotfaagyv.java'
      );
      const gaurav = DEFAULT_MEMBERS.find((m) => m.cf === 'whotfaagyv.java');
      return gauravExists || !gaurav ? savedMembers : [...savedMembers, gaurav];
    } catch {
      return DEFAULT_MEMBERS;
    }
  });

  const [clanData, setClanData] = useState<PilotTelemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('Initializing Senior Khojo Neural Core...');
  const [selectedMember, setSelectedMember] = useState<PilotTelemetry | null>(null);
  const [activeFilter, setActiveFilter] = useState<SortFilter>('combined');
  const [activeSection, setActiveSection] = useState('hero');
  const [syncError, setSyncError] = useState('');

  // Operative Enrollment Form
  const [formName, setFormName] = useState('');
  const [formCf, setFormCf] = useState('');
  const [formLc, setFormLc] = useState('');
  const [formCc, setFormCc] = useState('');
  const [formError, setFormError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState<number | null>(null);

  const prismSlotRef = useRef<HTMLButtonElement | null>(null);
  const fetchRunIdRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(CACHE_KEY_MEMBERS, JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedMember(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Scroll Observer for Section Reveals & Spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            if (entry.target.id) setActiveSection(entry.target.id);
          }
        });
      },
      { threshold: 0.12 }
    );

    document.querySelectorAll('.reveal-section').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [clanData, loading]);

  const fetchTelemetry = async (force = false) => {
    const runId = ++fetchRunIdRef.current;

    if (!members.length) {
      setClanData([]);
      setLoading(false);
      return;
    }

    try {
      setSyncError('');
      if (!force) {
        const cached = localStorage.getItem(CACHE_KEY_DATA);
        if (cached) {
          const { timestamp, data } = JSON.parse(cached) as {
            timestamp: number;
            data: PilotTelemetry[];
          };
          if (Date.now() - timestamp < CACHE_EXPIRY && data.length === members.length) {
            setClanData(data);
            setLoading(false);
            return;
          }
        }
      }

      setRefreshing(true);
      setProgressMsg('Connecting to Codeforces, LeetCode & CodeChef Gateways...');

      const cfHandles = members.map((m) => m.cf).filter(Boolean);
      const cfProfiles: Record<string, CfProfile> = {};
      if (cfHandles.length > 0) {
        try {
          const j = await fetchCodeforcesJson<{ result: CfProfile[] }>(
            `https://codeforces.com/api/user.info?handles=${encodeURIComponent(
              cfHandles.join(';')
            )}`
          );
          j.result.forEach((u) => {
            cfProfiles[u.handle.toLowerCase()] = u;
          });
        } catch {
          // If one handle in batch is invalid, query individually so valid members succeed
          for (const h of cfHandles) {
            if (fetchRunIdRef.current !== runId) return;
            try {
              const single = await fetchCodeforcesJson<{ result: CfProfile[] }>(
                `https://codeforces.com/api/user.info?handles=${encodeURIComponent(h)}`
              );
              single.result.forEach((u) => {
                cfProfiles[u.handle.toLowerCase()] = u;
              });
            } catch {
              // Skip unavailable handle cleanly
            }
          }
        }
      }

      const aggregated: PilotTelemetry[] = [];

      for (let i = 0; i < members.length; i++) {
        if (fetchRunIdRef.current !== runId) return;
        const mem = members[i];
        setProgressMsg(`Synchronizing ${mem.name} (${i + 1}/${members.length})...`);

        const cfSubmissions: CfSubmission[] = [];
        let cfRatingHistory: CfRatingPoint[] = [];
        if (mem.cf) {
          try {
            let from = 1;
            const pageSize = 10000;
            while (true) {
              const subJ = await fetchCodeforcesJson<{ result: CfSubmission[] }>(
                `https://codeforces.com/api/user.status?handle=${encodeURIComponent(
                  mem.cf
                )}&from=${from}&count=${pageSize}`
              );
              cfSubmissions.push(...subJ.result);
              if (subJ.result.length < pageSize) break;
              from += subJ.result.length;
            }

            const ratJ = await fetchCodeforcesJson<{ result: CfRatingPoint[] }>(
              `https://codeforces.com/api/user.rating?handle=${encodeURIComponent(mem.cf)}`
            );
            cfRatingHistory = ratJ.result;
          } catch {
            // Preserve member in roster even if this handle returns an error
          }
        }

        const cfComputed = computeSubmissionMetrics(cfSubmissions, cfRatingHistory);

        // LeetCode
        let lcStats = { total: 0, easy: 0, medium: 0, hard: 0, rank: 'N/A' as number | string };
        if (mem.lc) {
          try {
            const lcJ = await fetchJsonWithTimeout<{
              status?: string;
              totalSolved?: number;
              easySolved?: number;
              mediumSolved?: number;
              hardSolved?: number;
              ranking?: number | string;
            }>(`https://leetcode-stats-api.herokuapp.com/${encodeURIComponent(mem.lc)}`);
            if (lcJ.status === 'success') {
              lcStats = {
                total: lcJ.totalSolved || 0,
                easy: lcJ.easySolved || 0,
                medium: lcJ.mediumSolved || 0,
                hard: lcJ.hardSolved || 0,
                rank: lcJ.ranking || 'N/A',
              };
            }
          } catch {
            // Optional platform fallback
          }
        }

        // CodeChef
        let ccStats = { rating: 0, stars: 'Unrated', rank: 'N/A' as number | string };
        if (mem.cc) {
          try {
            const ccJ = await fetchJsonWithTimeout<{
              currentRating?: number;
              rating?: number;
              stars?: string;
              globalRank?: number | string;
            }>(`https://codechef-api.vercel.app/handle/${encodeURIComponent(mem.cc)}`);
            if (ccJ && (ccJ.currentRating || ccJ.rating)) {
              ccStats = {
                rating: ccJ.currentRating || ccJ.rating || 0,
                stars: ccJ.stars || '1★',
                rank: ccJ.globalRank || 'N/A',
              };
            }
          } catch {
            // Optional platform fallback
          }
        }

        const cfProfile = (mem.cf && cfProfiles[mem.cf.toLowerCase()]) || {
          handle: mem.cf || 'N/A',
          rating: 0,
        };
        const combinedScore = cfComputed.totalCFSolved + lcStats.total;

        aggregated.push({
          member: mem,
          cfProfile,
          rankMeta: getRankMeta(cfProfile.rating),
          ...cfComputed,
          ratingHistory: cfRatingHistory,
          lc: lcStats,
          cc: ccStats,
          combinedScore,
        });
      }

      if (fetchRunIdRef.current !== runId) return;
      localStorage.setItem(
        CACHE_KEY_DATA,
        JSON.stringify({ timestamp: Date.now(), data: aggregated })
      );
      setClanData(aggregated);
    } catch (err) {
      if (fetchRunIdRef.current !== runId) return;
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Telemetry connection failed.';
      setSyncError(msg);
    } finally {
      if (fetchRunIdRef.current === runId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchTelemetry();
  }, [members]);

  const metrics = useMemo(() => computeSquadMetrics(clanData), [clanData]);
  const sortedPilots = useMemo(
    () => sortPilots(clanData, activeFilter),
    [clanData, activeFilter]
  );

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const cfHandle = formCf.trim();
    const name = formName.trim();
    if (!name || !cfHandle) {
      setFormError('Pilot name and Codeforces handle are required.');
      return;
    }

    if (members.some((m) => (m.cf || '').toLowerCase() === cfHandle.toLowerCase())) {
      setFormError('Pilot handle already exists in Senior Khojo roster.');
      return;
    }

    setFormSubmitting(true);
    try {
      await fetchCodeforcesJson(
        `https://codeforces.com/api/user.info?handles=${encodeURIComponent(cfHandle)}`
      );
    } catch (err) {
      setFormSubmitting(false);
      const msg = err instanceof Error ? err.message : 'Invalid handle';
      setFormError(`Invalid Codeforces handle: ${msg}`);
      return;
    }

    const updated: MemberConfig[] = [
      ...members,
      {
        name,
        cf: cfHandle,
        lc: formLc.trim() || cfHandle,
        cc: formCc.trim() || cfHandle,
      },
    ];

    setMembers(updated);
    setFormName('');
    setFormCf('');
    setFormLc('');
    setFormCc('');
    setFormSubmitting(false);
    localStorage.removeItem(CACHE_KEY_DATA);
  };

  const handleRemoveMember = (idx: number) => {
    if (members.length <= 1) {
      setFormError('Minimum 1 pilot required in roster.');
      return;
    }
    const updated = members.filter((_, i) => i !== idx);
    setMembers(updated);
    setConfirmRemoveIdx(null);
    localStorage.removeItem(CACHE_KEY_DATA);
  };

  const navItems = [
    { id: 'hero', label: 'Command', Icon: Radar },
    { id: 'podium', label: 'Roster', Icon: Trophy },
    { id: 'matrix', label: 'Grind Matrix', Icon: Calendar },
    { id: 'telemetry', label: 'Curves', Icon: Activity },
    { id: 'armory', label: 'Honor Arena', Icon: Award },
    { id: 'terminal', label: 'Pilot Terminal', Icon: Terminal },
  ];

  return (
    <div id="top" className="min-h-screen bg-[#030104] text-[#f1e4e9] relative overflow-x-hidden matrix-grid">
      <WineNebulaCanvas />
      <div className="ambient-glow top-[10%] left-[60%]"></div>
      <div className="ambient-glow top-[65%] left-[5%]"></div>

        {/* FLOATING EXECUTIVE HUD HEADER */}
        <header className="sticky top-4 z-40 max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="khojo-glass rounded-2xl px-5 py-3.5 flex items-center justify-between border-wine-flare/20 shadow-glow-wine">
            {/* Brand Logo */}
            <a href="#hero" className="flex items-center space-x-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-wine-flare via-wine-ruby to-noir p-[1px] shadow-glow-wine">
                <div className="w-full h-full bg-[#0a0209] rounded-xl flex items-center justify-center font-mono font-black text-wine-flare group-hover:scale-105 transition-transform">
                  SK
                </div>
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-black tracking-wider text-white text-base font-sans group-hover:text-wine-champagne transition-colors">
                    SENIOR KHOJO
                  </span>
                  <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-widest uppercase bg-wine-crimson/20 text-wine-flare rounded border border-wine-flare/30">
                    CORE v7.0
                  </span>
                </div>
                <p className="text-[10px] text-[#9c7885] font-mono tracking-tight flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-wine-flare animate-ping"></span>
                  TRI-PLATFORM RADAR &bull; {members.length} PILOTS ACTIVE
                </p>
              </div>
            </a>

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center space-x-1.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.06]">
              {navItems.map(({ id, label, Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                    activeSection === id
                      ? 'bg-gradient-to-r from-wine-velvet to-wine-bordeaux text-white border border-wine-flare/40 shadow-glow-wine'
                      : 'text-[#9c7885] hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </a>
              ))}
            </nav>

            {/* Sync Trigger */}
            <button
              type="button"
              onClick={() => fetchTelemetry(true)}
              disabled={refreshing}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-wine-ruby/30 to-wine-crimson/30 hover:from-wine-ruby/60 hover:to-wine-crimson/60 border border-wine-flare/40 font-mono text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-wine-flare' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'SYNCING...' : 'SYNC RADAR'}</span>
            </button>
          </div>
        </header>

        {/* MAIN CONTENT RUNWAY */}
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-24">
          {refreshing && (
            <div className="rounded-2xl border border-wine-flare/30 bg-wine-velvet/40 px-5 py-3 text-xs text-wine-champagne font-mono flex items-center justify-between">
              <span>{progressMsg}</span>
              <span className="text-[#9c7885]">Live API Sync</span>
            </div>
          )}

          {syncError && (
            <div className="rounded-2xl border border-wine-flare/40 bg-wine-abyss/80 px-5 py-3 text-sm text-wine-champagne font-mono flex items-center justify-between">
              <span>[TELEMETRY ALERT] {syncError}</span>
              <span className="text-xs text-[#9c7885]">Cached telemetry preserved</span>
            </div>
          )}

          {/* SECTION 1: HERO PULSE & 3D OPTICAL PRISM CORE */}
          <section id="hero" className="reveal-section revealed pt-8">
            <div className="khojo-glass rounded-3xl p-8 sm:p-12 relative overflow-hidden border-wine-flare/20">
              {/* Integrated 3D Glass Prism & Mouse-Steered Light Dispersion */}
              <PrismStage slotRef={prismSlotRef} />
              {/* Readability scrim on the left copy side */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-r from-[#09030b]/50 via-transparent to-transparent"
              />

              <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                {/* Left Column: Headlines */}
                <div className="lg:col-span-7 space-y-6">
                  <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-wine-velvet/80 border border-wine-flare/30 text-[11px] font-mono text-wine-champagne">
                    <span className="w-2 h-2 rounded-full bg-wine-flare animate-ping"></span>
                    <span>HIGH-FREQUENCY INTELLIGENCE CORE</span>
                  </div>

                  <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black font-sans tracking-tight text-white leading-[1.04]">
                    SENIOR <span className="wine-text-gradient">KHOJO</span>
                    <br />
                    <span className="text-2xl sm:text-4xl lg:text-5xl font-light italic font-serif text-[#ffd6e0]">
                      Never fall behind.
                    </span>
                  </h1>

                  <p className="text-sm sm:text-base text-[#ab8d99] max-w-xl font-sans leading-relaxed">
                    Unified tracking telemetry across Codeforces, LeetCode, and CodeChef. Real-time
                    velocity, interactive matrix streaks, and head-to-head trajectory analysis.
                  </p>

                  {/* Live Honor Tickers */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
                    {[
                      { label: 'TOTAL SOLVED', val: metrics?.totalAll },
                      {
                        label: '7-DAY PACE',
                        val: metrics?.sevenDaysAC ? `+${metrics.sevenDaysAC}` : '—',
                      },
                      { label: 'AVG CF RATING', val: metrics?.avgCFRating },
                      { label: 'PILOTS ONLINE', val: members.length },
                    ].map((item, i) => (
                      <div key={i} className="p-3.5 rounded-2xl bg-black/45 border border-white/[0.06] backdrop-blur-md">
                        <span className="block text-[10px] font-mono text-[#8a6875] tracking-wider uppercase">
                          {item.label}
                        </span>
                        <span className="text-2xl font-black font-mono text-white mt-1 block">
                          <AnimatedNumber value={item.val} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column: Interactive 3D Glass Prism Slot */}
                <div className="lg:col-span-5 flex flex-col items-center justify-center relative">
                  <button
                    ref={prismSlotRef}
                    type="button"
                    onClick={() => fetchTelemetry(true)}
                    aria-label="Synchronize radar telemetry"
                    className="group relative w-[240px] h-[240px] sm:w-[270px] sm:h-[270px] rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-[1.03] active:scale-95"
                  >
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-full border border-transparent group-hover:border-wine-flare/25 transition-colors"
                    />
                    <span className="sr-only">Synchronize radar telemetry</span>
                  </button>
                  <p className="text-xs font-mono text-[#8a6875] mt-5 flex items-center gap-1.5">
                    <Crosshair className="w-3.5 h-3.5 text-wine-flare" />
                    <span>OPTICAL PRISM CORE // CLICK TO SYNC</span>
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* SECTION 2: APEX PODIUM & MASTER ROSTER MATRIX */}
          <section id="podium" className="reveal-section space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 text-wine-flare text-xs font-mono uppercase tracking-widest font-bold">
                  <Crown className="w-4 h-4" />
                  <span>Apex Hierarchy</span>
                </div>
                <h2 className="text-3xl font-black text-white font-sans mt-1">
                  Hall of Champions & Master Roster
                </h2>
                <p className="text-xs font-mono text-[#9c7885] mt-0.5">
                  Click any pilot for full dossier analysis.
                </p>
              </div>

              {/* Filter Switcher */}
              <div className="flex items-center space-x-1.5 bg-black/50 p-1.5 rounded-xl border border-white/[0.06] text-xs font-mono">
                <span className="text-[11px] text-[#8a6875] px-2">SORT BY:</span>
                {(
                  [
                    { id: 'combined', label: 'Unified AC' },
                    { id: 'cf', label: 'CF Rating' },
                    { id: 'lc', label: 'LeetCode' },
                    { id: 'streak', label: 'Active Streak' },
                  ] as const
                ).map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    onClick={() => setActiveFilter(tab.id)}
                    className={`px-3 py-1 rounded-lg transition-all ${
                      activeFilter === tab.id
                        ? 'bg-wine-crimson text-white font-bold shadow-glow-ruby'
                        : 'text-[#9c7885] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3D Holographic Pedestals (Top 3) */}
            {clanData.length >= 3 &&
              (() => {
                const topThree = [...sortedPilots].slice(0, 3);
                const [first, second, third] = topThree;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                    {/* #2 Pedestal */}
                    <button
                      type="button"
                      onClick={() => setSelectedMember(second)}
                      className="order-2 md:order-1 khojo-glass rounded-3xl p-6 border-white/[0.08] hover:border-wine-flare/40 cursor-pointer relative group translate-y-3 text-center"
                    >
                      <div className="absolute top-3 right-5 font-mono font-black text-6xl text-white/[0.04]">
                        #02
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.1] flex items-center justify-center font-bold text-2xl text-white mb-3">
                          {second.member.name[0]}
                        </div>
                        <h4 className="font-bold text-white text-lg group-hover:text-wine-champagne transition-colors">
                          {second.member.name}
                        </h4>
                        <p className="text-xs font-mono text-[#8a6875]">@{second.member.cf}</p>
                        <div className="mt-4 px-3 py-1 rounded-full bg-black/40 border border-white/[0.08] text-xs font-mono text-wine-champagne">
                          {second.combinedScore} Unified Solved
                        </div>
                      </div>
                    </button>

                    {/* #1 Supreme Champion */}
                    <button
                      type="button"
                      onClick={() => setSelectedMember(first)}
                      className="order-1 md:order-2 khojo-glass rounded-3xl p-8 border-wine-flare/50 bg-gradient-to-b from-wine-ruby/30 via-wine-abyss/40 to-black cursor-pointer relative group -translate-y-2 shadow-glow-wine text-center"
                    >
                      <div className="absolute top-3 right-5 font-mono font-black text-7xl text-wine-flare/10">
                        #01
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <div className="relative mb-3">
                          <div className="absolute -inset-2 rounded-2xl bg-wine-flare/30 blur-md animate-pulse"></div>
                          <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-wine-crimson to-black border-2 border-wine-flare flex items-center justify-center font-black text-3xl text-white">
                            {first.member.name[0]}
                          </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full bg-wine-flare text-black font-mono text-[10px] font-black uppercase tracking-wider mb-1">
                          👑 Apex Titan
                        </span>
                        <h4 className="font-black text-white text-2xl group-hover:text-wine-champagne transition-colors">
                          {first.member.name}
                        </h4>
                        <p className="text-xs font-mono text-wine-rose">@{first.member.cf}</p>
                        <div className="mt-4 text-3xl font-mono font-black text-white">
                          {first.combinedScore}{' '}
                          <span className="text-xs font-normal text-[#8a6875]">AC</span>
                        </div>
                      </div>
                    </button>

                    {/* #3 Pedestal */}
                    <button
                      type="button"
                      onClick={() => setSelectedMember(third)}
                      className="order-3 khojo-glass rounded-3xl p-6 border-white/[0.08] hover:border-wine-flare/40 cursor-pointer relative group translate-y-5 text-center"
                    >
                      <div className="absolute top-3 right-5 font-mono font-black text-6xl text-white/[0.04]">
                        #03
                      </div>
                      <div className="flex flex-col items-center text-center">
                        <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.1] flex items-center justify-center font-bold text-2xl text-white mb-3">
                          {third.member.name[0]}
                        </div>
                        <h4 className="font-bold text-white text-lg group-hover:text-wine-champagne transition-colors">
                          {third.member.name}
                        </h4>
                        <p className="text-xs font-mono text-[#8a6875]">@{third.member.cf}</p>
                        <div className="mt-4 px-3 py-1 rounded-full bg-black/40 border border-white/[0.08] text-xs font-mono text-wine-champagne">
                          {third.combinedScore} Unified Solved
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })()}

            {/* Master Unified Interactive Table */}
            <div className="khojo-glass rounded-3xl overflow-hidden border-white/[0.08]">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-black/50 text-[#8a6875] uppercase text-[10px]">
                      <th className="py-4 px-5">Pilot</th>
                      <th className="py-4 px-4 text-center">CF Rating</th>
                      <th className="py-4 px-4 text-center">LeetCode AC</th>
                      <th className="py-4 px-4 text-center">CodeChef Stars</th>
                      <th className="py-4 px-4 text-center">Today</th>
                      <th className="py-4 px-4 text-center">7D Velocity</th>
                      <th className="py-4 px-4 text-center">Streak</th>
                      <th className="py-4 px-5 text-right">Unified Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {sortedPilots.map((p, idx) => (
                      <tr
                        key={p.member.name}
                        onClick={() => setSelectedMember(p)}
                        className="hover:bg-wine-crimson/[0.08] cursor-pointer transition-colors group"
                      >
                        <td className="py-4 px-5">
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-[#8a6875] text-xs">#{idx + 1}</span>
                            <div>
                              <span className="font-bold text-white group-hover:text-wine-flare transition-colors block text-sm">
                                {p.member.name}
                              </span>
                              <span className="text-[10px] text-[#8a6875]">CF: @{p.member.cf}</span>
                            </div>
                          </div>
                        </td>

                        <td
                          className="py-4 px-4 text-center font-bold"
                          style={{ color: p.rankMeta.color }}
                        >
                          {p.cfProfile.rating
                            ? `${p.cfProfile.rating} (${p.rankMeta.name})`
                            : 'Unrated'}
                        </td>

                        <td className="py-4 px-4 text-center">
                          <span className="text-wine-champagne font-bold">
                            {p.lc.total > 0 ? `${p.lc.total} AC` : '—'}
                          </span>
                          {p.lc.total > 0 && (
                            <span className="block text-[10px] text-[#8a6875]">
                              Rank: #{p.lc.rank}
                            </span>
                          )}
                        </td>

                        <td className="py-4 px-4 text-center font-bold text-wine-rose">
                          {p.cc.stars !== 'Unrated' ? p.cc.stars : '—'}
                        </td>

                        <td className="py-4 px-4 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${
                              p.solvedToday > 0
                                ? 'bg-wine-flare text-black shadow-glow-ruby'
                                : 'text-[#8a6875]'
                            }`}
                          >
                            {p.solvedToday > 0 ? `+${p.solvedToday}` : '0'}
                          </span>
                        </td>

                        <td className="py-4 px-4 text-center font-bold text-wine-champagne">
                          +{p.solved7d}
                        </td>

                        <td className="py-4 px-4 text-center font-mono">
                          {p.currentStreak > 0 ? (
                            <span className="text-wine-flare font-bold">
                              {p.currentStreak}d 🔥
                            </span>
                          ) : (
                            <span className="text-[#8a6875]">—</span>
                          )}
                        </td>

                        <td className="py-4 px-5 text-right font-black text-white text-sm">
                          {p.combinedScore}
                        </td>
                      </tr>
                    ))}
                    {sortedPilots.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-[#8a6875]">
                          {loading
                            ? progressMsg
                            : 'No telemetry records yet. Click SYNC RADAR to fetch live stats.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* SECTION 3: GRIND MATRIX & 180-DAY HEATMAP */}
          <section id="matrix" className="reveal-section space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 text-wine-flare text-xs font-mono uppercase tracking-widest font-bold">
                  <Flame className="w-4 h-4" />
                  <span>Temporal Matrix</span>
                </div>
                <h2 className="text-3xl font-black text-white font-sans mt-1">
                  180-Day Grind Telemetry
                </h2>
                <p className="text-xs font-mono text-[#9c7885] mt-0.5">
                  Continuous visual tracking for individual grind patterns.
                </p>
              </div>
            </div>

            <div className="khojo-glass rounded-3xl p-6 sm:p-8 space-y-6">
              <PilotHeatmapMatrix clanData={clanData} />
            </div>
          </section>

          {/* SECTION 4: TRAJECTORY TELEMETRY CURVES */}
          <section id="telemetry" className="reveal-section space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 text-wine-flare text-xs font-mono uppercase tracking-widest font-bold">
                  <LineChart className="w-4 h-4" />
                  <span>Trajectory Tracking</span>
                </div>
                <h2 className="text-3xl font-black text-white font-sans mt-1">
                  Head-to-Head Rating Curves
                </h2>
                <p className="text-xs font-mono text-[#9c7885] mt-0.5">
                  Historical Codeforces contest swings traced over time.
                </p>
              </div>
            </div>

            <div className="khojo-glass rounded-3xl p-6 sm:p-8">
              <InteractiveTrajectoryGraph clanData={clanData} />
            </div>
          </section>

          {/* SECTION 5: ARSENAL & HONOR ARENA (BADGES) */}
          <section id="armory" className="reveal-section space-y-6">
            <div>
              <div className="flex items-center space-x-2 text-wine-flare text-xs font-mono uppercase tracking-widest font-bold">
                <Award className="w-4 h-4" />
                <span>Achievements</span>
              </div>
              <h2 className="text-3xl font-black text-white font-sans mt-1">
                Senior Khojo Honor Arena
              </h2>
              <p className="text-xs font-mono text-[#9c7885] mt-0.5">
                Gamified achievements calculated from multi-platform verified telemetry.
              </p>
            </div>

            <BadgesArena clanData={clanData} onSelectPilot={setSelectedMember} />
          </section>

          {/* SECTION 6: PILOT MANAGEMENT TERMINAL */}
          <section id="terminal" className="reveal-section space-y-6">
            <div>
              <div className="flex items-center space-x-2 text-wine-flare text-xs font-mono uppercase tracking-widest font-bold">
                <Terminal className="w-4 h-4" />
                <span>Pilot Flight Deck</span>
              </div>
              <h2 className="text-3xl font-black text-white font-sans mt-1">
                Operative Enrollment & Control
              </h2>
              <p className="text-xs font-mono text-[#9c7885] mt-0.5">
                Manage pilots authorized into Senior Khojo core.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Form */}
              <form
                onSubmit={handleAddMember}
                className="lg:col-span-5 khojo-glass rounded-3xl p-6 space-y-4"
              >
                <h3 className="text-xs font-mono uppercase tracking-wider text-wine-flare font-bold flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  <span>Enroll Operative</span>
                </h3>

                {formError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-wine-flare/50 bg-wine-abyss/80 px-3 py-2 text-xs font-mono text-wine-champagne"
                  >
                    {formError}
                  </div>
                )}

                <div className="space-y-3 font-mono text-xs">
                  <div>
                    <label htmlFor="pilot-name" className="text-[#8a6875] block mb-1">
                      Pilot Name
                    </label>
                    <input
                      id="pilot-name"
                      type="text"
                      required
                      placeholder="e.g. Rahul"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-wine-flare"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-cf" className="text-[#8a6875] block mb-1">
                      Codeforces Handle
                    </label>
                    <input
                      id="pilot-cf"
                      type="text"
                      required
                      placeholder="e.g. tourist"
                      value={formCf}
                      onChange={(e) => setFormCf(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-wine-flare"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-lc" className="text-[#8a6875] block mb-1">
                      LeetCode Username
                    </label>
                    <input
                      id="pilot-lc"
                      type="text"
                      placeholder="Leave blank if same as CF"
                      value={formLc}
                      onChange={(e) => setFormLc(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-wine-flare"
                    />
                  </div>
                  <div>
                    <label htmlFor="pilot-cc" className="text-[#8a6875] block mb-1">
                      CodeChef Handle
                    </label>
                    <input
                      id="pilot-cc"
                      type="text"
                      placeholder="Leave blank if same as CF"
                      value={formCc}
                      onChange={(e) => setFormCc(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-wine-flare"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-wine-ruby to-wine-crimson hover:from-wine-crimson hover:to-wine-flare text-white font-mono text-xs font-bold transition-all shadow-glow-ruby disabled:opacity-50"
                >
                  {formSubmitting ? 'VERIFYING HANDLE...' : '+ AUTHORIZE OPERATIVE'}
                </button>
              </form>

              {/* Pilot Card Roster */}
              <div className="lg:col-span-7 khojo-glass rounded-3xl p-6 divide-y divide-white/[0.04]">
                <h3 className="text-xs font-mono uppercase tracking-wider text-white font-bold mb-4 flex items-center justify-between">
                  <span>Authorized Operatives ({members.length})</span>
                  <span className="text-[10px] text-[#8a6875]">RADAR CONNECTED</span>
                </h3>

                <div className="space-y-3 pt-2">
                  {members.map((m, idx) => (
                    <div
                      key={`${m.name}-${m.cf}`}
                      className="py-2.5 flex items-center justify-between font-mono text-xs gap-3"
                    >
                      <div>
                        <p className="font-bold text-white text-sm">{m.name}</p>
                        <p className="text-[10px] text-[#8a6875] mt-0.5">
                          CF: <span className="text-wine-flare">@{m.cf}</span> &bull; LC:{' '}
                          <span className="text-wine-champagne">@{m.lc || '—'}</span> &bull; CC:{' '}
                          <span className="text-wine-rose">@{m.cc || '—'}</span>
                        </p>
                      </div>
                      {confirmRemoveIdx === idx ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(idx)}
                            className="px-2.5 py-1 rounded-lg bg-wine-crimson text-white text-[10px] font-bold"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveIdx(null)}
                            className="px-2 py-1 rounded-lg bg-white/[0.06] text-[#a1a1a1] text-[10px]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveIdx(idx)}
                          className="p-2 text-[#8a6875] hover:text-wine-flare transition-colors"
                          aria-label={`Revoke ${m.name} authorization`}
                          title="Revoke pilot authorization"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* FOOTER */}
        <footer className="relative z-10 border-t border-white/[0.06] mt-24 py-8 bg-black/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-[#8a6875]">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-white">SENIOR KHOJO</span>
              <span>// APEX TRI-PLATFORM COMMAND</span>
            </div>
            <div>DATA TRANSMITTED VIA CODEFORCES, LEETCODE & CODECHEF GATEWAYS</div>
          </div>
        </footer>

      {/* PROFILE DOSSIER MODAL */}
      <ProfileDossierModal member={selectedMember} onClose={() => setSelectedMember(null)} />
    </div>
  );
}
