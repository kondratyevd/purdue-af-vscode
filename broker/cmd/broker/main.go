package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/purdue-af/vscode-k8s-connector/internal/auth"
	"github.com/purdue-af/vscode-k8s-connector/internal/jupyterhub"
	"github.com/purdue-af/vscode-k8s-connector/internal/k8s"
	"github.com/purdue-af/vscode-k8s-connector/internal/session"
	"github.com/purdue-af/vscode-k8s-connector/internal/tunnel"
	"github.com/purdue-af/vscode-k8s-connector/pkg/api"
)

func main() {
	// Load configuration from environment
	config := loadConfig()

	// Initialize components
	k8sClient, err := k8s.NewClient(config.KubeconfigPath)
	if err != nil {
		log.Fatalf("Failed to create Kubernetes client: %v", err)
	}

	oidcProvider := auth.NewCILogonProvider(auth.CILogonConfig{
		Issuer:       config.OIDC.Issuer,
		ClientID:     config.OIDC.ClientID,
		ClientSecret: config.OIDC.ClientSecret,
		RedirectURL:  config.OIDC.RedirectURL,
	})
	sessionStore := session.NewInMemoryStore(config.SessionTTL, config.JWTSecret)
	jupyterHubClient := jupyterhub.NewClient(jupyterhub.JupyterHubConfig{
		APIURL:   config.JupyterHub.APIURL,
		APIToken: config.JupyterHub.APIToken,
	})
	tunnelManager := tunnel.NewManager(k8sClient)

	// Initialize API handlers
	handlers := api.NewHandlers(oidcProvider, sessionStore, jupyterHubClient, tunnelManager)

	// Setup Gin router
	router := gin.Default()

	// Add CORS middleware
	router.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Register routes
	api.RegisterRoutes(router, handlers)

	// Start server
	srv := &http.Server{
		Addr:    config.ListenAddr,
		Handler: router,
	}

	// Start server in goroutine
	go func() {
		log.Printf("Starting broker server on %s", config.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal to gracefully shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	// Give outstanding requests 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("Server forced to shutdown:", err)
	}

	log.Println("Server exited")
}

func loadConfig() *Config {
	return &Config{
		ListenAddr:     getEnv("LISTEN_ADDR", ":8080"),
		KubeconfigPath: getEnv("KUBECONFIG", ""),
		SessionTTL:     getEnv("SESSION_TTL", "24h"),
		JWTSecret:      getEnv("JWT_SECRET", "change-me-in-production"),
		OIDC: OIDCConfig{
			Issuer:       getEnv("OIDC_ISSUER", "https://cilogon.org"),
			ClientID:     getEnv("OIDC_CLIENT_ID", ""),
			ClientSecret: getEnv("OIDC_CLIENT_SECRET", ""),
			RedirectURL:  getEnv("OIDC_REDIRECT_URL", ""),
		},
		JupyterHub: JupyterHubConfig{
			APIURL:   getEnv("JUPYTERHUB_API_URL", ""),
			APIToken: getEnv("JUPYTERHUB_API_TOKEN", ""),
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

type Config struct {
	ListenAddr     string
	KubeconfigPath string
	SessionTTL     string
	JWTSecret      string
	OIDC           OIDCConfig
	JupyterHub     JupyterHubConfig
}

type OIDCConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

type JupyterHubConfig struct {
	APIURL   string
	APIToken string
}
