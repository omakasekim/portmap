import { useMemo, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Copy,
  Download,
  GitBranch,
  HardDrive,
  Layers,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildWorktreeCommands,
  DEMO_BLOAT_ITEMS,
  DEMO_WORKTREES,
  parseGitWorktreePorcelain,
  summarizeBloat,
  type BloatEntry,
  type WorktreeEntry,
} from '../core/worktreeAndBloat.ts';

export function WorktreeDeck() {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>(DEMO_WORKTREES);
  const [selectedId, setSelectedId] = useState<string>(DEMO_WORKTREES[1].id);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [porcelain, setPorcelain] = useState('');

  const selected = worktrees.find((w) => w.id === selectedId) ?? worktrees[0];
  const cmds = selected ? buildWorktreeCommands(selected) : null;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCmd(key);
      setTimeout(() => setCopiedCmd(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#090D16] text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
        <div className="flex items-center gap-3">
          <GitBranch className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-semibold text-slate-200">Git Worktree Mission Control</span>
          <span className="font-mono text-slate-400">
            {worktrees.length} worktrees · {worktrees.filter((w) => w.dirtyFiles.length > 0).length} dirty ·{' '}
            {worktrees.filter((w) => w.status === 'stale').length} stale
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-200 hover:bg-emerald-500/20"
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste `git worktree list --porcelain`
        </button>
      </div>

      {pasteOpen && (
        <div className="border-b border-slate-800 bg-[#111827] px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-emerald-300">Paste output of `git worktree list --porcelain`</span>
            <button type="button" onClick={() => setPasteOpen(false)} className="text-slate-400">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={porcelain}
            onChange={(e) => setPorcelain(e.target.value)}
            placeholder={'worktree /repo/main\nHEAD 9a4f12e\nbranch refs/heads/main\n\nworktree /repo/wt-feature\nHEAD 4c82bd1\nbranch refs/heads/feat/api'}
            className="h-24 w-full rounded-lg border border-slate-700 bg-[#090D16] p-2 font-mono text-xs text-slate-100"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                const parsed = parseGitWorktreePorcelain(porcelain);
                if (parsed.length > 0) {
                  setWorktrees(parsed);
                  setSelectedId(parsed[0].id);
                  setPasteOpen(false);
                }
              }}
              className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950"
            >
              Load Worktrees
            </button>
          </div>
        </div>
      )}

      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.25fr_0.95fr]">
        {/* Worktree Cards Grid */}
        <section className="grid content-start gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {worktrees.map((wt) => {
            const active = wt.id === selected?.id;
            const badge =
              wt.status === 'stale'
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                : wt.status === 'dirty'
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                  : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
            return (
              <button
                key={wt.id}
                type="button"
                onClick={() => setSelectedId(wt.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  active
                    ? 'border-emerald-400 bg-[#111827] ring-2 ring-emerald-400/40'
                    : 'border-slate-800 bg-[#111827]/85 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${badge}`}>
                    {wt.isMain ? 'PRIMARY' : wt.status}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{wt.headSha}</span>
                </div>
                <div className="mt-2 truncate font-mono text-sm font-bold text-slate-50">{wt.branch}</div>
                <div className="truncate font-mono text-[11px] text-slate-400">{wt.path}</div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 font-mono text-[11px]">
                  <span className="text-sky-300">
                    ↑{wt.ahead} ↓{wt.behind}
                  </span>
                  <span className={wt.dirtyFiles.length ? 'text-amber-300' : 'text-emerald-400'}>
                    {wt.dirtyFiles.length ? `${wt.dirtyFiles.length} dirty file(s)` : 'clean tree'}
                  </span>
                  {wt.linkedPort && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-emerald-300">:{wt.linkedPort}</span>
                  )}
                </div>
              </button>
            );
          })}
        </section>

        {/* Right Command & Dirty-File Inspector */}
        <aside className="flex flex-col space-y-4 overflow-y-auto border-l border-slate-800 bg-[#111827] p-5">
          {selected && cmds && (
            <>
              <div className="rounded-xl border border-slate-800 bg-[#090D16] p-4">
                <div className="font-mono text-xs text-emerald-400">{selected.path}</div>
                <h2 className="mt-1 font-mono text-base font-bold text-slate-50">{selected.branch}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  Last active {selected.lastActiveHours < 24 ? `${selected.lastActiveHours}h ago` : `${Math.round(selected.lastActiveHours / 24)}d ago`} ·{' '}
                  {selected.ahead} commit(s) ahead, {selected.behind} behind main
                </p>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-800 bg-[#090D16] p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Dirty Working Tree Files ({selected.dirtyFiles.length})
                </div>
                {selected.dirtyFiles.length === 0 ? (
                  <p className="text-xs text-emerald-400">Working tree is completely clean.</p>
                ) : (
                  selected.dirtyFiles.map((f) => (
                    <div key={f} className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 font-mono text-xs text-amber-200">
                      M {f}
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2.5 rounded-xl border border-slate-800 bg-[#090D16] p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Copyable Sync &amp; Cleanup Commands
                </div>
                {(
                  [
                    { key: 'sync', label: 'Fetch & Rebase onto main', cmd: cmds.sync },
                    { key: 'remove', label: 'Remove Worktree Safely', cmd: cmds.remove },
                    { key: 'prune', label: 'Prune Stale Worktree Refs', cmd: cmds.prune },
                  ] as const
                ).map((c) => (
                  <div key={c.key} className="rounded-lg border border-slate-800 bg-[#111827] p-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{c.label}</span>
                      <button
                        type="button"
                        onClick={() => copyText(c.key, c.cmd)}
                        className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-sky-300 hover:bg-slate-700"
                      >
                        {copiedCmd === c.key ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        Copy
                      </button>
                    </div>
                    <pre className="mt-1.5 overflow-x-auto font-mono text-[11px] text-slate-200">{c.cmd}</pre>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

export function LayerBloatRadar() {
  const [kindFilter, setKindFilter] = useState<'all' | BloatEntry['kind']>('all');
  const [selectedId, setSelectedId] = useState<string>(DEMO_BLOAT_ITEMS[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visible = useMemo(
    () => (kindFilter === 'all' ? DEMO_BLOAT_ITEMS : DEMO_BLOAT_ITEMS.filter((i) => i.kind === kindFilter)),
    [kindFilter],
  );
  const stats = useMemo(() => summarizeBloat(visible), [visible]);
  const maxMb = Math.max(1, ...visible.map((v) => v.sizeMb));
  const selected = visible.find((v) => v.id === selectedId) ?? visible[0];

  const exportBloatReport = () => {
    const blob = new Blob([JSON.stringify({ stats, items: visible }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'layer-bloat-report.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#090D16] text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <HardDrive className="h-3.5 w-3.5 text-amber-400" />
          {(
            [
              { id: 'all', label: 'All Footprints' },
              { id: 'docker-layer', label: 'Container Layers' },
              { id: 'build-cache', label: 'Build Caches' },
              { id: 'package-store', label: 'Package Stores' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setKindFilter(f.id)}
              className={`rounded-md border px-2.5 py-1 ${
                kindFilter === f.id
                  ? 'border-amber-500/60 bg-amber-500/15 font-semibold text-amber-200'
                  : 'border-slate-700 bg-[#111827] text-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 font-mono">
          <span className="text-slate-300">Total: <strong>{(stats.totalMb / 1024).toFixed(2)} GB</strong></span>
          <span className="text-emerald-400">
            Reclaimable: <strong>{(stats.reclaimableMb / 1024).toFixed(2)} GB ({stats.reclaimPct}%)</strong>
          </span>
          <button
            type="button"
            onClick={exportBloatReport}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1 text-slate-200 hover:border-sky-500"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" /> JSON
          </button>
        </div>
      </div>

      <div className="grid flex-1 overflow-hidden lg:grid-cols-[1.25fr_0.95fr]">
        {/* Interactive Proportional Size Heatmap */}
        <section className="space-y-3 overflow-y-auto p-5">
          {visible.map((item) => {
            const pct = Math.max(8, Math.round((item.sizeMb / maxMb) * 100));
            const reclaimPct = Math.round((item.reclaimableMb / Math.max(1, item.sizeMb)) * 100);
            const active = item.id === selected?.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`block w-full rounded-xl border p-4 text-left transition ${
                  active ? 'border-amber-400 bg-[#111827] ring-1 ring-amber-400/50' : 'border-slate-800 bg-[#111827]/80 hover:border-slate-600'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-amber-400" />
                    <span className="font-mono text-sm font-bold text-slate-100">{item.name}</span>
                  </div>
                  <span className="font-mono text-xs font-bold text-rose-300">
                    {item.sizeMb >= 1024 ? `${(item.sizeMb / 1024).toFixed(2)} GB` : `${item.sizeMb} MB`}
                  </span>
                </div>
                <div className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-[#090D16]">
                  <div
                    className="flex h-full overflow-hidden rounded-full bg-amber-500/35"
                    style={{ width: `${pct}%` }}
                  >
                    <div className="bg-rose-500" style={{ width: `${reclaimPct}%` }} />
                    <div className="bg-sky-500/70" style={{ width: `${100 - reclaimPct}%` }} />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
                  <span>{item.kind}</span>
                  <span className="text-emerald-400">Reclaimable: {item.reclaimableMb} MB ({reclaimPct}%)</span>
                </div>
              </button>
            );
          })}
        </section>

        {/* Right Optimization & Safe Cleanup Inspector */}
        <aside className="flex flex-col space-y-4 overflow-y-auto border-l border-slate-800 bg-[#111827] p-5">
          {selected && (
            <>
              <div className="rounded-xl border border-slate-800 bg-[#090D16] p-4 space-y-2">
                <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-300">
                  {selected.kind}
                </span>
                <h2 className="font-mono text-base font-bold text-slate-50">{selected.name}</h2>
                {selected.instruction && (
                  <pre className="rounded border border-slate-800 bg-[#111827] p-2 font-mono text-[11px] text-sky-300">
                    {selected.instruction}
                  </pre>
                )}
                <p className="text-xs text-slate-300">{selected.hint}</p>
              </div>

              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <Trash2 className="h-3.5 w-3.5" /> Safe Cleanup / Optimization Action
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selected.safeCleanupCmd);
                        setCopiedId(selected.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      } catch {}
                    }}
                    className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-sky-300"
                  >
                    {copiedId === selected.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    Copy
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-[#090D16] p-3 font-mono text-xs text-emerald-200">
                  {selected.safeCleanupCmd}
                </pre>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
