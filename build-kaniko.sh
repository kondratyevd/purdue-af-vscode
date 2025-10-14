#!/bin/bash

# Kaniko Build Script for Purdue CMS Broker
# This script sets up the Docker registry credentials and runs the Kaniko build job

set -e

NAMESPACE="cms-dev"
REGISTRY="geddes-registry.rcac.purdue.edu"
IMAGE_NAME="cms/broker"
TAG="v1.0.0"

echo "🚀 Setting up Kaniko build for Purdue CMS Broker"
echo "Registry: $REGISTRY"
echo "Image: $IMAGE_NAME:$TAG"
echo "Namespace: $NAMESPACE"

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace $NAMESPACE &> /dev/null; then
    echo "📦 Creating namespace: $NAMESPACE"
    kubectl create namespace $NAMESPACE
fi

# Function to create Docker registry secret
create_registry_secret() {
    echo "🔐 Creating Docker registry secret..."
    
    # Prompt for credentials if not provided via environment variables
    if [ -z "$REGISTRY_USERNAME" ] || [ -z "$REGISTRY_PASSWORD" ]; then
        echo "Please provide registry credentials:"
        read -p "Username: " REGISTRY_USERNAME
        read -s -p "Password: " REGISTRY_PASSWORD
        echo
    fi
    
    # Create Docker config JSON
    DOCKER_CONFIG=$(echo -n "$REGISTRY_USERNAME:$REGISTRY_PASSWORD" | base64)
    DOCKER_CONFIG_JSON=$(cat <<EOF
{
  "auths": {
    "$REGISTRY": {
      "auth": "$DOCKER_CONFIG"
    }
  }
}
EOF
)
    
    # Create secret
    kubectl create secret docker-registry geddes-registry-secret \
        --docker-server=$REGISTRY \
        --docker-username=$REGISTRY_USERNAME \
        --docker-password=$REGISTRY_PASSWORD \
        --docker-email="cms-dev@purdue.edu" \
        --namespace=$NAMESPACE \
        --dry-run=client -o yaml | kubectl apply -f -
    
    echo "✅ Registry secret created"
}

# Function to run Kaniko build
run_kaniko_build() {
    echo "🔨 Running Kaniko build job..."
    
    # Apply the Kaniko job
    kubectl apply -f kaniko-build.yaml
    
    echo "⏳ Waiting for Kaniko job to complete..."
    kubectl wait --for=condition=complete job/broker-kaniko-build -n $NAMESPACE --timeout=600s
    
    # Check job status
    if kubectl get job broker-kaniko-build -n $NAMESPACE -o jsonpath='{.status.conditions[0].type}' | grep -q "Complete"; then
        echo "✅ Kaniko build completed successfully!"
        echo "📦 Image pushed to: $REGISTRY/$IMAGE_NAME:$TAG"
        
        # Show job logs
        echo "📋 Build logs:"
        kubectl logs job/broker-kaniko-build -n $NAMESPACE
    else
        echo "❌ Kaniko build failed!"
        echo "📋 Error logs:"
        kubectl logs job/broker-kaniko-build -n $NAMESPACE
        exit 1
    fi
}

# Function to clean up
cleanup() {
    echo "🧹 Cleaning up Kaniko job..."
    kubectl delete job broker-kaniko-build -n $NAMESPACE --ignore-not-found=true
}

# Main execution
main() {
    case "${1:-build}" in
        "setup")
            create_registry_secret
            ;;
        "build")
            create_registry_secret
            run_kaniko_build
            cleanup
            ;;
        "cleanup")
            cleanup
            ;;
        "logs")
            kubectl logs job/broker-kaniko-build -n $NAMESPACE
            ;;
        *)
            echo "Usage: $0 {setup|build|cleanup|logs}"
            echo "  setup   - Create registry secret only"
            echo "  build   - Run full Kaniko build (default)"
            echo "  cleanup - Clean up Kaniko job"
            echo "  logs    - Show build logs"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"
