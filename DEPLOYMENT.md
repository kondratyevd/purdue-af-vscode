# VSCode CILogon Kubernetes Connector - Deployment Guide

This guide provides step-by-step instructions for deploying the VSCode CILogon Kubernetes Connector in a production environment.

## Prerequisites

- Kubernetes cluster (1.21+)
- Helm 3.x
- kubectl configured to access your cluster
- CILogon OIDC client credentials
- JupyterHub instance with API access
- Domain name for the broker service

## Step 1: Prepare CILogon OIDC Client

1. **Register with CILogon:**
   - Visit [CILogon](https://cilogon.org/)
   - Create an account and register your application
   - Note down your `client_id` and `client_secret`

2. **Configure Redirect URL:**
   - Set redirect URL to: `https://your-broker-domain.com/auth/callback`
   - Replace `your-broker-domain.com` with your actual domain

## Step 2: Prepare JupyterHub API Token

1. **Generate API Token:**
   ```bash
   # On your JupyterHub server
   jupyterhub token --user=admin
   ```

2. **Test API Access:**
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" \
        https://your-jupyterhub.com/hub/api/users
   ```

## Step 3: Build and Push Docker Image

### Option A: Using Kaniko (Recommended for Kubernetes)

1. **Set up registry credentials:**
   ```bash
   # Set environment variables
   export REGISTRY_USERNAME="your-username"
   export REGISTRY_PASSWORD="your-password"
   
   # Run the build script
   ./build-kaniko.sh build
   ```

2. **Manual Kaniko setup:**
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
   kubectl logs -f job/broker-kaniko-build -n cms-dev
   ```

### Option B: Local Docker Build

1. **Build locally:**
   ```bash
   cd broker
   docker build -t geddes-registry.rcac.purdue.edu/cms/broker:v1.0.0 .
   ```

2. **Push to registry:**
   ```bash
   docker push geddes-registry.rcac.purdue.edu/cms/broker:v1.0.0
   ```

## Step 4: Deploy Broker Service

1. **Create Kubernetes Secrets:**
   ```bash
   # Create OIDC secret
   kubectl create secret generic broker-oidc-secret \
     --from-literal=client-id=YOUR_CILOGON_CLIENT_ID \
     --from-literal=client-secret=YOUR_CILOGON_CLIENT_SECRET \
     --namespace=cms-dev
   
   # Create JupyterHub secret
   kubectl create secret generic broker-jupyterhub-secret \
     --from-literal=api-token=YOUR_JUPYTERHUB_TOKEN \
     --namespace=cms-dev
   ```

2. **Update Helm Values:**
   ```bash
   # Edit charts/broker/values.yaml
   auth:
     oidc:
       issuer: "https://cilogon.org"
       clientID: ""  # Will use secret
       clientSecretName: "broker-oidc-secret"
       redirectURL: "https://your-broker-domain.com/auth/callback"
   
   jupyterhub:
     apiUrl: "https://your-jupyterhub.com/hub/api"
     apiTokenName: "broker-jupyterhub-secret"
   
   ingress:
     enabled: true
     hosts:
       - host: your-broker-domain.com
         paths:
           - path: /
             pathType: Prefix
   ```

3. **Deploy with Helm:**
   ```bash
   helm install broker ./charts/broker \
     --namespace=cms-dev \
     --create-namespace
   ```

4. **Verify Deployment:**
   ```bash
   kubectl get pods -l app=broker
   kubectl get svc broker
   kubectl get ingress broker
   ```

## Step 4: Configure DNS and TLS

1. **Point DNS to your cluster:**
   - Create A record: `your-broker-domain.com` → `YOUR_CLUSTER_IP`

2. **Verify TLS Certificate:**
   ```bash
   kubectl get certificate broker-tls
   kubectl describe certificate broker-tls
   ```

## Step 5: Test Broker Service

1. **Health Check:**
   ```bash
   curl https://your-broker-domain.com/health
   ```

2. **Test OIDC Flow:**
   ```bash
   # Start auth flow
   curl https://your-broker-domain.com/auth/start
   ```

## Step 6: Package and Install VS Code Extension

1. **Build Extension:**
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   npm run package
   ```

2. **Install Extension:**
   - Open VS Code
   - Go to Extensions → Install from VSIX
   - Select the generated `.vsix` file

3. **Configure Extension:**
   - Open VS Code Settings
   - Search for "Jupyter Cluster"
   - Set `jupyterCluster.brokerUrl` to `https://your-broker-domain.com`

## Step 7: Test End-to-End Connection

1. **Open VS Code**
2. **Run Command:** `Ctrl+Shift+P` → "Connect to Jupyter Cluster"
3. **Complete OIDC Flow:** Browser will open for CILogon authentication
4. **Verify Connection:** Status bar should show "Connected to Jupyter Cluster"

## Troubleshooting

### Common Issues

1. **Authentication Fails:**
   ```bash
   # Check broker logs
   kubectl logs -l app=broker
   
   # Verify OIDC configuration
   kubectl get secret broker-oidc-secret -o yaml
   ```

2. **Pod Connection Fails:**
   ```bash
   # Check JupyterHub API
   curl -H "Authorization: token YOUR_TOKEN" \
        https://your-jupyterhub.com/hub/api/users
   
   # Verify RBAC permissions
   kubectl get rolebinding -n YOUR_NAMESPACE
   ```

3. **WebSocket Connection Issues:**
   ```bash
   # Check ingress configuration
   kubectl describe ingress broker
   
   # Test WebSocket upgrade
   curl -i -N -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
        https://your-broker-domain.com/tunnel/test
   ```

### Debug Mode

Enable debug logging:
```bash
kubectl patch deployment broker \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"broker","env":[{"name":"DEBUG","value":"true"}]}]}}}}'
```

## Security Considerations

1. **Rotate Secrets Regularly:**
   ```bash
   kubectl delete secret broker-oidc-secret broker-jupyterhub-secret
   # Recreate with new values
   ```

2. **Monitor Access Logs:**
   ```bash
   kubectl logs -l app=broker --follow
   ```

3. **Review RBAC Permissions:**
   ```bash
   kubectl get clusterrole broker-rbac
   kubectl describe clusterrole broker-rbac
   ```

## Scaling

1. **Horizontal Pod Autoscaling:**
   ```bash
   kubectl patch deployment broker \
     -p '{"spec":{"replicas":3}}'
   ```

2. **Resource Limits:**
   ```bash
   # Update values.yaml
   resources:
     limits:
       cpu: 1000m
       memory: 1Gi
     requests:
       cpu: 200m
       memory: 256Mi
   ```

## Backup and Recovery

1. **Backup Configuration:**
   ```bash
   kubectl get secret broker-oidc-secret -o yaml > broker-oidc-secret.yaml
   kubectl get secret broker-jupyterhub-secret -o yaml > broker-jupyterhub-secret.yaml
   helm get values broker > broker-values.yaml
   ```

2. **Recovery:**
   ```bash
   kubectl apply -f broker-oidc-secret.yaml
   kubectl apply -f broker-jupyterhub-secret.yaml
   helm install broker ./charts/broker -f broker-values.yaml
   ```

## Monitoring

1. **Health Checks:**
   ```bash
   # Add to monitoring system
   curl -f https://your-broker-domain.com/health
   ```

2. **Metrics Collection:**
   ```bash
   # Prometheus scrape config
   - job_name: 'broker'
     static_configs:
       - targets: ['broker:8080']
     metrics_path: '/metrics'
   ```

## Support

For issues and questions:
- Check logs: `kubectl logs -l app=broker`
- Review configuration: `helm get values broker`
- Test connectivity: `kubectl exec -it broker-pod -- curl localhost:8080/health`
