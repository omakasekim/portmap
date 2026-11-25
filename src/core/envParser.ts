import type { EnvVarEntry } from './types.ts';

const SECRET_KEY_RE = /(secret|token|password|passwd|pwd|api_?key|private|auth|credential|jwt|signing|master_key)/i;
const URL_WITH_CREDS_RE = /^([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@(.+)$/i;
const LOCAL_PORT_RE = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|postgres|redis|host\.docker\.internal):(\d{2,5})/gi;

export function maskSecretValue(key: string, value: string): { masked: string; isSecret: boolean } {
  const urlCreds = URL_WITH_CREDS_RE.exec(value);
  if (urlCreds) {
    return {
      masked: `${urlCreds[1]}${urlCreds[2]}:••••••••@${urlCreds[4]}`,
      isSecret: true,
    };
  }
  if (SECRET_KEY_RE.test(key)) {
    if (value.length <= 6) return { masked: '••••••', isSecret: true };
    return { masked: `${value.slice(0, 3)}••••••${value.slice(-2)}`, isSecret: true };
  }
  return { masked: value, isSecret: false };
}

export function extractLocalPorts(value: string): number[] {
  const ports = new Set<number>();
  let m: RegExpExecArray | null;
  LOCAL_PORT_RE.lastIndex = 0;
  while ((m = LOCAL_PORT_RE.exec(value)) !== null) {
    const port = Number(m[1]);
    if (port > 0 && port <= 65535) ports.add(port);
  }
  if (/^\d{2,5}$/.test(value.trim()) && Number(value.trim()) >= 80 && Number(value.trim()) <= 65535) {
    ports.add(Number(value.trim()));
  }
  return Array.from(ports);
}

export function parseEnvContent(content: string, sourceFile: string, serviceHint: string): EnvVarEntry[] {
  const entries: EnvVarEntry[] = [];
  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf('=');
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let val = cleaned.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    const { masked, isSecret } = maskSecretValue(key, val);
    const referencedPorts = key === 'PORT' || /_(PORT|URL|URI|HOST|ENDPOINT|ADDR)$/i.test(key) || /localhost|127\.0\.0\.1/.test(val)
      ? extractLocalPorts(val)
      : [];

    entries.push({
      key,
      maskedValue: masked,
      isSecret,
      sourceFile,
      serviceHint,
      referencedPorts,
    });
  }
  return entries;
}

export interface ComposeService {
  name: string;
  ports: number[];
  dependsOn: string[];
  envVars: EnvVarEntry[];
}

export function parseDockerCompose(content: string, sourceFile: string): ComposeService[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const services: ComposeService[] = [];
  let inServices = false;
  let cur: ComposeService | null = null;
  let section: 'none' | 'ports' | 'depends_on' | 'environment' = 'none';

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.search(/\S/);
    const trimmed = raw.trim();

    if (indent === 0) {
      inServices = trimmed === 'services:';
      cur = null;
      section = 'none';
      continue;
    }
    if (!inServices) continue;

    if (indent === 2 && trimmed.endsWith(':')) {
      cur = { name: trimmed.slice(0, -1), ports: [], dependsOn: [], envVars: [] };
      services.push(cur);
      section = 'none';
      continue;
    }

    if (!cur) continue;

    if (indent === 4 && trimmed.endsWith(':')) {
      const k = trimmed.slice(0, -1);
      section = k === 'ports' || k === 'depends_on' || k === 'environment' ? k : 'none';
      continue;
    }

    if (section === 'ports' && trimmed.startsWith('-')) {
      const mapping = trimmed.slice(1).trim().replace(/['"]/g, '');
      const parts = mapping.split(':');
      const hostPort = Number(parts.length >= 2 ? parts[parts.length - 2] : parts[0]);
      if (Number.isInteger(hostPort) && hostPort > 0) cur.ports.push(hostPort);
    } else if (section === 'depends_on' && trimmed.startsWith('-')) {
      cur.dependsOn.push(trimmed.slice(1).trim());
    } else if (section === 'environment') {
      const clean = trimmed.startsWith('-') ? trimmed.slice(1).trim() : trimmed;
      const sep = clean.includes('=') ? '=' : ':';
      const idx = clean.indexOf(sep);
      if (idx > 0) {
        const key = clean.slice(0, idx).trim();
        const val = clean.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        const { masked, isSecret } = maskSecretValue(key, val);
        cur.envVars.push({
          key,
          maskedValue: masked,
          isSecret,
          sourceFile,
          serviceHint: cur.name,
          referencedPorts: extractLocalPorts(val),
        });
      }
    }
  }

  return services;
}
