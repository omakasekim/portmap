import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildDemoTopology,
  buildTopologySnapshot,
  type DiscoveredFile,
  type DockerContainerInfo,
  type ListeningSocket,
} from '../core/scanner.ts';

const execFileAsync = promisify(execFile);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function parseArgs(argv: string[]) {
  let scanDir = process.cwd();
  let demo = false;
  let port = 4322;
  let noOpen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') demo = true;
    else if (a === '--no-open') noOpen = true;
    else if (a === '--port' && argv[i + 1]) port = Number(argv[++i]) || 4322;
    else if (a.startsWith('--port=')) port = Number(a.slice(7)) || 4322;
    else if (!a.startsWith('-')) scanDir = resolve(a);
  }
  return { scanDir, demo, port, noOpen };
}

async function queryProcessMetrics(pids: number[]): Promise<Map<number, { cpuPct: number; memMb: number; command: string }>> {
  const out = new Map<number, { cpuPct: number; memMb: number; command: string }>();
  if (pids.length === 0) return out;
  try {
    const { stdout } = await execFileAsync('ps', ['-p', pids.join(','), '-o', 'pid=,pcpu=,rss=,comm='], {
      timeout: 3000,
    });
    for (const line of stdout.split('\n')) {
      const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!m) continue;
      out.set(Number(m[1]), {
        cpuPct: Number(m[2]) || 0,
        memMb: Math.round((Number(m[3]) || 0) / 1024),
        command: m[4].trim().split('/').pop() ?? m[4].trim(),
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function queryListeningSockets(): Promise<ListeningSocket[]> {
  const rawEntries: Array<{ pid: number; port: number; address: string; command: string }> = [];

  try {
    const { stdout } = await execFileAsync('lsof', ['-iTCP', '-sTCP:LISTEN', '-n', '-P', '-F', 'pcn'], {
      timeout: 4000,
    });
    let curPid = 0;
    let curCmd = 'process';
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) curPid = Number(line.slice(1)) || 0;
      else if (line.startsWith('c')) curCmd = line.slice(1).trim() || 'process';
      else if (line.startsWith('n')) {
        const name = line.slice(1).trim();
        const m = /^(?:\[([^\]]+)\]|([^:]+)|\*):(\d+)$/.exec(name);
        if (m && curPid > 0) {
          const addr = m[1] || m[2] || '127.0.0.1';
          const port = Number(m[3]);
          if (port > 0) rawEntries.push({ pid: curPid, port, address: addr === '*' ? '0.0.0.0' : addr, command: curCmd });
        }
      }
    }
  } catch {
    try {
      const { stdout } = await execFileAsync('ss', ['-tlnp'], { timeout: 3000 });
      for (const line of stdout.split('\n').slice(1)) {
        const pm = /(\d+)\s*$/.exec(line);
        const lm = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\*):(\d+)/.exec(line);
        const pidm = /pid=(\d+)/.exec(line);
        if (lm) {
          rawEntries.push({
            pid: pidm ? Number(pidm[1]) : Number(pm?.[1] ?? 0) || 0,
            port: Number(lm[1]),
            address: '127.0.0.1',
            command: 'socket',
          });
        }
      }
    } catch {
      /* fallback empty */
    }
  }

  const uniquePids = Array.from(new Set(rawEntries.map((e) => e.pid).filter((p) => p > 0)));
  const metrics = await queryProcessMetrics(uniquePids);

  return rawEntries.map((e) => {
    const meta = metrics.get(e.pid);
    return {
      pid: e.pid,
      port: e.port,
      address: e.address,
      command: meta?.command || e.command,
      cpuPct: meta?.cpuPct ?? 0,
      memMb: meta?.memMb ?? 0,
    };
  });
}

