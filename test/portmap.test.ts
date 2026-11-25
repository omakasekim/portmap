import { describe, expect, it } from 'vitest';
import { extractLocalPorts, maskSecretValue, parseDockerCompose, parseEnvContent } from '../src/core/envParser.ts';
import { buildDemoTopology, buildTopologySnapshot } from '../src/core/scanner.ts';

describe('portmap env parser & topology builder', () => {
  it('masks secrets and URL credentials while preserving localhost target ports', () => {
    const vars = parseEnvContent(
      [
        'PORT=8080',
        'STRIPE_SECRET_KEY=sk_live_51AbCdEfGhIjKlMnOp',
        'DATABASE_URL=postgres://admin:topsecret@localhost:5432/appdb',
        'REDIS_URL=redis://127.0.0.1:6379',
      ].join('\n'),
      'api/.env',
      'api',
    );

    const stripe = vars.find((v) => v.key === 'STRIPE_SECRET_KEY');
    expect(stripe?.isSecret).toBe(true);
    expect(stripe?.maskedValue).not.toContain('AbCdEf');

    const db = vars.find((v) => v.key === 'DATABASE_URL');
    expect(db?.maskedValue).toBe('postgres://admin:••••••••@localhost:5432/appdb');
    expect(db?.referencedPorts).toContain(5432);
    expect(extractLocalPorts('http://127.0.0.1:9001/health')).toEqual([9001]);
  });

  it('parses docker-compose services, ports, and dependencies cleanly', () => {
    const services = parseDockerCompose(
      `
services:
  api:
    ports:
      - "8080:8080"
    depends_on:
      - db
    environment:
      - REDIS_URL=redis://localhost:6379
`,
      'docker-compose.yml',
    );
    expect(services.length).toBe(1);
    expect(services[0].ports).toEqual([8080]);
    expect(services[0].dependsOn).toEqual(['db']);
    expect(services[0].envVars[0].referencedPorts).toEqual([6379]);
  });

  it('detects dead .env targets and port conflicts in topology snapshot', () => {
    const demo = buildDemoTopology();
    expect(demo.conflicts.some((c) => c.port === 8080)).toBe(true);
    expect(demo.deadTargets).toContain(6379);
    expect(demo.edges.some((e) => e.dead && e.targetPort === 6379)).toBe(true);

    const custom = buildTopologySnapshot({
      scanDir: '.',
      isDemo: false,
      sockets: [{ pid: 100, port: 4000, address: '127.0.0.1', command: 'node', cpuPct: 1, memMb: 50 }],
      containers: [],
      files: [{ relativePath: '.env', serviceHint: 'node', kind: 'env', content: 'API=http://localhost:9999' }],
    });
    expect(custom.deadTargets).toEqual([9999]);
  });
});
