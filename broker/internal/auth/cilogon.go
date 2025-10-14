package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/purdue-af/vscode-k8s-connector/internal/types"
)

const (
	codeChallengeMethod = "S256"
	stateLength         = 32
	codeVerifierLength  = 128
)

// StartFlow initiates the OIDC authorization flow with PKCE
func (p *CILogonProvider) StartFlow(ctx context.Context) (string, string, error) {
	// Generate PKCE code verifier and challenge
	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		return "", "", fmt.Errorf("failed to generate code verifier: %w", err)
	}

	codeChallenge := generateCodeChallenge(codeVerifier)
	state := generateState()

	// Build authorization URL
	authURL, err := p.buildAuthURL(codeChallenge, state)
	if err != nil {
		return "", "", fmt.Errorf("failed to build auth URL: %w", err)
	}

	// Store PKCE parameters for later use (in production, use secure storage)
	// For now, we'll include them in the state parameter
	stateData := map[string]string{
		"state":         state,
		"code_verifier": codeVerifier,
	}
	stateJSON, _ := json.Marshal(stateData)
	encodedState := base64.URLEncoding.EncodeToString(stateJSON)

	return authURL, encodedState, nil
}

// HandleCallback processes the OIDC callback and exchanges code for tokens
func (p *CILogonProvider) HandleCallback(ctx context.Context, code, encodedState string) (*types.TokenSet, error) {
	// Decode state to get PKCE parameters
	stateData := make(map[string]string)
	stateJSON, err := base64.URLEncoding.DecodeString(encodedState)
	if err != nil {
		return nil, fmt.Errorf("invalid state parameter: %w", err)
	}

	if err := json.Unmarshal(stateJSON, &stateData); err != nil {
		return nil, fmt.Errorf("invalid state format: %w", err)
	}

	codeVerifier := stateData["code_verifier"]
	if codeVerifier == "" {
		return nil, fmt.Errorf("missing code verifier in state")
	}

	// Exchange code for tokens
	tokenURL := p.issuer + "/oauth2/token"
	data := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {p.redirectURL},
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
		"code_verifier": {codeVerifier},
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange failed: %s", string(body))
	}

	var tokenResponse struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	return &types.TokenSet{
		AccessToken:  tokenResponse.AccessToken,
		RefreshToken: tokenResponse.RefreshToken,
		ExpiresIn:    tokenResponse.ExpiresIn,
		TokenType:    tokenResponse.TokenType,
	}, nil
}

// ValidateToken validates an access token and returns user information
func (p *CILogonProvider) ValidateToken(ctx context.Context, accessToken string) (*types.UserInfo, error) {
	// Get user info from CILogon
	userInfoURL := p.issuer + "/oauth2/userinfo"
	req, err := http.NewRequestWithContext(ctx, "GET", userInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create userinfo request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("userinfo request failed: %s", string(body))
	}

	var userInfo struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("failed to decode userinfo response: %w", err)
	}

	return &types.UserInfo{
		Email: userInfo.Email,
		Name:  userInfo.Name,
	}, nil
}

// RefreshToken exchanges a refresh token for new access token
func (p *CILogonProvider) RefreshToken(ctx context.Context, refreshToken string) (*types.TokenSet, error) {
	tokenURL := p.issuer + "/oauth2/token"
	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {p.clientID},
		"client_secret": {p.clientSecret},
	}

	req, err := http.NewRequestWithContext(ctx, "POST", tokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create refresh request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token refresh failed: %s", string(body))
	}

	var tokenResponse struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&tokenResponse); err != nil {
		return nil, fmt.Errorf("failed to decode refresh response: %w", err)
	}

	return &types.TokenSet{
		AccessToken:  tokenResponse.AccessToken,
		RefreshToken: tokenResponse.RefreshToken,
		ExpiresIn:    tokenResponse.ExpiresIn,
		TokenType:    tokenResponse.TokenType,
	}, nil
}

// Helper functions

func generateCodeVerifier() (string, error) {
	bytes := make([]byte, codeVerifierLength)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(bytes), nil
}

func generateCodeChallenge(verifier string) string {
	hash := sha256.Sum256([]byte(verifier))
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(hash[:])
}

func generateState() string {
	bytes := make([]byte, stateLength)
	rand.Read(bytes)
	return base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(bytes)
}

func (p *CILogonProvider) buildAuthURL(codeChallenge, state string) (string, error) {
	// CILogon uses /authorize instead of /oauth2/authorize
	u, err := url.Parse(p.issuer + "/authorize")
	if err != nil {
		return "", err
	}

	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", p.redirectURL)
	q.Set("scope", "openid email org.cilogon.userinfo profile")
	q.Set("state", state)
	q.Set("code_challenge", codeChallenge)
	q.Set("code_challenge_method", codeChallengeMethod)
	
	// Add CILogon-specific selected_idp parameter
	q.Set("selected_idp", "https://cern.ch/login,https://idp.fnal.gov/idp/shibboleth,https://idp.purdue.edu/idp/shibboleth")

	u.RawQuery = q.Encode()
	return u.String(), nil
}
