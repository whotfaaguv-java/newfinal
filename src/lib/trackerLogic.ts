export interface MemberConfig {
  name: string;
  cf: string;
  lc: string;
  cc: string;
}

export interface CfRankMeta {
  name: string;
  color: string;
}

export interface CfProfile {
  handle: string;
  rating?: number;
  maxRating?: number;
}

export interface CfSubmission {
  verdict?: string;
  creationTimeSeconds: number;
  problem?: {
    contestId?: number;
    index: string;
    name: string;
    rating?: number;
  };
}

export interface CfRatingPoint {
  contestId: number;
  contestName: string;
  oldRating: number;
  newRating: number;
  ratingUpdateTimeSeconds: number;
}

export interface LcStats {
  total: number;
  easy: number;
  medium: number;
  hard: number;
  rank: number | string;
}

export interface CcStats {
  rating: number;
  stars: string;
  rank: number | string;
}

export interface PilotTelemetry {
  member: MemberConfig;
  cfProfile: CfProfile;
  rankMeta: CfRankMeta;
  totalCFSolved: number;
  solvedToday: number;
  solved7d: number;
  solved30d: number;
  ratingChange: number;
  currentStreak: number;
  maxStreak: number;
  dailyCounts: Record<string, number>;
  recentAccepted: CfSubmission[];
  ratingHistory: CfRatingPoint[];
  lc: LcStats;
  cc: CcStats;
  combinedScore: number;
}

export type SortFilter = 'combined' | 'cf' | 'lc' | 'streak';

export const DEFAULT_MEMBERS: MemberConfig[] = [
  { name: 'Arjun', cf: 'Arjun_7015', lc: 'Arjun_7015', cc: 'arjun_7015' },
  { name: 'Kalpy', cf: 'kalpy', lc: 'kalpy', cc: 'kalpy' },
  { name: 'Bhavishya', cf: 'bhavishya4208', lc: 'bhavishya4208', cc: 'bhavishya4208' },
  { name: 'Pritish', cf: 'pritishbaid', lc: 'pritishbaid', cc: 'pritishbaid' },
  { name: 'Pulkit', cf: 'PulkitDaddy', lc: 'PulkitDaddy', cc: 'pulkitdaddy' },
  { name: 'Sahil', cf: 'sahildewy19', lc: 'sahildewy19', cc: 'sahildewy19' },
  { name: 'Gaurav', cf: 'whotfaagyv.java', lc: '', cc: '' },
];

export const CACHE_KEY_MEMBERS = 'KHOJO_MEMBERS_V7';
export const CACHE_KEY_DATA = 'KHOJO_DATA_V7';
export const CACHE_EXPIRY = 5 * 60 * 1000;

export const CF_RANKS = [
  { min: 0, max: 1199, name: 'Newbie', color: '#9e8590' },
  { min: 1200, max: 1399, name: 'Pupil', color: '#56c271' },
  { min: 1400, max: 1599, name: 'Specialist', color: '#38bdf8' },
  { min: 1600, max: 1899, name: 'Expert', color: '#a78bfa' },
  { min: 1900, max: 2199, name: 'Candidate Master', color: '#f472b6' },
  { min: 2200, max: 2299, name: 'Master', color: '#fb923c' },
  { min: 2300, max: 2399, name: 'International Master', color: '#f97316' },
  { min: 2400, max: 2999, name: 'Grandmaster', color: '#ff1e66' },
  { min: 3000, max: 9999, name: 'Legendary GM', color: '#ff0044' },
];

