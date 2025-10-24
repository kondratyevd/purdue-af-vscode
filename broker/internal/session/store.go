package session

import (
	"context"

	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

// Store defines the interface for session storage
type Store interface {
	// Create creates a new session
	Create(ctx context.Context, req CreateRequest) (*types.Session, error)

	// Get retrieves a session by ID
	Get(ctx context.Context, sessionID string) (*types.Session, error)

	// GetByToken retrieves a session by token
	GetByToken(ctx context.Context, token string) (*types.Session, error)

	// Delete removes a session
	Delete(ctx context.Context, sessionID string) error

	// CleanupExpired removes expired sessions
	CleanupExpired(ctx context.Context) error
}

// CreateRequest represents session creation request
type CreateRequest struct {
	UserID       string
	RefreshToken string
	PodInfo      types.PodInfo
}
