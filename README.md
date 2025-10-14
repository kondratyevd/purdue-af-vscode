# VSCode CILogon Kubernetes Connector

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Go Version](https://img.shields.io/badge/Go-1.21+-blue.svg)](https://golang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9+-blue.svg)](https://www.typescriptlang.org/)

A secure, kubeconfig-free solution for connecting VS Code to JupyterHub-managed Kubernetes pods via CILogon authentication.

**Repository:** https://github.com/kondratyevd/purdue-af-vscode

## Architecture Overview

```
VS Code Extension (TypeScript)
    ↓ HTTP + WebSocket
Broker Service (Go)
    ↓ Kubernetes API + JupyterHub REST API
Kubernetes Cluster + JupyterHub
```

## Quick Start

### Prerequisites

- Go 1.21+
- Node.js 18+
- Kubernetes cluster with JupyterHub
- CILogon OIDC client credentials

### Broker Setup

1. **Clone and build:**
   ```bash
   git clone https://github.com/kondratyevd/purdue-af-vscode.git
   cd purdue-af-vscode
   cd broker
   go mod download
   go build -o bin/broker ./cmd/broker
   ```

2. **Build Docker image with Kaniko:**
   ```bash
   # Create registry secret
   kubectl create secret docker-registry geddes-registry-secret \
     --docker-server=geddes-registry.rcac.purdue.edu \
     --docker-username=YOUR_USERNAME \
     --docker-password=YOUR_PASSWORD \
     --docker-email="cms-dev@purdue.edu" \
     --namespace=cms-dev
   
   # Apply Kaniko job
   kubectl apply -f kaniko-build.yaml
   
   # Monitor build
   kubectl logs -f job/purdue-cms-broker-kaniko-build -n cms-dev
   ```

3. **Deploy to Kubernetes:**
   ```bash
   helm install broker ./charts/broker --namespace=cms-dev
   ```

### Extension Setup

1. **Install dependencies:**
   ```bash
   cd vscode-extension
   npm install
   ```

2. **Build extension:**
   ```bash
   npm run compile
   ```

3. **Package extension:**
   ```bash
   npm run package
   ```

4. **Install in VS Code:**
   - Open VS Code
   - Go to Extensions
   - Install from VSIX file

## Configuration

### Broker Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `LISTEN_ADDR` | Server listen address | `:8080` |
| `SESSION_TTL` | Session lifetime | `24h` |
| `JWT_SECRET` | JWT signing secret | Required |
| `OIDC_ISSUER` | CILogon issuer URL | `https://cilogon.org` |
| `OIDC_CLIENT_ID` | CILogon client ID | Required |
| `OIDC_CLIENT_SECRET` | CILogon client secret | Required |
| `OIDC_REDIRECT_URL` | OAuth redirect URL | Required |
| `JUPYTERHUB_API_URL` | JupyterHub API URL | Required |
| `JUPYTERHUB_API_TOKEN` | JupyterHub API token | Required |

### Extension Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `jupyterCluster.brokerUrl` | Broker service URL | `https://broker.example.org` |
| `jupyterCluster.autoConnect` | Auto-connect on startup | `false` |

## API Reference

### Broker Endpoints

- `GET /health` - Health check
- `GET /auth/start` - Start OIDC flow
- `GET /auth/callback` - Handle OIDC callback
- `POST /session` - Create session
- `GET /session/:id` - Get session details
- `DELETE /session/:id` - Delete session
- `WS /tunnel/:session_id` - WebSocket tunnel

### WebSocket Protocol

Messages are JSON objects with `type` and `payload` fields:

```json
{
  "type": "exec",
  "payload": {
    "command": "ls",
    "args": ["-la"],
    "stdin": false,
    "stdout": true,
    "stderr": true
  }
}
```

## Security Model

- **No kubeconfigs**: Users never handle Kubernetes credentials
- **Short-lived tokens**: ServiceAccount tokens expire in 1 hour
- **Pod-scoped RBAC**: RoleBindings limited to specific pods
- **Session isolation**: Each session gets unique ServiceAccount
- **Audit logging**: All operations logged with user identity

## Development

### Running Tests

```bash
# Broker tests
cd broker
go test -v -cover ./...

# Extension tests
cd vscode-extension
npm test
```

### Building Docker Image

```bash
cd broker
docker build -t broker:latest .
```

### Local Development

1. **Start broker:**
   ```bash
   cd broker
   go run ./cmd/broker
   ```

2. **Start extension in debug mode:**
   ```bash
   cd vscode-extension
   npm run watch
   # Press F5 in VS Code
   ```

## Troubleshooting

### Common Issues

1. **Authentication fails:**
   - Check CILogon client credentials
   - Verify redirect URL matches configuration
   - Check broker logs for OIDC errors

2. **Pod connection fails:**
   - Verify JupyterHub API token
   - Check user has running pod
   - Verify Kubernetes RBAC permissions

3. **WebSocket connection fails:**
   - Check firewall/ingress configuration
   - Verify session token validity
   - Check broker WebSocket upgrade logic

### Debug Mode

Enable debug logging:
```bash
export DEBUG=true
export LOG_LEVEL=debug
./bin/broker
```

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

## License

MIT License - see LICENSE file for details.
