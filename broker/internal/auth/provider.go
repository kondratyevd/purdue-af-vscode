package auth

import (
	"context"

	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

// Provider defines the interface for OIDC authentication providers
type Provider interface {
	// StartFlow initiates the OIDC authorization flow
	StartFlow(ctx context.Context) (authURL string, state string, err error)

	// HandleCallback processes the OIDC callback and exchanges code for tokens
	HandleCallback(ctx context.Context, code, state string) (*types.TokenSet, error)

	// ValidateToken validates an access token and returns user information
	ValidateToken(ctx context.Context, accessToken string) (*types.UserInfo, error)

	// RefreshToken exchanges a refresh token for new access token
	RefreshToken(ctx context.Context, refreshToken string) (*types.TokenSet, error)
}

// CILogonProvider implements Provider for CILogon OIDC
type CILogonProvider struct {
	issuer       string
	clientID     string
	clientSecret string
	redirectURL  string
}

// NewCILogonProvider creates a new CILogon provider
func NewCILogonProvider(config CILogonConfig) *CILogonProvider {
	return &CILogonProvider{
		issuer:       config.Issuer,
		clientID:     config.ClientID,
		clientSecret: config.ClientSecret,
		redirectURL:  config.RedirectURL,
	}
}

type CILogonConfig struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

















