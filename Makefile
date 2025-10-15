.PHONY: all broker extension test clean docker deploy

# Default target
all: broker extension

# Build broker
broker:
	cd broker && make build

# Build extension
extension:
	cd vscode-extension && npm run compile

# Run all tests
test: test-broker test-extension

# Test broker
test-broker:
	cd broker && make test

# Test extension
test-extension:
	cd vscode-extension && npm test

# Clean all build artifacts
clean:
	cd broker && make clean
	cd vscode-extension && rm -rf out/ node_modules/

# Build Docker image
docker:
	cd broker && make docker

# Deploy with Helm
deploy:
	helm install broker ./charts/broker --values ./charts/broker/values.yaml

# Development setup
dev-setup:
	cd broker && go mod download
	cd vscode-extension && npm install

# Format code
fmt:
	cd broker && make fmt
	cd vscode-extension && npm run lint -- --fix

# Lint code
lint:
	cd broker && make lint
	cd vscode-extension && npm run lint

# Package extension
package:
	cd vscode-extension && npm run package

# Run broker locally
run-broker:
	cd broker && make run

# Run extension in debug mode
run-extension:
	cd vscode-extension && npm run watch

# Generate mocks
mocks:
	cd broker && make mocks

# Security scan
security:
	cd broker && gosec ./...
	cd vscode-extension && npm audit

# Help
help:
	@echo "Available targets:"
	@echo "  all          - Build broker and extension"
	@echo "  broker       - Build broker binary"
	@echo "  extension    - Build extension"
	@echo "  test         - Run all tests"
	@echo "  clean        - Clean build artifacts"
	@echo "  docker       - Build Docker image"
	@echo "  deploy       - Deploy with Helm"
	@echo "  dev-setup    - Install dependencies"
	@echo "  fmt          - Format code"
	@echo "  lint         - Lint code"
	@echo "  package      - Package extension"
	@echo "  run-broker   - Run broker locally"
	@echo "  run-extension- Run extension in debug mode"
	@echo "  mocks        - Generate mocks"
	@echo "  security     - Run security scans"
	@echo "  help         - Show this help"

















