import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Shield,
  Skull,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import {
  buildDemoPreset,
  buildTopologySnapshot,
  exportSanitizedEnvExample,
  suggestNextFreePort,
  type DemoPresetId,
} from './core/scanner.ts';
import type { ServiceNode, TopologySnapshot } from './core/types.ts';

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(10, ...values);
  const w = 66;
  const h = 18;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - Math.max(1.5, (v / max) * (h - 2));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

const SAMPLE_ENV_SNIPPET = `PORT=3000
API_URL=http://localhost:8080/api
POSTGRES_URL=postgres://admin:supersecret@localhost:5432/app
REDIS_URL=redis://localhost:6379
JWT_SIGNING_SECRET=sk_live_demo_secret_token_9918`;

export function App() {
  const [preset, setPreset] = useState<DemoPresetId>('chronos');
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(() => buildDemoPreset('chronos'));
  const [nodes, setNodes] = useState<ServiceNode[]>(snapshot.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.nodes[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState(true);
  const [confirmKillPid, setConfirmKillPid] = useState<number | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [simTicking, setSimTicking] = useState(true);
  const [cam, setCam] = useState({ x: 36, y: 36, zoom: 0.96 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'env' | 'compose'>('env');
  const [editorText, setEditorText] = useState(SAMPLE_ENV_SNIPPET);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [cpuHistory, setCpuHistory] = useState<Record<string, number[]>>({});

  const positionsRef = useRef(new Map<string, { x: number; y: number }>());
  const dragRef = useRef<{ type: 'canvas' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const isLocalServer =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const notify = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner(null), 2600);
  };

  const ingestSnapshot = (next: TopologySnapshot, resetPositions = false) => {
    if (resetPositions) positionsRef.current.clear();
    const merged = next.nodes.map((n) => {
      const saved = positionsRef.current.get(n.id);
      return saved ? { ...n, x: saved.x, y: saved.y } : n;
    });
    setSnapshot(next);
    setNodes(merged);
    setCpuHistory((prev) => {
      const updated: Record<string, number[]> = { ...prev };
      for (const n of merged) {
        const arr = updated[n.id] ?? [n.cpuPct, n.cpuPct * 0.92, n.cpuPct * 1.05, n.cpuPct];
        updated[n.id] = [...arr.slice(-11), n.cpuPct];
      }
      return updated;
    });
  };

  // Only open SSE stream when running via local CLI server (zero 404 errors on GitHub Pages)
  useEffect(() => {
    if (!isLocalServer) return;
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
  }, [isLocalServer]);

  // Live animated CPU/RAM telemetry ticker in Sandbox/Demo mode
  useEffect(() => {
    if (!snapshot.isDemo || !simTicking) return;
    const timer = setInterval(() => {
      setNodes((prev) => {
        const nextNodes = prev.map((n) => {
          if (n.status === 'dead' || n.kind === 'env-only') return n;
          const jitter = (Math.random() - 0.48) * Math.max(0.4, n.cpuPct * 0.25);
          const nextCpu = Math.max(0.2, Math.min(98, Number((n.cpuPct + jitter).toFixed(1))));
          const nextMem = Math.max(24, Math.round(n.memMb + (Math.random() - 0.5) * 6));
          return { ...n, cpuPct: nextCpu, memMb: nextMem };
        });
        setCpuHistory((hist) => {
          const updated: Record<string, number[]> = { ...hist };
          for (const n of nextNodes) {
            const arr = updated[n.id] ?? [n.cpuPct, n.cpuPct];
            updated[n.id] = [...arr.slice(-13), n.cpuPct];
          }
          return updated;
        });
        return nextNodes;
      });
    }, 1400);
    return () => clearInterval(timer);
  }, [snapshot.isDemo, simTicking]);

  const loadPreset = (id: DemoPresetId) => {
    setPreset(id);
    const snap = buildDemoPreset(id);
    ingestSnapshot(snap, true);
    setSelectedId(snap.nodes[0]?.id ?? null);
    notify(`Loaded preset stack: ${id}`);
  };

  // Interactive Sandbox: boot a simulated service on a dead .env target port
  const bootMissingService = (port: number) => {
    const nextNodes = nodes.map((n) =>
      n.kind === 'dead-target' && n.port === port
        ? {
            ...n,
            id: `port:${port}`,
            name: port === 6379 ? 'redis-cache' : port === 9090 ? 'prometheus-sink' : port === 9092 ? 'kafka-broker' : `service-${port}`,
            kind: 'docker' as const,
            pid: Math.floor(20000 + Math.random() * 30000),
            command: `simulated-listener:${port}`,
            image: port === 6379 ? 'redis:7-alpine' : `local-svc:${port}`,
            cpuPct: Number((1.1 + Math.random() * 2.5).toFixed(1)),
            memMb: Math.round(48 + Math.random() * 96),
            status: 'healthy' as const,
          }
        : n,
    );
    const nextEdges = snapshot.edges.map((e) =>
      e.targetPort === port
        ? { ...e, target: `port:${port}`, dead: false, label: `${e.envKey} → :${port}` }
        : e,
    );
    const nextDead = snapshot.deadTargets.filter((p) => p !== port);
    setNodes(nextNodes);
    setSnapshot((prev) => ({ ...prev, nodes: nextNodes, edges: nextEdges, deadTargets: nextDead }));
    setSelectedId(`port:${port}`);
    notify(`Booted simulated listener on :${port} — broken .env link healed!`);
  };

  // Interactive Sandbox: resolve port collision by migrating secondary process to next free port
  const resolvePortCollision = (conflictPort: number) => {
    const used = nodes.map((n) => n.port).filter((p) => p > 0);
    const freePort = suggestNextFreePort(used, conflictPort + 1);
    const conflict = snapshot.conflicts.find((c) => c.port === conflictPort);
    if (!conflict) return;

    const migratedNode: ServiceNode = {
      id: `port:${freePort}`,
      name: conflict.commands[1] ?? `migrated-${freePort}`,
      kind: 'process',
      port: freePort,
      protocol: 'tcp',
      address: '127.0.0.1',
      pid: conflict.pids[1] ?? Math.floor(30000 + Math.random() * 20000),
      command: conflict.commands[1] ?? 'secondary-proc',
      cpuPct: 0.8,
      memMb: 52,
      status: 'healthy',
      envCount: 0,
      x: 90 + (nodes.length % 3) * 320,
      y: 90 + Math.floor(nodes.length / 3) * 200,
    };

    const updatedNodes = [
      ...nodes.map((n) =>
        n.port === conflictPort
          ? { ...n, status: 'healthy' as const, command: conflict.commands[0] ?? n.command }
          : n,
      ),
      migratedNode,
    ];
    const nextConflicts = snapshot.conflicts.filter((c) => c.port !== conflictPort);
    setNodes(updatedNodes);
    setSnapshot((prev) => ({ ...prev, nodes: updatedNodes, conflicts: nextConflicts }));
    setSelectedId(migratedNode.id);
    notify(`Resolved :${conflictPort} collision — moved ${migratedNode.name} to :${freePort}`);
  };

  // Interactive Sandbox: parse custom pasted .env or docker-compose.yml
  const analyzePastedConfig = () => {
    if (!editorText.trim()) return;
    const sockets = nodes
      .filter((n) => n.port > 0 && n.status !== 'dead')
      .map((n) => ({
        pid: n.pid ?? 42000,
        port: n.port,
        address: n.address,
        command: n.name,
        cpuPct: n.cpuPct || 1.4,
        memMb: n.memMb || 92,
      }));
    const snap = buildTopologySnapshot({
      scanDir: './custom-workspace',
      isDemo: true,
      sockets,
      containers: [],
      files: [
        {
          relativePath: editorMode === 'env' ? 'custom/.env' : 'docker-compose.yml',
          serviceHint: 'custom-app',
          kind: editorMode,
          content: editorText,
        },
      ],
    });
    ingestSnapshot(snap, true);
    setSelectedId(snap.nodes[0]?.id ?? null);
    setEditorOpen(false);
    notify(`Parsed custom ${editorMode === 'env' ? '.env' : 'docker-compose.yml'} (${snap.envVars.length} vars, ${snap.edges.length} links)`);
  };

  const manualRefresh = async () => {
    if (isLocalServer) {
      try {
        const r = await fetch('/api/snapshot');
        if (r.ok) {
          ingestSnapshot((await r.json()) as TopologySnapshot);
          return;
        }
      } catch {
        /* fallback */
      }
    }
    ingestSnapshot(buildDemoPreset(preset), true);
  };

  const killProcess = async (pid: number) => {
    if (isLocalServer && !snapshot.isDemo) {
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
      return;
    }
    // Sandbox stop simulation: turn stopped node into a dead target!
    const target = nodes.find((n) => n.pid === pid);
    if (!target) return;
    const nextNodes = nodes.map((n) =>
      n.id === target.id
        ? { ...n, kind: 'dead-target' as const, status: 'dead' as const, pid: null, cpuPct: 0, memMb: 0, command: 'stopped' }
        : n,
    );
    const nextEdges = snapshot.edges.map((e) => (e.targetPort === target.port ? { ...e, dead: true } : e));
    const nextDead = Array.from(new Set([...snapshot.deadTargets, target.port])).sort((a, b) => a - b);
    setNodes(nextNodes);
    setSnapshot((prev) => ({ ...prev, nodes: nextNodes, edges: nextEdges, deadTargets: nextDead }));
    setConfirmKillPid(null);
    notify(`Stopped simulated process on :${target.port} — downstream links marked dead`);
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

  const downloadEnvExample = () => {
    const content = exportSanitizedEnvExample(snapshot.envVars);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '.env.example';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const exportTopologySvg = () => {
    const maxX = Math.max(1040, ...nodes.map((n) => n.x + 290));
    const maxY = Math.max(620, ...nodes.map((n) => n.y + 180));
    const edgesSvg = snapshot.edges
      .map((e) => {
        const s = nodesById.get(e.source);
        const t = nodesById.get(e.target);
        if (!s || !t) return '';
        const x1 = s.x + 130;
        const y1 = s.y + 62;
        const x2 = t.x + 130;
        const y2 = t.y + 62;
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${e.dead ? '#f43f5e' : '#10b981'}" stroke-width="2" />`;
      })
      .join('\n');
    const nodesSvg = nodes
      .map((n) => {
        const stroke = n.status === 'dead' ? '#f43f5e' : n.status === 'conflict' ? '#f59e0b' : '#10b981';
        return `<g transform="translate(${n.x},${n.y})"><rect width="260" height="110" rx="12" fill="#111827" stroke="${stroke}" stroke-width="2" /><text x="14" y="28" fill="#f8fafc" font-family="monospace" font-size="13" font-weight="700">:${n.port} ${n.name}</text><text x="14" y="54" fill="#94a3b8" font-family="monospace" font-size="11">${n.image || n.command}</text></g>`;
      })
      .join('\n');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}"><rect width="100%" height="100%" fill="#0B0F17" />${edgesSvg}${nodesSvg}</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portmap-${preset}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0F17] text-slate-100">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 bg-[#111827] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
              <Radio className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-slate-50">portmap</h1>
                <span
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    liveConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-sky-500/15 text-sky-300'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${liveConnected || simTicking ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  {liveConnected && !snapshot.isDemo ? 'LIVE SSE' : 'INTERACTIVE SANDBOX'}
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

          <div className="flex rounded-lg border border-slate-700 bg-[#0B0F17] p-0.5 text-[11px]">
            {(
              [
                { id: 'chronos', label: 'Web Stack' },
                { id: 'ai-rag', label: 'AI RAG Pipeline' },
                { id: 'payments', label: 'Payments Mesh' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => loadPreset(p.id)}
                className={`rounded-md px-2 py-1 transition ${
                  preset === p.id ? 'bg-emerald-500/20 font-semibold text-emerald-200' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search port, key, file..."
              className="w-40 rounded-lg border border-slate-700 bg-[#0B0F17] py-1 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setEditorOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            <span>Paste .env / Compose</span>
          </button>

          <button
            type="button"
            onClick={() => setSimTicking((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-300 hover:border-emerald-500"
            title="Toggle live telemetry simulation"
          >
            {simTicking ? <Pause className="h-3.5 w-3.5 text-emerald-400" /> : <Play className="h-3.5 w-3.5 text-slate-400" />}
          </button>

          <button
            type="button"
            onClick={downloadEnvExample}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200 hover:border-sky-500"
            title="Download masked .env.example"
          >
            <Download className="h-3.5 w-3.5 text-sky-400" />
            <span>.env.example</span>
          </button>

          <button
            type="button"
            onClick={exportTopologySvg}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200 hover:border-violet-500"
          >
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            <span>SVG</span>
          </button>

          <button
            type="button"
            onClick={manualRefresh}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-2 py-1 text-xs text-slate-200 hover:border-sky-500"
          >
            <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
            <span>Reset</span>
          </button>
        </div>
      </header>

      {/* Paste .env or docker-compose.yml Workbench Drawer */}
      {editorOpen && (
        <div className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-emerald-300">Analyze your own `.env` or `docker-compose.yml` locally</span>
              <div className="flex rounded border border-slate-700 bg-[#0B0F17] p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setEditorMode('env')}
                  className={`rounded px-2 py-0.5 ${editorMode === 'env' ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400'}`}
                >
                  .env
                </button>
                <button
                  type="button"
                  onClick={() => setEditorMode('compose')}
                  className={`rounded px-2 py-0.5 ${editorMode === 'compose' ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400'}`}
                >
                  docker-compose.yml
                </button>
              </div>
            </div>
            <button type="button" onClick={() => setEditorOpen(false)} className="text-slate-400 hover:text-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            className="h-28 w-full rounded-lg border border-slate-700 bg-[#0B0F17] p-2.5 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">Secrets are automatically masked in-memory; nothing is transmitted to any server.</span>
            <button
              type="button"
              onClick={analyzePastedConfig}
              className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Build Topology
            </button>
          </div>
        </div>
      )}

      {/* Alert Banners with 1-Click Interactive Fixes */}
      {(snapshot.conflicts.length > 0 || snapshot.deadTargets.length > 0 || statusBanner) && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-800 bg-[#0F172A] px-4 py-2 text-xs">
          {statusBanner && (
            <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-emerald-200">
              <Check className="h-3.5 w-3.5" />
              <span>{statusBanner}</span>
            </div>
          )}
          {snapshot.conflicts.map((c) => (
            <div key={c.port} className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                Collision on <strong>:{c.port}</strong> ({c.commands.join(' & ')})
              </span>
              <button
                type="button"
                onClick={() => resolvePortCollision(c.port)}
                className="inline-flex items-center gap-1 rounded bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/40"
              >
                <Wrench className="h-3 w-3" /> Auto-Resolve
              </button>
            </div>
          ))}
          {snapshot.deadTargets.map((port) => (
            <div key={port} className="inline-flex items-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-rose-300">
              <Skull className="h-3.5 w-3.5" />
              <span>Dead target <strong>:{port}</strong></span>
              <button
                type="button"
                onClick={() => bootMissingService(port)}
                className="inline-flex items-center gap-1 rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-100 hover:bg-rose-500/40"
              >
                <Plus className="h-3 w-3" /> Boot Listener
              </button>
            </div>
          ))}
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
              <defs>
                <filter id="pkt-glow">
                  <feGaussianBlur stdDeviation="2.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {snapshot.edges.map((edge, idx) => {
                const s = nodesById.get(edge.source);
                const t = nodesById.get(edge.target);
                if (!s || !t) return null;
                const x1 = s.x + 132;
                const y1 = s.y + 62;
                const x2 = t.x + 132;
                const y2 = t.y + 62;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2 - 28 - (idx % 2) * 14;
                const pathD = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
                return (
                  <g key={edge.id}>
                    <path
                      d={pathD}
                      fill="none"
                      stroke={edge.dead ? '#f43f5e' : '#10b981'}
                      strokeWidth={edge.dead ? 2.4 : 1.9}
                      strokeOpacity={0.78}
                      strokeDasharray={edge.dead ? '6 5' : undefined}
                      className="edge-flow"
                    />
                    <circle
                      r={edge.dead ? 3.5 : 3.2}
                      fill={edge.dead ? '#fb7185' : '#34d399'}
                      filter="url(#pkt-glow)"
                    >
                      <animateMotion dur={edge.dead ? '1.2s' : '2.4s'} repeatCount="indefinite" path={pathD} />
                    </circle>
                    <rect x={mx - 68} y={my - 10} width="136" height="20" rx="5" fill="#0B0F17" stroke={edge.dead ? '#f43f5e' : '#1e293b'} />
                    <text x={mx} y={my + 4} textAnchor="middle" fill={edge.dead ? '#fda4af' : '#94a3b8'} fontFamily="monospace" fontSize="9.5">
                      {edge.envKey.slice(0, 14)} → :{edge.targetPort}
                    </text>
                  </g>
                );
              })}
            </svg>

            {nodes.map((n) => {
              const selected = selectedId === n.id;
              const border =
                n.status === 'dead'
                  ? 'border-rose-500/75 bg-rose-950/25 shadow-[0_0_24px_-6px_rgba(244,63,94,0.45)]'
                  : n.status === 'conflict'
                    ? 'border-amber-500/75 bg-amber-950/20 shadow-[0_0_24px_-6px_rgba(245,158,11,0.4)]'
                    : 'border-emerald-500/50 bg-[#111827]/95 shadow-[0_0_20px_-8px_rgba(16,185,129,0.35)]';
              const spark = cpuHistory[n.id] ?? [n.cpuPct, n.cpuPct];
              return (
                <div
                  key={n.id}
                  data-svc-card
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(n.id);
                    dragRef.current = { type: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y };
                  }}
                  style={{ left: n.x, top: n.y, width: 264 }}
                  className={`absolute select-none rounded-xl border p-3.5 transition-shadow ${border} ${selected ? 'ring-2 ring-sky-400' : ''}`}
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
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 font-mono text-slate-300">
                        <Activity className="h-3 w-3 text-sky-400" />
                        {n.cpuPct.toFixed(1)}% · {n.memMb}M
                      </span>
                      {n.status !== 'dead' && <MiniSparkline values={spark} color={n.status === 'conflict' ? '#f59e0b' : '#34d399'} />}
                    </div>
                    {n.port > 0 && n.status !== 'dead' ? (
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
                    ) : n.status === 'dead' ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          bootMissingService(n.port);
                        }}
                        className="inline-flex items-center gap-1 rounded bg-rose-500/25 px-1.5 py-0.5 font-mono text-[10px] text-rose-200 hover:bg-rose-500/40"
                      >
                        <Plus className="h-3 w-3" /> Boot
                      </button>
                    ) : null}
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
            {selectedNode && selectedNode.pid && (
              <div className="mt-2.5 flex items-center justify-between rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs">
                <span className="font-mono text-slate-300">
                  PID {selectedNode.pid} · :{selectedNode.port}
                </span>
                {confirmKillPid === selectedNode.pid ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => killProcess(selectedNode.pid!)}
                      className="rounded bg-rose-600 px-2 py-0.5 font-medium text-white hover:bg-rose-500"
                    >
                      Confirm Stop
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
              <span>{revealedSecrets ? 'Hide tags' : 'Show risk tags'}</span>
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
