import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSquadMetrics,
  computeSubmissionMetrics,
  getRankMeta,
  localDateKey,
  sortPilots,
  type PilotTelemetry,
} from './trackerLogic';

test('getRankMeta maps ratings to correct Codeforces tiers', () => {
  assert.equal(getRankMeta(0).name, 'Unrated');
  assert.equal(getRankMeta(1100).name, 'Newbie');
  assert.equal(getRankMeta(1450).name, 'Specialist');
  assert.equal(getRankMeta(1750).name, 'Expert');
  assert.equal(getRankMeta(2450).name, 'Grandmaster');
});

test('computeSubmissionMetrics deduplicates problems and computes streaks', () => {
  const now = new Date('2026-11-13T12:00:00');
  const day0 = Math.floor(new Date('2026-11-13T09:00:00').getTime() / 1000);
  const day1 = Math.floor(new Date('2026-11-12T15:00:00').getTime() / 1000);
  const day2 = Math.floor(new Date('2026-11-11T10:00:00').getTime() / 1000);

  const subs = [
    { verdict: 'OK', creationTimeSeconds: day2, problem: { contestId: 100, index: 'A', name: 'One' } },
    { verdict: 'WRONG_ANSWER', creationTimeSeconds: day1, problem: { contestId: 100, index: 'B', name: 'Two' } },
    { verdict: 'OK', creationTimeSeconds: day1, problem: { contestId: 100, index: 'B', name: 'Two' } },
    // Duplicate OK for same problem should not double count
    { verdict: 'OK', creationTimeSeconds: day0, problem: { contestId: 100, index: 'B', name: 'Two' } },
    { verdict: 'OK', creationTimeSeconds: day0 + 60, problem: { contestId: 101, index: 'C', name: 'Three' } },
  ];

  const ratings = [
    { contestId: 100, contestName: 'Round 1', oldRating: 1400, newRating: 1485, ratingUpdateTimeSeconds: day1 },
  ];

  const res = computeSubmissionMetrics(subs, ratings, now);
  assert.equal(res.totalCFSolved, 3);
  assert.equal(res.solvedToday, 1);
  assert.equal(res.solved7d, 3);
  assert.equal(res.currentStreak, 3);
  assert.equal(res.maxStreak, 3);
  assert.equal(res.ratingChange, 85);
  assert.equal(res.dailyCounts[localDateKey(now)], 1);
});

test('sortPilots and computeSquadMetrics aggregate squad correctly', () => {
  const makePilot = (name: string, rating: number, lcTotal: number, cfSolved: number, streak: number): PilotTelemetry => ({
    member: { name, cf: name, lc: name, cc: name },
    cfProfile: { handle: name, rating, maxRating: rating },
    rankMeta: getRankMeta(rating),
    totalCFSolved: cfSolved,
    solvedToday: streak > 0 ? 2 : 0,
    solved7d: 5,
    solved30d: 10,
    ratingChange: 20,
    currentStreak: streak,
    maxStreak: streak,
    dailyCounts: {},
    recentAccepted: [],
    ratingHistory: [],
    lc: { total: lcTotal, easy: 10, medium: 10, hard: 5, rank: 1000 },
    cc: { rating: 1600, stars: '3★', rank: 500 },
    combinedScore: cfSolved + lcTotal,
  });

  const pilots = [
    makePilot('Alpha', 1650, 120, 80, 2),
    makePilot('Beta', 1420, 200, 150, 7),
  ];

  const byScore = sortPilots(pilots, 'combined');
  assert.equal(byScore[0].member.name, 'Beta');

  const byCf = sortPilots(pilots, 'cf');
  assert.equal(byCf[0].member.name, 'Alpha');

  const byStreak = sortPilots(pilots, 'streak');
  assert.equal(byStreak[0].member.name, 'Beta');

  const squad = computeSquadMetrics(pilots);
  assert.ok(squad);
  assert.equal(squad.totalCF, 230);
  assert.equal(squad.totalLC, 320);
  assert.equal(squad.totalAll, 550);
  assert.equal(squad.avgCFRating, 1535);
});
