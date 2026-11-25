import { describe, expect, it } from 'vitest';
import {
  buildWorktreeCommands,
  DEMO_BLOAT_ITEMS,
  DEMO_WORKTREES,
  parseGitWorktreePorcelain,
  summarizeBloat,
} from '../src/core/worktreeAndBloat.ts';

describe('portmap Worktree Deck & Layer Bloat Radar', () => {
  it('parses git worktree list --porcelain cleanly and builds safe commands', () => {
    const raw = `worktree /repo/main
HEAD 9a4f12e881
branch refs/heads/main

worktree /repo/wt-auth
HEAD 4c82bd1002
branch refs/heads/feat/auth`;
    const parsed = parseGitWorktreePorcelain(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].isMain).toBe(true);
    expect(parsed[1].branch).toBe('feat/auth');

    const cmds = buildWorktreeCommands(DEMO_WORKTREES[1]);
    expect(cmds.sync).toContain('rebase origin/main');
    expect(cmds.remove).toContain('--force');
  });

  it('summarizes total and reclaimable container/cache bloat accurately', () => {
    const stats = summarizeBloat(DEMO_BLOAT_ITEMS);
    expect(stats.totalMb).toBeGreaterThan(5000);
    expect(stats.reclaimableMb).toBeGreaterThan(4000);
    expect(stats.reclaimPct).toBeGreaterThan(50);
  });
});
