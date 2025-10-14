package types

import (
	"time"
)

// UserInfo represents authenticated user information
type UserInfo struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}

// TokenSet represents OIDC tokens
type TokenSet struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

// PodInfo represents Kubernetes pod information
type PodInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Status    string `json:"status"`
}

// Session represents an active user session
type Session struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Token        string    `json:"token"`
	PodInfo      PodInfo   `json:"pod_info"`
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
	RefreshToken string    `json:"-"` // Not serialized for security
}

// TunnelMessage represents WebSocket tunnel messages
type TunnelMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

// ExecRequest represents a command execution request
type ExecRequest struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Stdin   bool     `json:"stdin"`
	Stdout  bool     `json:"stdout"`
	Stderr  bool     `json:"stderr"`
}

// ExecResponse represents command execution response
type ExecResponse struct {
	ExitCode int    `json:"exit_code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

// PortForwardRequest represents port forwarding request
type PortForwardRequest struct {
	Port int `json:"port"`
}

// FileOperation represents file system operations
type FileOperation struct {
	Operation string `json:"operation"` // read, write, list, delete
	Path      string `json:"path"`
	Content   string `json:"content,omitempty"`
}

// FileOperationResponse represents file operation response
type FileOperationResponse struct {
	Success bool   `json:"success"`
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
}
