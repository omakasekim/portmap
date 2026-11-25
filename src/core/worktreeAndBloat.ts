export interface WorktreeEntry {
  id: string;
  path: string;
  branch: string;
  headSha: string;
  isMain: boolean;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  linkedPort?: number;
  lastActiveHours: number;
  status: 'active' | 'dirty' | 'stale' | 'detached';
}

export function parseGitWorktreePorcelain(raw: string): WorktreeEntry[] {
  const blocks = raw
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean);

  return blocks.map((block, idx) => {
    const lines = block.split('\n');
    let wtPath = `./wt-${idx}`;
    let headSha = '0000000';
    let branch = 'detached';
    let detached = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) headSha = line.slice(5, 12).trim();
      else if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '').trim();
      else if (line.trim() === 'detached') detached = true;
    }

    return {
      id: `wt_${idx}`,
      path: wtPath,
      branch: detached ? '(detached HEAD)' : branch,
      headSha,
      isMain: idx === 0,
      ahead: 0,
      behind: 0,
      dirtyFiles: [],
      lastActiveHours: idx * 3,
      status: detached ? 'detached' : 'active',
    };
  });
}

export const DEMO_WORKTREES: WorktreeEntry[] = [
  {
    id: 'wt_main',
    path: './workspace/main',
    branch: 'main',
    headSha: '9a4f12e',
    isMain: true,
    ahead: 0,
    behind: 0,
    dirtyFiles: [],
    linkedPort: 3000,
    lastActiveHours: 0.2,
    status: 'active',
  },
  {
    id: 'wt_auth',
    path: './workspace/wt-keyring-auth',
    branch: 'feat/keyring-rotation',
    headSha: '4c82bd1',
    isMain: false,
    ahead: 4,
    behind: 1,
    dirtyFiles: ['src/auth/verifyToken.ts', 'tests/auth.spec.ts'],
    linkedPort: 3001,
    lastActiveHours: 1.5,
    status: 'dirty',
  },
  {
    id: 'wt_perf',
    path: './workspace/wt-sql-index',
    branch: 'perf/invoice-index',
    headSha: 'e1209fa',
    isMain: false,
    ahead: 2,
    behind: 0,
    dirtyFiles: [],
    linkedPort: 8081,
    lastActiveHours: 6,
    status: 'active',
  },
  {
    id: 'wt_stale',
    path: './workspace/wt-legacy-spike',
    branch: 'spike/old-graphql',
    headSha: '71bd009',
    isMain: false,
    ahead: 1,
    behind: 19,
    dirtyFiles: ['schema.graphql'],
    lastActiveHours: 184,
    status: 'stale',
  },
];

export function buildWorktreeCommands(wt: WorktreeEntry): { sync: string; remove: string; prune: string } {
  return {
    sync: `git -C "${wt.path}" fetch origin && git -C "${wt.path}" rebase origin/main`,
    remove: wt.dirtyFiles.length > 0
      ? `git worktree remove --force "${wt.path}"`
      : `git worktree remove "${wt.path}"`,
    prune: 'git worktree prune --verbose',
  };
}

export interface BloatEntry {
  id: string;
  name: string;
  kind: 'docker-layer' | 'build-cache' | 'package-store';
  sizeMb: number;
  reclaimableMb: number;
  instruction?: string;
  cached?: boolean;
  safeCleanupCmd: string;
  hint: string;
}

export const DEMO_BLOAT_ITEMS: BloatEntry[] = [
  {
    id: 'b1',
    name: 'RUN npm install (unpruned devDependencies)',
    kind: 'docker-layer',
    sizeMb: 486,
    reclaimableMb: 310,
    instruction: 'RUN npm install && npm run build',
    cached: false,
    safeCleanupCmd: 'Use multi-stage Dockerfile + npm ci --omit=dev in runtime stage',
    hint: 'Copy only dist/ + production node_modules into final slim image.',
  },
  {
    id: 'b2',
    name: 'Rust cargo target/debug artifacts',
    kind: 'build-cache',
    sizeMb: 3420,
    reclaimableMb: 2890,
    safeCleanupCmd: 'cargo clean --doc && find . -name target -type d -maxdepth 3',
    hint: 'Incremental debug symbols accumulate across feature branches.',
  },
  {
    id: 'b3',
    name: 'Docker BuildKit cache & dangling images',
    kind: 'docker-layer',
    sizeMb: 2180,
    reclaimableMb: 1940,
    instruction: 'BUILDKIT_CACHE_MOUNT',
    cached: true,
    safeCleanupCmd: 'docker builder prune --filter "until=168h" && docker image prune -f',
    hint: 'Prune build layers older than 7 days while keeping recent base layers warm.',
  },
  {
    id: 'b4',
    name: 'node_modules + .next/cache across worktrees',
    kind: 'package-store',
    sizeMb: 1640,
    reclaimableMb: 1120,
    safeCleanupCmd: 'pnpm store prune && rm -rf .next/cache',
    hint: 'Switch duplicate worktrees to pnpm content-addressable store hardlinks.',
  },
  {
    id: 'b5',
    name: 'RUN apt-get install build-essential python3',
    kind: 'docker-layer',
    sizeMb: 312,
    reclaimableMb: 265,
    instruction: 'RUN apt-get update && apt-get install -y build-essential',
    cached: true,
    safeCleanupCmd: 'Append && rm -rf /var/lib/apt/lists/* and move compilers to builder stage',
    hint: 'C/C++ toolchains should never ship in the final production container.',
  },
  {
    id: 'b6',
    name: 'Python ~/.cache/uv & pip wheels',
    kind: 'package-store',
    sizeMb: 740,
    reclaimableMb: 520,
    safeCleanupCmd: 'uv cache prune && pip cache purge',
    hint: 'Safe to prune stale wheels; active virtualenvs stay intact.',
  },
];

export function summarizeBloat(items: BloatEntry[]) {
  const totalMb = items.reduce((a, b) => a + b.sizeMb, 0);
  const reclaimableMb = items.reduce((a, b) => a + b.reclaimableMb, 0);
  return {
    totalMb,
    reclaimableMb,
    reclaimPct: totalMb > 0 ? Math.round((reclaimableMb / totalMb) * 100) : 0,
  };
}
