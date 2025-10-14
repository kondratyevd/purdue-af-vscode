VSCode CILogon Kubernetes Connector — Refined Implementation Plan

Goal

A lightweight, credible, and secure implementation of a VS Code extension + minimal backend (Broker) that connects users to their JupyterHub-managed Kubernetes pods via CILogon authentication — without kubeconfigs and without unnecessary abstraction layers.

The design prioritizes:
	•	Simplicity — minimal moving parts.
	•	Auditability — every component small enough to review quickly.
	•	Maintainability — one language per part, clear separation.
	•	Security — no long-lived tokens, no secret sprawl.

⸻

Simplified Architecture Overview

Components
	1.	Broker (Go) — handles CILogon auth, launches JupyterHub pods, creates short-lived ServiceAccount tokens, proxies exec/tunnel connections.
	2.	VS Code Extension (TypeScript) — user-facing component providing the “Connect” flow, calls Broker, and connects to the user’s container.
	3.	Helm Chart (YAML) — minimal Kubernetes deployment for Broker + RBAC.

Component Interaction

VSCode (desktop)
   ↓  (HTTP + WSS)
Broker (Go)
   ↓  (K8s API + JupyterHub REST)
Kubernetes + JupyterHub


⸻

Lean Project Structure

project-root/
├── broker/              # Go backend
│   ├── main.go          # single entry point
│   ├── auth.go          # CILogon OIDC handler
│   ├── session.go       # session + token management
│   ├── k8s.go           # minimal client for SA, RoleBinding, TokenRequest
│   ├── tunnel.go        # WebSocket handler bridging to K8s exec/port-forward
│   └── jupyterhub.go    # lightweight client to spawn/verify user pod
├── vscode-extension/    # VS Code extension
│   ├── src/extension.ts # entry file with 'Connect' command
│   ├── src/broker.ts    # simple REST + WebSocket client
│   └── src/auth.ts      # PKCE login flow
├── charts/broker/       # Helm chart (deployment + service + RBAC)
└── README.md


⸻

Broker Design

Language: Go (standard lib + net/http, gorilla/websocket, client-go)

Responsibilities
	•	Serve /auth/start and /auth/callback for CILogon.
	•	Exchange code for token, issue short-lived JWT to VS Code.
	•	Call JupyterHub API to ensure pod is running.
	•	Create short-lived ServiceAccount and RoleBinding for that pod.
	•	Use TokenRequest API for 30–60 min tokens.
	•	Provide /session endpoint returning pod info + signed tunnel token.
	•	/tunnel/:session_id endpoint upgrading to WebSocket and relaying to Kubernetes API for exec/portforward.

Security Rules
	•	No persistent storage in MVP — in-memory map for sessions.
	•	Short TTL tokens only; refresh via CILogon refresh token if needed.
	•	RBAC: scoped to one namespace + pod (using resourceNames).

Minimal API

Method	Path	Purpose
GET	/auth/start	Start CILogon OIDC PKCE flow
GET	/auth/callback	Handle OAuth redirect
POST	/session	Ensure pod + create ephemeral SA/token
WS	/tunnel/:session	Proxy exec/portforward


⸻

VS Code Extension Design

Language: TypeScript
Dependencies: vscode, axios, ws

Responsibilities
	•	Provide “Connect to Cluster” button.
	•	Launch browser for CILogon login (PKCE).
	•	Call Broker /session → get pod + tunnel info.
	•	Open WebSocket connection → provide terminal + file access.

Minimal Feature Set (MVP)
	•	✅ Auth flow via CILogon
	•	✅ Connect to running pod
	•	✅ Terminal support (PTY over WS)
	•	✅ File browsing (simple exec-based cat/tar)

No fancy abstractions, no persistence, no heavy UI.

Extension File Structure

/extension
├── extension.ts       # register command + main logic
├── auth.ts            # PKCE helper
├── broker.ts          # REST client (start auth, create session)
└── remote.ts          # WebSocket-based remote bridge


⸻

Helm Chart

Focus on deployment and RBAC only.

Minimal templates
	•	deployment.yaml (1 replica, env from secret/configmap)
	•	service.yaml
	•	serviceaccount.yaml
	•	rbac.yaml (allow create SA + RoleBinding in user namespaces)

Example values.yaml

auth:
  oidc:
    issuer: "https://cilogon.org"
    clientID: "TODO"
    redirectURL: "https://broker.example.org/callback"

jupyterhub:
  apiUrl: "https://jupyterhub.example.org/hub/api"
  apiToken: "TODO"


⸻

Simplified Development Workflow
	1.	Broker

cd broker
go run main.go


	2.	VS Code Extension

cd vscode-extension
npm run watch


	3.	Deploy Broker

helm install broker ./charts/broker



⸻

Testing & Validation
	•	Unit tests for Broker (go test ./broker/...).
	•	Mock JupyterHub responses for local testing.
	•	VS Code extension debug mode (F5) for live connect.

⸻

Security & Reviewability Principles
	•	Prefer short-lived tokens + server-stored refresh.
	•	Explicitly log all API calls with user identity (JSON logs).
	•	Avoid dependency sprawl — no heavy frameworks.
	•	Keep Broker <1500 LOC total; readable by security reviewers.
	•	No static secrets in repo.

⸻

Summary

This refined plan removes excessive modularization, over-engineering, and unnecessary CI/CD boilerplate. It defines a small, auditable system:
	•	One Go binary for Broker.
	•	One VS Code extension (~3–5 files).
	•	One Helm chart for deployment.

Goal: a practical proof-of-concept that feels professional, secure, and lean — credible to security auditors and maintainers alike.