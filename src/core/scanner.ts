import { parseEnvContent, parseDockerCompose } from './envParser.ts';
import type { EnvVarEntry, PortConflict, ServiceEdge, ServiceNode, TopologySnapshot } from './types.ts';

export interface ListeningSocket {
  pid: number;
  port: number;
  address: string;
  command: string;
  cpuPct: number;
  memMb: number;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  ports: number[];
}

export interface DiscoveredFile {
  relativePath: string;
  serviceHint: string;
  kind: 'env' | 'compose';
  content: string;
}

export function buildTopologySnapshot(input: {
  scanDir: string;
  isDemo: boolean;
  sockets: ListeningSocket[];
  containers: DockerContainerInfo[];
  files: DiscoveredFile[];
}): TopologySnapshot {
  const envVars: EnvVarEntry[] = [];
  const composeServices: ReturnType<typeof parseDockerCompose> = [];

  for (const f of input.files) {
    if (f.kind === 'env') {
      envVars.push(...parseEnvContent(f.content, f.relativePath, f.serviceHint));
    } else {
      const parsed = parseDockerCompose(f.content, f.relativePath);
      composeServices.push(...parsed);
      for (const s of parsed) envVars.push(...s.envVars);
    }
  }

  // Group listening sockets by port to detect conflicts
  const socketsByPort = new Map<number, ListeningSocket[]>();
  for (const sock of input.sockets) {
    const arr = socketsByPort.get(sock.port) ?? [];
    if (!arr.some((s) => s.pid === sock.pid)) arr.push(sock);
    socketsByPort.set(sock.port, arr);
  }

  const conflicts: PortConflict[] = [];
  for (const [port, list] of socketsByPort) {
    if (list.length > 1) {
      conflicts.push({
        port,
        pids: list.map((x) => x.pid),
        commands: list.map((x) => x.command),
      });
    }
  }

  // Build live service nodes
  const nodes: ServiceNode[] = [];
  const livePortMap = new Map<number, ServiceNode>();

  const containerByPort = new Map<number, DockerContainerInfo>();
  for (const c of input.containers) {
    for (const p of c.ports) containerByPort.set(p, c);
  }

  const sortedPorts = Array.from(socketsByPort.keys()).sort((a, b) => a - b);
  sortedPorts.forEach((port, idx) => {
    const list = socketsByPort.get(port)!;
    const primary = list[0];
    const docker = containerByPort.get(port);
    const hasConflict = list.length > 1;
    const hintMatches = envVars.filter(
      (ev) => ev.key === 'PORT' && ev.referencedPorts.includes(port),
    );
    const name = docker?.name || hintMatches[0]?.serviceHint || `${primary.command}:${port}`;
    const envCount = envVars.filter(
      (ev) => ev.serviceHint.toLowerCase() === name.toLowerCase(),
    ).length;

    const node: ServiceNode = {
      id: `port:${port}`,
      name,
      kind: docker ? 'docker' : 'process',
      port,
      protocol: 'tcp',
      address: primary.address,
      pid: primary.pid,
      command: list.map((s) => s.command).join(' + '),
      cpuPct: primary.cpuPct,
      memMb: primary.memMb,
      containerId: docker?.id,
      image: docker?.image,
      status: hasConflict ? 'conflict' : 'healthy',
      envCount,
      x: 90 + (idx % 3) * 320,
      y: 90 + Math.floor(idx / 3) * 200,
    };
    nodes.push(node);
    livePortMap.set(port, node);
  });

  // Infer edges from .env localhost:<port> references and create red dead-target nodes if missing
  const edges: ServiceEdge[] = [];
  const edgeKeys = new Set<string>();
  const deadTargetsSet = new Set<number>();

  // Map serviceHint -> source node
  const findSourceNode = (hint: string): ServiceNode | undefined => {
    const h = hint.toLowerCase();
    const byName = nodes.find((n) => n.name.toLowerCase().includes(h) || h.includes(n.name.toLowerCase()));
    if (byName) return byName;
    const ownPort = envVars.find(
      (ev) => ev.serviceHint.toLowerCase() === h && ev.key === 'PORT' && ev.referencedPorts[0],
    )?.referencedPorts[0];
    if (ownPort && livePortMap.has(ownPort)) return livePortMap.get(ownPort);
    return undefined;
  };

  for (const ev of envVars) {
    if (ev.key === 'PORT') continue;
    for (const targetPort of ev.referencedPorts) {
      let src = findSourceNode(ev.serviceHint);
      if (!src) {
        const syntheticId = `env:${ev.serviceHint}`;
        src = nodes.find((n) => n.id === syntheticId);
        if (!src) {
          src = {
            id: syntheticId,
            name: ev.serviceHint,
            kind: 'env-only',
            port: 0,
            protocol: 'tcp',
            address: '127.0.0.1',
            pid: null,
            command: ev.sourceFile,
            cpuPct: 0,
            memMb: 0,
            status: 'healthy',
            envCount: envVars.filter((x) => x.serviceHint === ev.serviceHint).length,
            x: 90 + (nodes.length % 3) * 320,
            y: 90 + Math.floor(nodes.length / 3) * 200,
          };
          nodes.push(src);
        }
      }

      let dst = livePortMap.get(targetPort);
      const isDead = !dst;
      if (!dst) {
        deadTargetsSet.add(targetPort);
        const deadId = `dead:${targetPort}`;
        dst = nodes.find((n) => n.id === deadId);
        if (!dst) {
          dst = {
            id: deadId,
            name: `Unbound :${targetPort}`,
            kind: 'dead-target',
            port: targetPort,
            protocol: 'tcp',
            address: '127.0.0.1',
            pid: null,
            command: 'no listener',
            cpuPct: 0,
            memMb: 0,
            status: 'dead',
            envCount: 0,
            x: 90 + (nodes.length % 3) * 320,
            y: 90 + Math.floor(nodes.length / 3) * 200,
          };
          nodes.push(dst);
        }
      }

      if (src.id !== dst.id) {
        const edgeId = `${src.id}->${dst.id}:${ev.key}`;
        if (!edgeKeys.has(edgeId)) {
          edgeKeys.add(edgeId);
          edges.push({
            id: edgeId,
            source: src.id,
            target: dst.id,
            envKey: ev.key,
            targetPort,
            dead: isDead,
            label: `${ev.key} → :${targetPort}${isDead ? ' (DEAD)' : ''}`,
          });
        }
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    scanDir: input.scanDir,
    isDemo: input.isDemo,
    nodes,
    edges,
    envVars,
    conflicts,
    deadTargets: Array.from(deadTargetsSet).sort((a, b) => a - b),
  };
}

export function buildDemoTopology(scanDir = './demo-stack'): TopologySnapshot {
  const sockets: ListeningSocket[] = [
    { pid: 41012, port: 3000, address: '127.0.0.1', command: 'next-server', cpuPct: 2.4, memMb: 184 },
    { pid: 41088, port: 8080, address: '0.0.0.0', command: 'api-gateway', cpuPct: 6.1, memMb: 242 },
    { pid: 39811, port: 8080, address: '127.0.0.1', command: 'legacy-proxy', cpuPct: 0.4, memMb: 38 },
    { pid: 41150, port: 8091, address: '127.0.0.1', command: 'auth-worker', cpuPct: 1.8, memMb: 96 },
    { pid: 1842, port: 5432, address: '127.0.0.1', command: 'postgres', cpuPct: 1.2, memMb: 148 },
  ];

  const containers: DockerContainerInfo[] = [
    { id: 'c8f102ab', name: 'chronos-postgres', image: 'postgres:16-alpine', ports: [5432] },
  ];

  const files: DiscoveredFile[] = [
    {
      relativePath: 'web/.env.local',
      serviceHint: 'next-server',
      kind: 'env',
      content: [
        'PORT=3000',
        'NEXT_PUBLIC_API_URL=http://localhost:8080/v1',
        'NEXT_PUBLIC_AUTH_URL=http://localhost:8091',
        'SESSION_SECRET=sk_live_991828172abcdef',
      ].join('\n'),
    },
    {
      relativePath: 'api/.env',
      serviceHint: 'api-gateway',
      kind: 'env',
      content: [
        'PORT=8080',
        'DATABASE_URL=postgres://chronos:supersecretpass@localhost:5432/vault',
        'REDIS_URL=redis://localhost:6379',
        'AUTH_RPC_URL=http://127.0.0.1:8091/verify',
        'STRIPE_SECRET_KEY=sk_test_51Pxy82910abc91',
      ].join('\n'),
    },
    {
      relativePath: 'worker/.env',
      serviceHint: 'auth-worker',
      kind: 'env',
      content: [
        'PORT=8091',
        'DATABASE_URL=postgres://chronos:supersecretpass@127.0.0.1:5432/vault',
        'METRICS_SINK=http://localhost:9090/ingest',
      ].join('\n'),
    },
  ];

  return buildTopologySnapshot({
    scanDir,
    isDemo: true,
    sockets,
    containers,
    files,
  });
}

export type DemoPresetId = 'chronos' | 'ai-rag' | 'payments';

export function buildDemoPreset(preset: DemoPresetId): TopologySnapshot {
  if (preset === 'chronos') return buildDemoTopology('./chronos-stack');

  if (preset === 'ai-rag') {
    const sockets: ListeningSocket[] = [
      { pid: 52010, port: 5173, address: '127.0.0.1', command: 'vite-ui', cpuPct: 1.9, memMb: 128 },
      { pid: 52044, port: 8000, address: '0.0.0.0', command: 'fastapi-orchestrator', cpuPct: 11.4, memMb: 412 },
      { pid: 52099, port: 11434, address: '127.0.0.1', command: 'ollama-runtime', cpuPct: 38.2, memMb: 3840 },
      { pid: 52120, port: 6333, address: '127.0.0.1', command: 'qdrant', cpuPct: 3.1, memMb: 512 },
    ];
    const containers: DockerContainerInfo[] = [
      { id: 'qd9912fa', name: 'qdrant-vector-db', image: 'qdrant/qdrant:v1.12', ports: [6333] },
    ];
    const files: DiscoveredFile[] = [
      {
        relativePath: 'frontend/.env.local',
        serviceHint: 'vite-ui',
        kind: 'env',
        content: 'PORT=5173\nVITE_API_ENDPOINT=http://localhost:8000/api\nVITE_TELEMETRY_URL=http://localhost:4318/v1/traces',
      },
      {
        relativePath: 'orchestrator/.env',
        serviceHint: 'fastapi-orchestrator',
        kind: 'env',
        content: [
          'PORT=8000',
          'OLLAMA_HOST=http://127.0.0.1:11434',
          'QDRANT_URL=http://localhost:6333',
          'REDIS_CACHE_URL=redis://localhost:6379/0',
          'OPENAI_API_KEY=sk-proj-998811223344aabbccdd',
        ].join('\n'),
      },
    ];
    return buildTopologySnapshot({ scanDir: './ai-rag-pipeline', isDemo: true, sockets, containers, files });
  }

  // Event-driven payments stack
  const sockets: ListeningSocket[] = [
    { pid: 61001, port: 3001, address: '127.0.0.1', command: 'checkout-web', cpuPct: 1.5, memMb: 145 },
    { pid: 61022, port: 4000, address: '0.0.0.0', command: 'ledger-api', cpuPct: 4.8, memMb: 210 },
    { pid: 61028, port: 4000, address: '127.0.0.1', command: 'webhook-relay', cpuPct: 0.9, memMb: 64 },
    { pid: 61089, port: 5433, address: '127.0.0.1', command: 'postgres', cpuPct: 2.3, memMb: 260 },
    { pid: 61110, port: 6379, address: '127.0.0.1', command: 'redis-server', cpuPct: 0.7, memMb: 54 },
  ];
  const containers: DockerContainerInfo[] = [
    { id: 'pg7720cc', name: 'payments-pg', image: 'postgres:16', ports: [5433] },
    { id: 'rd4410aa', name: 'payments-redis', image: 'redis:7-alpine', ports: [6379] },
  ];
  const files: DiscoveredFile[] = [
    {
      relativePath: 'checkout/.env',
      serviceHint: 'checkout-web',
      kind: 'env',
      content: 'PORT=3001\nLEDGER_API_URL=http://localhost:4000\nSTRIPE_PUBLISHABLE_KEY=pk_test_51abc',
    },
    {
      relativePath: 'ledger/.env',
      serviceHint: 'ledger-api',
      kind: 'env',
      content: [
        'PORT=4000',
        'DATABASE_URL=postgres://pay:secret_ledger_pw@localhost:5433/ledger',
        'REDIS_URL=redis://localhost:6379',
        'KAFKA_BROKER=127.0.0.1:9092',
        'WEBHOOK_SIGNING_SECRET=whsec_991188227733',
      ].join('\n'),
    },
  ];
  return buildTopologySnapshot({ scanDir: './payments-stack', isDemo: true, sockets, containers, files });
}

export function suggestNextFreePort(usedPorts: number[], desired: number): number {
  const used = new Set(usedPorts);
  let candidate = desired;
  while (used.has(candidate) && candidate < 65535) {
    candidate += 1;
  }
  return candidate;
}

export function exportSanitizedEnvExample(envVars: EnvVarEntry[]): string {
  const byFile = new Map<string, EnvVarEntry[]>();
  for (const ev of envVars) {
    const arr = byFile.get(ev.sourceFile) ?? [];
    arr.push(ev);
    byFile.set(ev.sourceFile, arr);
  }
  const chunks: string[] = ['# Generated by portmap (secrets automatically redacted)'];
  for (const [file, list] of byFile) {
    chunks.push('', `# --- ${file} ---`);
    for (const ev of list) {
      chunks.push(`${ev.key}=${ev.isSecret ? '<REDACTED_SECRET>' : ev.maskedValue}`);
    }
  }
  return chunks.join('\n') + '\n';
}