async function queryDockerContainers(): Promise<DockerContainerInfo[]> {
  try {
    const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{json .}}'], { timeout: 2500 });
    const out: DockerContainerInfo[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line) as { ID?: string; Names?: string; Image?: string; Ports?: string };
      const ports: number[] = [];
      const matches = (obj.Ports ?? '').matchAll(/:(\d+)->/g);
      for (const m of matches) ports.push(Number(m[1]));
      out.push({
        id: obj.ID ?? 'container',
        name: obj.Names ?? 'container',
        image: obj.Image ?? 'unknown',
        ports,
      });
    }
    return out;
  } catch {
    return [];
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '.next', '.turbo']);

function scanLocalEnvFiles(baseDir: string, depth = 0): DiscoveredFile[] {
  if (depth > 2 || !existsSync(baseDir)) return [];
  const results: DiscoveredFile[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return [];
  }
  for (const name of entries) {
    const full = join(baseDir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) {
        results.push(...scanLocalEnvFiles(full, depth + 1));
      }
      continue;
    }
    if (name === '.env' || name.startsWith('.env.')) {
      try {
        results.push({
          relativePath: relative(baseDir, full) || name,
          serviceHint: baseDir.split('/').pop() || 'root',
          kind: 'env',
          content: readFileSync(full, 'utf8'),
        });
      } catch {
        /* ignore unreadable */
      }
    } else if (/^docker-compose(\..+)?\.ya?ml$/.test(name)) {
      try {
        results.push({
          relativePath: relative(baseDir, full) || name,
          serviceHint: baseDir.split('/').pop() || 'compose',
          kind: 'compose',
          content: readFileSync(full, 'utf8'),
        });
      } catch {
        /* ignore */
      }
    }
  }
  return results;
}

async function scanLive(scanDir: string, demo: boolean) {
  if (demo) return buildDemoTopology(scanDir);
  const [sockets, containers] = await Promise.all([queryListeningSockets(), queryDockerContainers()]);
  const files = scanLocalEnvFiles(scanDir);
  if (sockets.length === 0 && files.length === 0) {
    return buildDemoTopology(scanDir);
  }
  return buildTopologySnapshot({ scanDir, isDemo: false, sockets, containers, files });
}

function openBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* ignore */
  }
}

export async function startCli(argv: string[]) {
  const { scanDir, demo, port, noOpen } = parseArgs(argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const clientDir = resolve(here, 'client');
  let modeDemo = demo;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/snapshot') {
      const wantDemo = url.searchParams.get('demo') === '1' ? true : url.searchParams.get('demo') === '0' ? false : modeDemo;
      const snap = await scanLive(scanDir, wantDemo);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snap));
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const push = async () => {
        const snap = await scanLive(scanDir, modeDemo);
        res.write(`data: ${JSON.stringify(snap)}\n\n`);
      };
      await push();
      const iv = setInterval(() => {
        push().catch(() => {});
      }, 2500);
      req.on('close', () => clearInterval(iv));
      return;
    }

    if (url.pathname === '/api/mode' && req.method === 'POST') {
      modeDemo = url.searchParams.get('demo') === '1';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ demo: modeDemo }));
      return;
    }

    if (url.pathname === '/api/kill' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const parsed = JSON.parse(body || '{}') as { pid?: number; confirm?: boolean };
        if (!parsed.confirm || !Number.isInteger(parsed.pid) || parsed.pid! <= 1 || parsed.pid === process.pid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or unconfirmed PID' }));
          return;
        }
        process.kill(parsed.pid!, 'SIGTERM');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ killed: parsed.pid }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'kill failed' }));
      }
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const target = resolve(clientDir, rel);
    const filePath = target.startsWith(clientDir) && existsSync(target) && statSync(target).isFile()
      ? target
      : join(clientDir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });

  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  const listenUrl = `http://127.0.0.1:${port}`;
  console.log(`portmap listening at ${listenUrl} (dir=${scanDir}, demo=${demo})`);
  if (!noOpen) openBrowser(listenUrl);
}
