export interface EnvVarEntry {
  key: string;
  maskedValue: string;
  rawPreview?: string;
  isSecret: boolean;
  sourceFile: string;
  serviceHint: string;
  referencedPorts: number[];
}

export interface ServiceNode {
  id: string;
  name: string;
  kind: 'process' | 'docker' | 'env-only' | 'dead-target';
  port: number;
  protocol: 'tcp';
  address: string;
  pid: number | null;
  command: string;
  cpuPct: number;
  memMb: number;
  containerId?: string;
  image?: string;
  status: 'healthy' | 'conflict' | 'dead';
  envCount: number;
  x: number;
  y: number;
}

export interface ServiceEdge {
  id: string;
  source: string;
  target: string;
  envKey: string;
  targetPort: number;
  dead: boolean;
  label: string;
}

export interface PortConflict {
  port: number;
  pids: number[];
  commands: string[];
}

export interface TopologySnapshot {
  scannedAt: string;
  scanDir: string;
  isDemo: boolean;
  nodes: ServiceNode[];
  edges: ServiceEdge[];
  envVars: EnvVarEntry[];
  conflicts: PortConflict[];
  deadTargets: number[];
}
