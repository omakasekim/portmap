# portmap

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-10b981.svg)
![SSE Live](https://img.shields.io/badge/updates-SSE%20live-38bdf8.svg)

> Zero-config CLI & live topology visualizer that maps listening localhost ports, processes, Docker containers, and `.env` / `docker-compose.yml` service links.

## Quickstart

```bash
npm install && npm run build
npx portmap --demo                 # Simulated microservice stack with conflict + dead Redis target
npx portmap .                      # Scan live listening ports, Docker containers, and local .env files
```

## Highlights

- **Cross-Platform Process & Docker Scanner:** Safely queries `lsof` / `ss`, `ps` CPU/RAM metrics, and optional `docker ps` containers with graceful fallbacks.
- **Secret-Safe `.env` & Compose Inference:** Automatically masks API keys, passwords, and DSN credentials while detecting `localhost:<PORT>` / `127.0.0.1:<PORT>` references, dead target ports (red), and port collisions (amber).
- **Live SSE Topology Map:** Draggable service nodes, directional dependency edges, Copy Local URL, Masked Env Inspector, and two-step confirmed process termination.

## Verify

```bash
npm test
npm run build
```