export function getRankMeta(rating?: number): CfRankMeta {
  if (!rating || rating <= 0) return { name: 'Unrated', color: '#7a606a' };
  return CF_RANKS.find((r) => rating >= r.min && rating <= r.max) || CF_RANKS[0];
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateKeyOrdinal(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function computeSubmissionMetrics(
  cfSubmissions: CfSubmission[],
  cfRatingHistory: CfRatingPoint[],
  now = new Date()
) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 29);

  const todayStartTs = Math.floor(todayStart.getTime() / 1000);
  const weekStartTs = Math.floor(weekStart.getTime() / 1000);
  const monthStartTs = Math.floor(monthStart.getTime() / 1000);

  const uniqueProblemsMap = new Map<string, CfSubmission>();
  const dailyCounts: Record<string, number> = {};

  const acceptedCF = cfSubmissions.filter((s) => s.verdict === 'OK');
  acceptedCF.sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds);

  acceptedCF.forEach((sub) => {
    if (!sub.problem || !sub.problem.contestId) return;
    const key = `${sub.problem.contestId}-${sub.problem.index}`;
    if (!uniqueProblemsMap.has(key)) {
      uniqueProblemsMap.set(key, sub);
      const dStr = localDateKey(new Date(sub.creationTimeSeconds * 1000));
      dailyCounts[dStr] = (dailyCounts[dStr] || 0) + 1;
    }
  });

  let solvedToday = 0;
  let solved7d = 0;
  let solved30d = 0;

  uniqueProblemsMap.forEach((sub) => {
    const ts = sub.creationTimeSeconds;
    if (ts >= todayStartTs) solvedToday++;
    if (ts >= weekStartTs) solved7d++;
    if (ts >= monthStartTs) solved30d++;
  });

  const activeDays = Object.keys(dailyCounts)
    .filter((k) => dailyCounts[k] > 0)
    .sort();
  let currentStreak = 0;
  let maxStreak = 0;
  let counter = 0;

  for (let d = 0; d < activeDays.length; d++) {
    if (d === 0 || dateKeyOrdinal(activeDays[d]) - dateKeyOrdinal(activeDays[d - 1]) === 1) {
      counter++;
    } else {
      counter = 1;
    }
    maxStreak = Math.max(maxStreak, counter);
  }

  const todayKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);
  const streakAnchor = dailyCounts[todayKey] ? todayKey : yesterdayKey;

  if (dailyCounts[streakAnchor]) {
    currentStreak = 1;
    const cursor = new Date(`${streakAnchor}T12:00:00`);
    while (true) {
      cursor.setDate(cursor.getDate() - 1);
      if (!dailyCounts[localDateKey(cursor)]) break;
      currentStreak++;
    }
  }

  let ratingChange = 0;
  if (cfRatingHistory.length > 0) {
    const last = cfRatingHistory[cfRatingHistory.length - 1];
    ratingChange = last.newRating - last.oldRating;
  }

  return {
    totalCFSolved: uniqueProblemsMap.size,
    solvedToday,
    solved7d,
    solved30d,
    ratingChange,
    currentStreak,
    maxStreak,
    dailyCounts,
    recentAccepted: [...uniqueProblemsMap.values()].slice(-15).reverse(),
  };
}

export function sortPilots(clanData: PilotTelemetry[], activeFilter: SortFilter): PilotTelemetry[] {
  return [...clanData].sort((a, b) => {
    if (activeFilter === 'combined') return b.combinedScore - a.combinedScore;
    if (activeFilter === 'cf') return (b.cfProfile.rating || 0) - (a.cfProfile.rating || 0);
    if (activeFilter === 'lc') return b.lc.total - a.lc.total;
    if (activeFilter === 'streak') return b.currentStreak - a.currentStreak;
    return 0;
  });
}

export function computeSquadMetrics(clanData: PilotTelemetry[]) {
  if (!clanData.length) return null;
  const totalCF = clanData.reduce((acc, m) => acc + m.totalCFSolved, 0);
  const totalLC = clanData.reduce((acc, m) => acc + m.lc.total, 0);
  const totalAll = totalCF + totalLC;
  const todayAC = clanData.reduce((acc, m) => acc + m.solvedToday, 0);
  const sevenDaysAC = clanData.reduce((acc, m) => acc + m.solved7d, 0);

  const ratedCF = clanData.filter((m) => m.cfProfile.rating);
  const avgCFRating =
    ratedCF.length > 0
      ? Math.round(ratedCF.reduce((a, b) => a + (b.cfProfile.rating || 0), 0) / ratedCF.length)
      : 0;

  const dailyVanguard = [...clanData].sort((a, b) => b.solvedToday - a.solvedToday)[0];
  const weeklyGrinder = [...clanData].sort((a, b) => b.solved7d - a.solved7d)[0];
  const apexPilot = [...clanData].sort(
    (a, b) => (b.cfProfile.rating || 0) - (a.cfProfile.rating || 0)
  )[0];
  const streakTitan = [...clanData].sort((a, b) => b.currentStreak - a.currentStreak)[0];

  return {
    totalCF,
    totalLC,
    totalAll,
    todayAC,
    sevenDaysAC,
    avgCFRating,
    dailyVanguard: dailyVanguard && dailyVanguard.solvedToday > 0 ? dailyVanguard : null,
    weeklyGrinder: weeklyGrinder && weeklyGrinder.solved7d > 0 ? weeklyGrinder : null,
    apexPilot,
    streakTitan: streakTitan && streakTitan.currentStreak > 0 ? streakTitan : null,
  };
}
