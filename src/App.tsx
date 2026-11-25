import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Skull,
  Terminal,
} from 'lucide-react';
import { buildDemoTopology } from './core/scanner.ts';
import type { ServiceNode, TopologySnapshot } from './core/types.ts';

export function App() {
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(() => buildDemoTopology());
  const [nodes, setNodes] = useState<ServiceNode[]>(snapshot.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.nodes[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState(false);
  const [confirmKillPid, setConfirmKillPid] = useState<number | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [cam, setCam] = useState({ x: 40, y: 40, zoom: 1 });

  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const dragRef = useRef<{ type: 'canvas' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const ingestSnapshot = (next: TopologySnapshot) => {
    const merged = next.nodes.map((n) => {
      const saved = positionsRef.current.get(n.id);
      return saved ? { ...n, x: saved.x, y: saved.y } : n;
    });
    setSnapshot(next);
    setNodes(merged);
  };

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/events');
      es.onopen = () => setLiveConnected(true);
      es.onmessage = (ev) => {
        const parsed = JSON.parse(ev.data) as TopologySnapshot;
        ingestSnapshot(parsed);
      };
      es.onerror = () => {
        setLiveConnected(false);
      };
    } catch {
      setLiveConnected(false);
    }
    return () => {
      es?.close();
    };
  }, []);

  const manualRefresh = async () => {
    try {
      const r = await fetch('/api/snapshot');
      if (r.ok) {
        ingestSnapshot((await r.json()) as TopologySnapshot);
        return;
      }
    } catch {
      /* fallback */
    }
    ingestSnapshot(buildDemoTopology());
  };

  const toggleDemoMode = async () => {
    const nextDemo = !snapshot.isDemo;
    try {
      await fetch(`/api/mode?demo=${nextDemo ? '1' : '0'}`, { method: 'POST' });
      const r = await fetch(`/api/snapshot?demo=${nextDemo ? '1' : '0'}`);
      if (r.ok) {
        ingestSnapshot((await r.json()) as TopologySnapshot);
        return;
      }
    } catch {
      ingestSnapshot(buildDemoTopology());
    }
  };

  const killProcess = async (pid: number) => {
    try {
      const r = await fetch('/api/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid, confirm: true }),
      });
      if (r.ok) {
        setConfirmKillPid(null);
        await manualRefresh();
      }
    } catch {
      setConfirmKillPid(null);
    }
  };

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  const filteredEnv = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.envVars.filter((ev) => {
      if (selectedNode && selectedNode.kind !== 'dead-target') {
        const matchService =
          ev.serviceHint.toLowerCase().includes(selectedNode.name.toLowerCase()) ||
          selectedNode.name.toLowerCase().includes(ev.serviceHint.toLowerCase()) ||
          ev.referencedPorts.includes(selectedNode.port);
        if (!matchService && !q) return false;
      }
      if (!q) return true;
      return ev.key.toLowerCase().includes(q) || ev.maskedValue.toLowerCase().includes(q) || ev.sourceFile.toLowerCase().includes(q);
    });
  }, [snapshot.envVars, selectedNode, search]);

  const copyLocalUrl = async (port: number) => {
    try {
      await navigator.clipboard.writeText(`http://localhost:${port}`);
      setCopiedPort(port);
      setTimeout(() => setCopiedPort(null), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
            <Radio className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-50">portmap</h1>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  liveConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${liveConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {snapshot.isDemo ? 'DEMO STACK' : liveConnected ? 'LIVE SSE' : 'STATIC DEMO'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {nodes.filter((n) => n.kind !== 'dead-target').length} active services ·{' '}
              <span className={snapshot.conflicts.length ? 'text-amber-400' : 'text-slate-400'}>
                {snapshot.conflicts.length} conflicts
              </span>{' '}
              ·{' '}
              <span className={snapshot.deadTargets.length ? 'text-rose-400' : 'text-emerald-400'}>
                {snapshot.deadTargets.length} dead .env targets
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search port, key, file..."
              className="w-48 rounded-lg border border-slate-700 bg-[#0B0F17] py-1 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={toggleDemoMode}
            className="rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-emerald-500"
          >
            {snapshot.isDemo ? 'Switch to Live Scan' : 'Load Demo Stack'}
          </button>
          <button
            type="button"
            onClick={manualRefresh}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs text-slate-200 hover:border-sky-500"
          >
            <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
            <span>Rescan</span>
          </button>
        </div>
      </header>

      {/* Alert Banners for Conflicts & Dead .env Targets */}
      {(snapshot.conflicts.length > 0 || snapshot.deadTargets.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
          {snapshot.conflicts.map((c) => (
            <div key={c.port} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                Port collision on <strong>:{c.port}</strong> ({c.commands.join(' & ')})
              </span>
            </div>
          ))}
          {snapshot.deadTargets.length > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-rose-300">
              <Skull className="h-3.5 w-3.5" />
              <span>
                Dead target ports referenced by .env: {snapshot.deadTargets.map((p) => `:${p}`).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Topology Canvas */}
        <div
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-svc-card]')) return;
            dragRef.current = { type: 'canvas', sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.sx;
            const dy = e.clientY - d.sy;
            if (d.type === 'canvas') setCam((c) => ({ ...c, x: d.ox + dx, y: d.oy + dy }));
            else if (d.id) {
              const nx = d.ox + dx / cam.zoom;
              const ny = d.oy + dy / cam.zoom;
              positionsRef.current.set(d.id, { x: nx, y: ny });
              setNodes((prev) => prev.map((n) => (n.id === d.id ? { ...n, x: nx, y: ny } : n)));
            }
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onWheel={(e) => setCam((c) => ({ ...c, zoom: Math.max(0.5, Math.min(1.6, c.zoom + (e.deltaY < 0 ? 0.08 : -0.08))) }))}
          className="relative flex-1 cursor-grab overflow-hidden bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] active:cursor-grabbing"
        >
          <div style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`, transformOrigin: '0 0' }} className="absolute inset-0">
            <svg className="pointer-events-none h-[2000px] w-[2200px] overflow-visible">
              {snapshot.edges.map((edge) => {
                const s = nodesById.get(edge.source);
                const t = nodesById.get(edge.target);
                if (!s || !t) return null;
                const x1 = s.x + 125;
                const y1 = s.y + 58;
                const x2 = t.x + 125;
                const y2 = t.y + 58;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2 - 24;
                return (
                  <g key={edge.id}>
                    <path
                      d={`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`}
                      fill="none"
                      stroke={edge.dead ? '#f43f5e' : '#10b981'}
                      strokeWidth={edge.dead ? 2.4 : 1.8}
                      strokeOpacity={0.78}
                      className="edge-flow"
                    />
                    <rect x={mx - 64} y={my - 10} width="128" height="20" rx="5" fill="#0B0F17" stroke={edge.dead ? '#f43f5e' : '#1e293b'} />
                    <text x={mx} y={my + 4} textAnchor="middle" fill={edge.dead ? '#fda4af' : '#94a3b8'} fontFamily="monospace" fontSize="10">
                      {edge.envKey} → :{edge.targetPort}
                    </text>
                  </g>
                );
              })}
            </svg>

            {nodes.map((n) => {
              const selected = selectedId === n.id;
              const border =
                n.status === 'dead'
                  ? 'border-rose-500/70 bg-rose-950/20'
                  : n.status === 'conflict'
                    ? 'border-amber-500/70 bg-amber-950/15'
                    : 'border-emerald-500/50 bg-[#111827]/95';
              return (
                <div
                  key={n.id}
                  data-svc-card
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(n.id);
                    dragRef.current = { type: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
                  }}
                  style={{ left: n.x, top: n.y, width: 252 }}
                  className={`absolute select-none rounded-xl border p-3.5 shadow-xl ${border} ${selected ? 'ring-2 ring-sky-400' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-slate-50">
                      {n.kind === 'docker' ? (
                        <Database className="h-3.5 w-3.5 text-sky-400" />
                      ) : n.kind === 'dead-target' ? (
                        <Skull className="h-3.5 w-3.5 text-rose-400" />
                      ) : (
                        <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                      )}
                      {n.port ? `:${n.port}` : 'ENV'}
                    </span>
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                      {n.pid ? `PID ${n.pid}` : n.kind}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-100">{n.name}</div>
                  <div className="truncate font-mono text-[11px] text-slate-400">{n.image || n.command}</div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px]">
                    <span className="flex items-center gap-1 font-mono text-slate-400">
                      <Activity className="h-3 w-3 text-sky-400" />
                      {n.cpuPct.toFixed(1)}% · {n.memMb} MB
                    </span>
                    {n.port > 0 && n.status !== 'dead' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyLocalUrl(n.port);
                        }}
                        className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-sky-300 hover:bg-slate-700"
                      >
                        {copiedPort === n.port ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        URL
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Side Inspector: Masked Env Vars + Process Controls */}
        <aside className="flex w-full max-w-md flex-col border-l border-slate-800 bg-[#111827]">
          <div className="border-b border-slate-800 px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-bold text-slate-50">
                  {selectedNode ? selectedNode.name : 'All Discovered Services'}
                </h2>
              </div>
              {selectedNode && (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-xs text-sky-400 hover:underline"
                >
                  Show all
                </button>
              )}
            </div>
            {selectedNode && selectedNode.pid && !snapshot.isDemo && (
              <div className="mt-2.5 flex items-center justify-between rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs">
                <span className="font-mono text-slate-300">PID {selectedNode.pid}</span>
                {confirmKillPid === selectedNode.pid ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => killProcess(selectedNode.pid!)}
                      className="rounded bg-rose-600 px-2 py-0.5 font-medium text-white hover:bg-rose-500"
                    >
                      Confirm SIGTERM
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmKillPid(null)}
                      className="rounded border border-slate-700 px-2 py-0.5 text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmKillPid(selectedNode.pid)}
                    className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-rose-300 hover:bg-rose-500/20"
                  >
                    Stop Process
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
            <span>Environment Variables ({filteredEnv.length})</span>
            <button
              type="button"
              onClick={() => setRevealedSecrets((v) => !v)}
              className="inline-flex items-center gap-1 text-slate-300 hover:text-slate-100"
            >
              {revealedSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{revealedSecrets ? 'Hide annotations' : 'Show risk tags'}</span>
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {filteredEnv.length === 0 && (
              <div className="rounded-xl border border-slate-800 bg-[#0B0F17] p-4 text-xs text-slate-400">
                No matching `.env` variables found for this selection.
              </div>
            )}
            {filteredEnv.map((ev, i) => (
              <div key={`${ev.sourceFile}-${ev.key}-${i}`} className="rounded-xl border border-slate-800 bg-[#0B0F17] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-sky-300">{ev.key}</span>
                  <span className="font-mono text-[10px] text-slate-500">{ev.sourceFile}</span>
                </div>
                <div className="mt-1 break-all font-mono text-xs text-slate-200">{ev.maskedValue}</div>
                {revealedSecrets && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                    {ev.isSecret && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">MASKED SECRET</span>}
                    {ev.referencedPorts.map((p) => {
                      const dead = snapshot.deadTargets.includes(p);
                      return (
                        <span
                          key={p}
                          className={`rounded px-1.5 py-0.5 font-mono ${
                            dead ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          :{p} {dead ? 'DEAD' : 'OK'}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
