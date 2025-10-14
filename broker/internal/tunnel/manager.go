package tunnel

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/purdue-af/vscode-k8s-connector/internal/k8s"
	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

// ManagerInterface defines the interface for tunnel management
type ManagerInterface interface {
	// HandleConnection handles WebSocket upgrade and tunnel creation
	HandleConnection(w http.ResponseWriter, r *http.Request, session *types.Session)

	// CloseTunnel closes a tunnel for a session
	CloseTunnel(sessionID string) error
}

// Manager implements the tunnel.ManagerInterface interface
type Manager struct {
	k8sClient k8s.ClientInterface
	upgrader  websocket.Upgrader
	tunnels   map[string]*Tunnel
	mutex     sync.RWMutex
}

// Tunnel represents an active WebSocket tunnel
type Tunnel struct {
	ID       string
	Session  *types.Session
	Conn     *websocket.Conn
	K8sToken string
	Done     chan struct{}
	mutex    sync.RWMutex
}

// NewManager creates a new tunnel manager
func NewManager(k8sClient k8s.ClientInterface) *Manager {
	return &Manager{
		k8sClient: k8sClient,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // In production, validate origin
			},
		},
		tunnels: make(map[string]*Tunnel),
	}
}

// HandleConnection handles WebSocket upgrade and tunnel creation
func (m *Manager) HandleConnection(w http.ResponseWriter, r *http.Request, session *types.Session) {
	conn, err := m.upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, "Failed to upgrade to WebSocket", http.StatusBadRequest)
		return
	}
	defer conn.Close()

	// Create ServiceAccount and get token for this session
	k8sToken, err := m.k8sClient.CreateSessionServiceAccount(
		r.Context(), session.PodInfo.Namespace, session.PodInfo.Name)
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"error": "Failed to create k8s credentials: %v"}`, err)))
		return
	}

	// Create tunnel
	tunnel := &Tunnel{
		ID:       session.ID,
		Session:  session,
		Conn:     conn,
		K8sToken: k8sToken,
		Done:     make(chan struct{}),
	}

	m.mutex.Lock()
	m.tunnels[session.ID] = tunnel
	m.mutex.Unlock()

	defer func() {
		m.mutex.Lock()
		delete(m.tunnels, session.ID)
		m.mutex.Unlock()

		// Cleanup ServiceAccount
		m.k8sClient.DeleteServiceAccount(r.Context(), session.PodInfo.Namespace,
			fmt.Sprintf("vscode-sess-%s", session.ID[:8]))
	}()

	// Handle WebSocket messages
	m.handleTunnelMessages(tunnel)
}

// CloseTunnel closes a tunnel for a session
func (m *Manager) CloseTunnel(sessionID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	tunnel, exists := m.tunnels[sessionID]
	if !exists {
		return fmt.Errorf("tunnel not found")
	}

	close(tunnel.Done)
	tunnel.Conn.Close()
	delete(m.tunnels, sessionID)

	return nil
}

// handleTunnelMessages processes WebSocket messages
func (m *Manager) handleTunnelMessages(tunnel *Tunnel) {
	for {
		select {
		case <-tunnel.Done:
			return
		default:
			_, message, err := tunnel.Conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					fmt.Printf("WebSocket error: %v\n", err)
				}
				return
			}

			var tunnelMsg types.TunnelMessage
			if err := json.Unmarshal(message, &tunnelMsg); err != nil {
				m.sendError(tunnel, fmt.Sprintf("Invalid message format: %v", err))
				continue
			}

			switch tunnelMsg.Type {
			case "exec":
				m.handleExecRequest(tunnel, tunnelMsg.Payload)
			case "portforward":
				m.handlePortForwardRequest(tunnel, tunnelMsg.Payload)
			case "file":
				m.handleFileRequest(tunnel, tunnelMsg.Payload)
			default:
				m.sendError(tunnel, fmt.Sprintf("Unknown message type: %s", tunnelMsg.Type))
			}
		}
	}
}

// handleExecRequest handles command execution requests
func (m *Manager) handleExecRequest(tunnel *Tunnel, payload interface{}) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		m.sendError(tunnel, "Invalid exec payload")
		return
	}

	var execReq types.ExecRequest
	if err := json.Unmarshal(payloadBytes, &execReq); err != nil {
		m.sendError(tunnel, "Invalid exec request format")
		return
	}

	// Execute command in pod
	result, err := m.executeCommand(tunnel, execReq)
	if err != nil {
		m.sendError(tunnel, fmt.Sprintf("Command execution failed: %v", err))
		return
	}

	// Send result back
	response := types.TunnelMessage{
		Type:    "exec_response",
		Payload: result,
	}

	m.sendMessage(tunnel, response)
}

// handlePortForwardRequest handles port forwarding requests
func (m *Manager) handlePortForwardRequest(tunnel *Tunnel, payload interface{}) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		m.sendError(tunnel, "Invalid portforward payload")
		return
	}

	var pfReq types.PortForwardRequest
	if err := json.Unmarshal(payloadBytes, &pfReq); err != nil {
		m.sendError(tunnel, "Invalid portforward request format")
		return
	}

	// Start port forwarding
	go m.startPortForward(tunnel, pfReq.Port)
}

// handleFileRequest handles file operation requests
func (m *Manager) handleFileRequest(tunnel *Tunnel, payload interface{}) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		m.sendError(tunnel, "Invalid file payload")
		return
	}

	var fileReq types.FileOperation
	if err := json.Unmarshal(payloadBytes, &fileReq); err != nil {
		m.sendError(tunnel, "Invalid file request format")
		return
	}

	// Execute file operation
	result, err := m.executeFileOperation(tunnel, fileReq)
	if err != nil {
		m.sendError(tunnel, fmt.Sprintf("File operation failed: %v", err))
		return
	}

	// Send result back
	response := types.TunnelMessage{
		Type:    "file_response",
		Payload: result,
	}

	m.sendMessage(tunnel, response)
}

// executeCommand executes a command in the pod
func (m *Manager) executeCommand(tunnel *Tunnel, req types.ExecRequest) (*types.ExecResponse, error) {
	// This is a simplified implementation
	// In practice, you'd use k8s.io/client-go/tools/remotecommand

	// For now, return a mock response
	return &types.ExecResponse{
		ExitCode: 0,
		Stdout:   fmt.Sprintf("Executed: %s %v", req.Command, req.Args),
		Stderr:   "",
	}, nil
}

// startPortForward starts port forwarding
func (m *Manager) startPortForward(tunnel *Tunnel, port int) {
	// This is a simplified implementation
	// In practice, you'd use k8s.io/client-go/tools/portforward

	response := types.TunnelMessage{
		Type: "portforward_response",
		Payload: map[string]interface{}{
			"port":    port,
			"status":  "started",
			"message": fmt.Sprintf("Port forwarding started on port %d", port),
		},
	}

	m.sendMessage(tunnel, response)
}

// executeFileOperation executes a file operation
func (m *Manager) executeFileOperation(tunnel *Tunnel, req types.FileOperation) (*types.FileOperationResponse, error) {
	// This is a simplified implementation
	// In practice, you'd use kubectl exec with appropriate commands

	switch req.Operation {
	case "read":
		return &types.FileOperationResponse{
			Success: true,
			Content: fmt.Sprintf("Content of %s", req.Path),
		}, nil
	case "list":
		return &types.FileOperationResponse{
			Success: true,
			Content: fmt.Sprintf("Directory listing of %s", req.Path),
		}, nil
	default:
		return &types.FileOperationResponse{
			Success: false,
			Error:   fmt.Sprintf("Unsupported operation: %s", req.Operation),
		}, nil
	}
}

// Helper methods

func (m *Manager) sendMessage(tunnel *Tunnel, msg types.TunnelMessage) {
	tunnel.mutex.Lock()
	defer tunnel.mutex.Unlock()

	messageBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}

	tunnel.Conn.WriteMessage(websocket.TextMessage, messageBytes)
}

func (m *Manager) sendError(tunnel *Tunnel, errorMsg string) {
	response := types.TunnelMessage{
		Type: "error",
		Payload: map[string]string{
			"error": errorMsg,
		},
	}

	m.sendMessage(tunnel, response)
}
