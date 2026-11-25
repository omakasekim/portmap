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
