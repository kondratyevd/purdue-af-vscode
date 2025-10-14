package session

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

// InMemoryStore implements Store using in-memory storage
type InMemoryStore struct {
	sessions  map[string]*types.Session
	tokens    map[string]string // token -> sessionID mapping
	mutex     sync.RWMutex
	ttl       time.Duration
	jwtSecret string
}

// NewInMemoryStore creates a new in-memory session store
func NewInMemoryStore(ttlStr, jwtSecret string) *InMemoryStore {
	ttl, _ := time.ParseDuration(ttlStr)
	if ttl == 0 {
		ttl = 24 * time.Hour
	}

	store := &InMemoryStore{
		sessions:  make(map[string]*types.Session),
		tokens:    make(map[string]string),
		ttl:       ttl,
		jwtSecret: jwtSecret,
	}

	// Start cleanup goroutine
	go store.cleanupLoop()

	return store
}

// Create creates a new session
func (s *InMemoryStore) Create(ctx context.Context, req CreateRequest) (*types.Session, error) {
	sessionID := generateSessionID()
	sessionToken := s.generateSessionToken(sessionID, req.UserID)

	session := &types.Session{
		ID:           sessionID,
		UserID:       req.UserID,
		Token:        sessionToken,
		PodInfo:      req.PodInfo,
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(s.ttl),
		RefreshToken: req.RefreshToken,
	}

	s.mutex.Lock()
	defer s.mutex.Unlock()

	s.sessions[sessionID] = session
	s.tokens[sessionToken] = sessionID

	return session, nil
}

// Get retrieves a session by ID
func (s *InMemoryStore) Get(ctx context.Context, sessionID string) (*types.Session, error) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, fmt.Errorf("session expired")
	}

	return session, nil
}

// GetByToken retrieves a session by token
func (s *InMemoryStore) GetByToken(ctx context.Context, token string) (*types.Session, error) {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	sessionID, exists := s.tokens[token]
	if !exists {
		return nil, fmt.Errorf("invalid token")
	}

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	if time.Now().After(session.ExpiresAt) {
		return nil, fmt.Errorf("session expired")
	}

	return session, nil
}

// Delete removes a session
func (s *InMemoryStore) Delete(ctx context.Context, sessionID string) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found")
	}

	// Remove from both maps
	delete(s.sessions, sessionID)
	delete(s.tokens, session.Token)

	return nil
}

// CleanupExpired removes expired sessions
func (s *InMemoryStore) CleanupExpired(ctx context.Context) error {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	now := time.Now()
	for sessionID, session := range s.sessions {
		if now.After(session.ExpiresAt) {
			delete(s.tokens, session.Token)
			delete(s.sessions, sessionID)
		}
	}

	return nil
}

// Helper functions

func generateSessionID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func (s *InMemoryStore) generateSessionToken(sessionID, userID string) string {
	claims := jwt.MapClaims{
		"session_id": sessionID,
		"user_id":    userID,
		"exp":        time.Now().Add(15 * time.Minute).Unix(), // Short-lived session token
		"iat":        time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(s.jwtSecret))
	return tokenString
}

func (s *InMemoryStore) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		ctx := context.Background()
		s.CleanupExpired(ctx)
	}
}
