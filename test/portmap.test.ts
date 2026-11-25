import { describe, expect, it } from 'vitest';
import { maskSecretValue, parseDockerCompose, parseEnvContent } from '../src/core/envParser.ts';
import {
  buildDemoPreset,
  buildDemoTopology,
  exportSanitizedEnvExample,
  suggestNextFreePort,
} from '../src/core/scanner.ts';

describe('portmap .env masking & topology inference', () => {
  it('masks secrets and URL credentials while preserving referenced localhost ports', () => {
    const entries = parseEnvContent(
      [
        'DATABASE_URL=postgres://admin:topsecret@localhost:5432/prod',
        'API_SECRET_KEY=sk_live_1234567890abcdef',
        'REDIS_URL=redis://127.0.0.1:6379',
      ].join('\n'),
      'api/.env',
      'api',
    );

    const db = entries.find((e) => e.key === 'DATABASE_URL')!;
    expect(db.isSecret).toBe(true);
    expect(db.maskedValue).not.toContain('topsecret');
    expect(db.referencedPorts).toContain(5432);

    const secret = entries.find((e) => e.key === 'API_SECRET_KEY')!;
    expect(secret.isSecret).toBe(true);
    expect(secret.maskedValue).toContain('••••••');
    expect(maskSecretValue('SHORT_TOKEN', 'abc').masked).toBe('••••••');
  });

  it('parses docker-compose services, ports, and environment references', () => {
    const services = parseDockerCompose(
      `services:
  web:
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://localhost:8080
  db:
    ports:
      - "5432:5432"`,
      'docker-compose.yml',
    );
    expect(services).toHaveLength(2);
    expect(services[0].ports).toEqual([3000]);
    expect(services[0].envVars[0].referencedPorts).toEqual([8080]);
  });

  it('builds demo topology with port conflicts and red dead .env targets', () => {
    const snap = buildDemoTopology();
    expect(snap.conflicts.some((c) => c.port === 8080)).toBe(true);
    expect(snap.deadTargets).toContain(6379);
    expect(snap.edges.some((e) => e.dead && e.targetPort === 6379)).toBe(true);
  });

  it('provides AI RAG and Payments demo presets plus free-port suggestion & .env.example export', () => {
    const rag = buildDemoPreset('ai-rag');
    expect(rag.nodes.some((n) => n.port === 11434)).toBe(true);
    expect(rag.deadTargets).toContain(6379);

    const pay = buildDemoPreset('payments');
    expect(pay.conflicts.some((c) => c.port === 4000)).toBe(true);

    expect(suggestNextFreePort([8080, 8081], 8080)).toBe(8082);
    const exported = exportSanitizedEnvExample(rag.envVars);
    expect(exported).toContain('<REDACTED_SECRET>');
    expect(exported).not.toContain('sk-proj-998811223344aabbccdd');
  });
});
