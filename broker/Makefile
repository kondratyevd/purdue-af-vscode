.PHONY: build test clean docker run

# Build the broker binary
build:
	go build -o bin/broker ./cmd/broker

# Run tests
test:
	go test -v -cover ./...

# Run tests with coverage
test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Clean build artifacts
clean:
	rm -rf bin/
	rm -f coverage.out coverage.html

# Build Docker image
docker:
	docker build -t broker:latest .

# Run the broker locally
run:
	go run ./cmd/broker

# Install dependencies
deps:
	go mod download
	go mod tidy

# Format code
fmt:
	go fmt ./...

# Lint code
lint:
	golangci-lint run

# Generate mocks (if using mockgen)
mocks:
	mockgen -source=internal/auth/provider.go -destination=internal/auth/mocks/provider_mock.go
	mockgen -source=internal/session/store.go -destination=internal/session/mocks/store_mock.go
	mockgen -source=internal/k8s/client.go -destination=internal/k8s/mocks/client_mock.go
	mockgen -source=internal/jupyterhub/client.go -destination=internal/jupyterhub/mocks/client_mock.go
	mockgen -source=internal/tunnel/manager.go -destination=internal/tunnel/mocks/manager_mock.go


















