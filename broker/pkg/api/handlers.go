package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/purdue-af/vscode-k8s-connector/internal/auth"
	"github.com/purdue-af/vscode-k8s-connector/internal/jupyterhub"
	"github.com/purdue-af/vscode-k8s-connector/internal/session"
	"github.com/purdue-af/vscode-k8s-connector/internal/tunnel"
)

type Handlers struct {
	oidcProvider     auth.Provider
	sessionStore     session.Store
	jupyterHubClient jupyterhub.ClientInterface
	tunnelManager    tunnel.ManagerInterface
}

func NewHandlers(
	oidcProvider auth.Provider,
	sessionStore session.Store,
	jupyterHubClient jupyterhub.ClientInterface,
	tunnelManager tunnel.ManagerInterface,
) *Handlers {
	return &Handlers{
		oidcProvider:     oidcProvider,
		sessionStore:     sessionStore,
		jupyterHubClient: jupyterHubClient,
		tunnelManager:    tunnelManager,
	}
}

func RegisterRoutes(router *gin.Engine, handlers *Handlers) {
	// Health check
	router.GET("/health", handlers.Health)

	// Auth endpoints
	router.GET("/auth/start", handlers.StartAuth)
	router.GET("/auth/callback", handlers.AuthCallback)

	// Session endpoints
	router.POST("/session", handlers.CreateSession)
	router.GET("/session/:id", handlers.GetSession)
	router.DELETE("/session/:id", handlers.DeleteSession)

	// Tunnel endpoint
	router.GET("/tunnel/:session_id", handlers.HandleTunnel)
}

func (h *Handlers) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status":    "healthy",
		"timestamp": time.Now().Unix(),
	})
}

func (h *Handlers) StartAuth(c *gin.Context) {
	authURL, state, err := h.oidcProvider.StartFlow(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"auth_url": authURL,
		"state":    state,
	})
}

func (h *Handlers) AuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing code or state parameter"})
		return
	}

	tokens, err := h.oidcProvider.HandleCallback(c.Request.Context(), code, state)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token":  tokens.AccessToken,
		"refresh_token": tokens.RefreshToken,
		"expires_in":    tokens.ExpiresIn,
	})
}

func (h *Handlers) CreateSession(c *gin.Context) {
	var req CreateSessionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate access token
	userInfo, err := h.oidcProvider.ValidateToken(c.Request.Context(), req.AccessToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid access token"})
		return
	}

	// Ensure JupyterHub pod is running
	podInfo, err := h.jupyterHubClient.EnsurePodRunning(c.Request.Context(), userInfo.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Create session
	session, err := h.sessionStore.Create(c.Request.Context(), session.CreateRequest{
		UserID:       userInfo.Email,
		RefreshToken: req.RefreshToken,
		PodInfo:      *podInfo,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id":    session.ID,
		"username":      session.UserID,
		"namespace":     session.PodInfo.Namespace,
		"pod":           session.PodInfo.Name,
		"tunnel_url":    fmt.Sprintf("wss://%s/tunnel/%s", c.Request.Host, session.ID),
		"session_token": session.Token,
	})
}

func (h *Handlers) GetSession(c *gin.Context) {
	sessionID := c.Param("id")

	session, err := h.sessionStore.Get(c.Request.Context(), sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"session_id":    session.ID,
		"username":      session.UserID,
		"namespace":     session.PodInfo.Namespace,
		"pod":           session.PodInfo.Name,
		"tunnel_url":    fmt.Sprintf("wss://%s/tunnel/%s", c.Request.Host, session.ID),
		"session_token": session.Token,
	})
}

func (h *Handlers) DeleteSession(c *gin.Context) {
	sessionID := c.Param("id")

	err := h.sessionStore.Delete(c.Request.Context(), sessionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "session deleted"})
}

func (h *Handlers) HandleTunnel(c *gin.Context) {
	sessionID := c.Param("session_id")
	token := c.Query("token")

	// Validate session token
	session, err := h.sessionStore.GetByToken(c.Request.Context(), token)
	if err != nil || session.ID != sessionID {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid session token"})
		return
	}

	// Upgrade to WebSocket and start tunnel
	h.tunnelManager.HandleConnection(c.Writer, c.Request, session)
}

type CreateSessionRequest struct {
	AccessToken  string `json:"access_token" binding:"required"`
	RefreshToken string `json:"refresh_token" binding:"required"`
}
