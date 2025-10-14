# Kaniko Build Configuration

This directory contains the configuration for building the Purdue CMS Broker Docker image using Kaniko in the `cms-dev` namespace and pushing it to the Purdue registry.

## 🏗️ Build Configuration

### **Registry Information**
- **Registry:** `geddes-registry.rcac.purdue.edu`
- **Repository:** `cms/broker`
- **Tags:** `latest`, `v1.0.0`
- **Namespace:** `cms-dev`

### **Image Details**
- **Full Image Name:** `geddes-registry.rcac.purdue.edu/cms/broker:v1.0.0`
- **Cache Repository:** `geddes-registry.rcac.purdue.edu/cms/broker-cache`
- **Build Context:** GitHub repository (git://github.com/kondratyevd/purdue-af-vscode.git)
- **Context Sub-path:** `broker/`

## 🚀 Quick Start

### **Option 1: Automated Build Script**

```bash
# Set registry credentials
export REGISTRY_USERNAME="your-username"
export REGISTRY_PASSWORD="your-password"

# Run automated build
./build-kaniko.sh build
```

### **Option 2: Manual Setup**

1. **Create registry secret:**
   ```bash
   kubectl create secret docker-registry geddes-registry-secret \
     --docker-server=geddes-registry.rcac.purdue.edu \
     --docker-username=YOUR_USERNAME \
     --docker-password=YOUR_PASSWORD \
     --docker-email="cms-dev@purdue.edu" \
     --namespace=cms-dev
   ```

2. **Apply Kaniko job:**
   ```bash
   kubectl apply -f kaniko-build.yaml
   ```

3. **Monitor build:**
   ```bash
   kubectl logs -f job/broker-kaniko-build -n cms-dev
   ```

## 📋 Files Overview

### **kaniko-build.yaml**
Contains two Kaniko job configurations:
- **Git-based build:** Pulls source from GitHub repository
- **Local build:** Uses local source code from PVC (alternative)

### **build-kaniko.sh**
Automated build script with functions:
- `setup` - Create registry secret only
- `build` - Run full Kaniko build (default)
- `cleanup` - Clean up Kaniko job
- `logs` - Show build logs

## 🔧 Configuration Details

### **Kaniko Arguments**
```yaml
args:
- --context=git://github.com/kondratyevd/purdue-af-vscode.git
- --context-sub-path=broker
- --destination=geddes-registry.rcac.purdue.edu/cms/broker:latest
- --destination=geddes-registry.rcac.purdue.edu/cms/broker:v1.0.0
- --cache=true
- --cache-repo=geddes-registry.rcac.purdue.edu/cms/broker-cache
- --compressed-caching=false
- --single-snapshot
- --cleanup
```

### **Resource Limits**
```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"
    cpu: "1000m"
```

## 🧪 Testing the Build

### **1. Verify Registry Access**
```bash
# Test registry connectivity
kubectl run test-registry --image=busybox --rm -it --restart=Never -- \
  wget -qO- https://geddes-registry.rcac.purdue.edu/v2/
```

### **2. Check Build Status**
```bash
# Monitor job status
kubectl get jobs -n cms-dev

# View build logs
kubectl logs job/broker-kaniko-build -n cms-dev

# Check pod status
kubectl get pods -n cms-dev -l app=broker-kaniko-build
```

### **3. Verify Image Push**
```bash
# List images in registry (if accessible)
curl -u $REGISTRY_USERNAME:$REGISTRY_PASSWORD \
  https://geddes-registry.rcac.purdue.edu/v2/cms/broker/tags/list
```

## 🔄 Integration with Helm

The Helm chart has been updated to use the built image:

```yaml
# charts/broker/values.yaml
image:
  repository: "geddes-registry.rcac.purdue.edu/cms/broker"
  pullPolicy: IfNotPresent
  tag: "v1.0.0"

imagePullSecrets:
  - name: geddes-registry-secret
```

## 🛠️ Troubleshooting

### **Common Issues**

1. **Registry Authentication Failed**
   ```bash
   # Check secret
   kubectl get secret geddes-registry-secret -n cms-dev -o yaml
   
   # Verify credentials
   kubectl run test-auth --image=busybox --rm -it --restart=Never -- \
     echo "Testing registry access"
   ```

2. **Build Context Issues**
   ```bash
   # Check GitHub access from cluster
   kubectl run test-git --image=alpine/git --rm -it --restart=Never -- \
     git clone https://github.com/kondratyevd/purdue-af-vscode.git /tmp/test
   ```

3. **Resource Constraints**
   ```bash
   # Check cluster resources
   kubectl top nodes
   kubectl describe nodes
   ```

### **Debug Commands**

```bash
# Get detailed job information
kubectl describe job broker-kaniko-build -n cms-dev

# Check events
kubectl get events -n cms-dev --sort-by='.lastTimestamp'

# View pod logs with timestamps
kubectl logs job/broker-kaniko-build -n cms-dev --timestamps=true
```

## 🔐 Security Considerations

- **Registry credentials** are stored as Kubernetes secrets
- **Build context** is pulled from public GitHub repository
- **Image layers** are cached for efficiency
- **Job cleanup** happens automatically after 5 minutes

## 📚 Additional Resources

- [Kaniko Documentation](https://github.com/GoogleContainerTools/kaniko)
- [Kubernetes Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Docker Registry Authentication](https://kubernetes.io/docs/concepts/containers/images/#using-a-private-registry)
