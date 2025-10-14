package session

import (
	"context"
	"testing"
	"time"

	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

func TestInMemoryStore_CreateSession(t *testing.T) {
	store := NewInMemoryStore("1h", "test-secret")

	req := CreateRequest{
		UserID:       "test-user",
		RefreshToken: "test-refresh-token",
		PodInfo: types.PodInfo{
			Name:      "test-pod",
			Namespace: "test-namespace",
			Status:    "Running",
		},
	}

	session, err := store.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Expected no error, got %v", err)
	}

	if session.ID == "" {
		t.Fatal("Expected session ID to be generated")
	}

	if session.UserID != req.UserID {
		t.Errorf("Expected user ID %s, got %s", req.UserID, session.UserID)
	}
}

func TestInMemoryStore_GetSession(t *testing.T) {
	store := NewInMemoryStore("1h", "test-secret")

	req := CreateRequest{
		UserID:       "test-user",
		RefreshToken: "test-refresh-token",
		PodInfo: types.PodInfo{
			Name:      "test-pod",
			Namespace: "test-namespace",
			Status:    "Running",
		},
	}

	session, err := store.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Expected no error creating session, got %v", err)
	}

	// Retrieve session
	retrieved, err := store.Get(context.Background(), session.ID)
	if err != nil {
		t.Fatalf("Expected no error retrieving session, got %v", err)
	}

	if retrieved.ID != session.ID {
		t.Errorf("Expected session ID %s, got %s", session.ID, retrieved.ID)
	}
}

func TestInMemoryStore_DeleteSession(t *testing.T) {
	store := NewInMemoryStore("1h", "test-secret")

	req := CreateRequest{
		UserID:       "test-user",
		RefreshToken: "test-refresh-token",
		PodInfo: types.PodInfo{
			Name:      "test-pod",
			Namespace: "test-namespace",
			Status:    "Running",
		},
	}

	session, err := store.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Expected no error creating session, got %v", err)
	}

	// Delete session
	err = store.Delete(context.Background(), session.ID)
	if err != nil {
		t.Fatalf("Expected no error deleting session, got %v", err)
	}

	// Verify session is gone
	_, err = store.Get(context.Background(), session.ID)
	if err == nil {
		t.Fatal("Expected error retrieving deleted session")
	}
}

func TestInMemoryStore_SessionExpiry(t *testing.T) {
	// Use a very short TTL for testing
	store := NewInMemoryStore("1ms", "test-secret")

	req := CreateRequest{
		UserID:       "test-user",
		RefreshToken: "test-refresh-token",
		PodInfo: types.PodInfo{
			Name:      "test-pod",
			Namespace: "test-namespace",
			Status:    "Running",
		},
	}

	session, err := store.Create(context.Background(), req)
	if err != nil {
		t.Fatalf("Expected no error creating session, got %v", err)
	}

	// Wait for session to expire
	time.Sleep(10 * time.Millisecond)

	// Verify session is expired
	_, err = store.Get(context.Background(), session.ID)
	if err == nil {
		t.Fatal("Expected error retrieving expired session")
	}
}
