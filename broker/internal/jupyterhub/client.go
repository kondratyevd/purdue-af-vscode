package jupyterhub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

// ClientInterface defines the interface for JupyterHub operations
type ClientInterface interface {
	// GetUserPod retrieves information about a user's pod
	GetUserPod(ctx context.Context, username string) (*types.PodInfo, error)

	// EnsurePodRunning ensures the user's pod is running, starting it if necessary
	EnsurePodRunning(ctx context.Context, username string) (*types.PodInfo, error)

	// StopUserPod stops the user's pod
	StopUserPod(ctx context.Context, username string) error
}

// Client implements the jupyterhub.ClientInterface interface
type Client struct {
	apiURL   string
	apiToken string
	client   *http.Client
}

// NewClient creates a new JupyterHub client
func NewClient(config JupyterHubConfig) *Client {
	return &Client{
		apiURL:   config.APIURL,
		apiToken: config.APIToken,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// JupyterHubConfig represents JupyterHub configuration
type JupyterHubConfig struct {
	APIURL   string
	APIToken string
}

// JupyterHubUser represents a JupyterHub user
type JupyterHubUser struct {
	Name   string            `json:"name"`
	Admin  bool              `json:"admin"`
	Server *JupyterHubServer `json:"server,omitempty"`
}

// JupyterHubServer represents a JupyterHub server
type JupyterHubServer struct {
	Name         string `json:"name"`
	Ready        bool   `json:"ready"`
	Pending      string `json:"pending,omitempty"`
	URL          string `json:"url"`
	Progress     int    `json:"progress"`
	Started      string `json:"started"`
	LastActivity string `json:"last_activity"`
}

// GetUserPod retrieves information about a user's pod
func (c *Client) GetUserPod(ctx context.Context, username string) (*types.PodInfo, error) {
	user, err := c.getUser(ctx, username)
	if err != nil {
		return nil, err
	}

	if user.Server == nil {
		return nil, fmt.Errorf("user has no running server")
	}

	if !user.Server.Ready {
		return nil, fmt.Errorf("user server is not ready")
	}

	// Extract pod information from server URL or name
	// This is a simplified implementation - in practice, you might need
	// to query Kubernetes directly or use JupyterHub's pod API
	podName := fmt.Sprintf("jupyter-%s", username)
	namespace := fmt.Sprintf("user-%s", username)

	return &types.PodInfo{
		Name:      podName,
		Namespace: namespace,
		Status:    "Running",
	}, nil
}

// EnsurePodRunning ensures the user's pod is running, starting it if necessary
func (c *Client) EnsurePodRunning(ctx context.Context, username string) (*types.PodInfo, error) {
	user, err := c.getUser(ctx, username)
	if err != nil {
		return nil, err
	}

	// If user has no server or server is not ready, start it
	if user.Server == nil || !user.Server.Ready {
		if err := c.startServer(ctx, username); err != nil {
			return nil, fmt.Errorf("failed to start server: %w", err)
		}

		// Wait for server to be ready
		if err := c.waitForServerReady(ctx, username); err != nil {
			return nil, fmt.Errorf("server failed to become ready: %w", err)
		}
	}

	return c.GetUserPod(ctx, username)
}

// StopUserPod stops the user's pod
func (c *Client) StopUserPod(ctx context.Context, username string) error {
	req, err := http.NewRequestWithContext(ctx, "DELETE",
		fmt.Sprintf("%s/users/%s/server", c.apiURL, username), nil)
	if err != nil {
		return fmt.Errorf("failed to create stop request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("stop request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("stop request failed: %s", string(body))
	}

	return nil
}

// Helper methods

func (c *Client) getUser(ctx context.Context, username string) (*JupyterHubUser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET",
		fmt.Sprintf("%s/users/%s", c.apiURL, username), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create user request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("user request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("user request failed: %s", string(body))
	}

	var user JupyterHubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode user response: %w", err)
	}

	return &user, nil
}

func (c *Client) startServer(ctx context.Context, username string) error {
	req, err := http.NewRequestWithContext(ctx, "POST",
		fmt.Sprintf("%s/users/%s/server", c.apiURL, username), nil)
	if err != nil {
		return fmt.Errorf("failed to create start request: %w", err)
	}

	c.setAuthHeader(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("start request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("start request failed: %s", string(body))
	}

	return nil
}

func (c *Client) waitForServerReady(ctx context.Context, username string) error {
	timeout := time.After(5 * time.Minute)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return fmt.Errorf("timeout waiting for server to be ready")
		case <-ticker.C:
			user, err := c.getUser(ctx, username)
			if err != nil {
				continue
			}

			if user.Server != nil && user.Server.Ready {
				return nil
			}
		}
	}
}

func (c *Client) setAuthHeader(req *http.Request) {
	if c.apiToken != "" {
		req.Header.Set("Authorization", "token "+c.apiToken)
	}
}
