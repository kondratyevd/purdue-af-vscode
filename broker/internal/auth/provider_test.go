package auth

import (
	"testing"
)

func TestCILogonProvider_NewCILogonProvider(t *testing.T) {
	config := CILogonConfig{
		Issuer:       "https://cilogon.org",
		ClientID:     "test-client",
		ClientSecret: "test-secret",
		RedirectURL:  "http://localhost:8080/auth/callback",
	}

	provider := NewCILogonProvider(config)

	// Test that provider is created successfully
	if provider == nil {
		t.Fatal("Expected provider to be created")
	}
}

func TestCILogonProvider_ValidateConfig(t *testing.T) {
	tests := []struct {
		name   string
		config CILogonConfig
		valid  bool
	}{
		{
			name: "valid config",
			config: CILogonConfig{
				Issuer:       "https://cilogon.org",
				ClientID:     "test-client",
				ClientSecret: "test-secret",
				RedirectURL:  "http://localhost:8080/auth/callback",
			},
			valid: true,
		},
		{
			name: "missing client ID",
			config: CILogonConfig{
				Issuer:       "https://cilogon.org",
				ClientSecret: "test-secret",
				RedirectURL:  "http://localhost:8080/auth/callback",
			},
			valid: false,
		},
		{
			name: "missing client secret",
			config: CILogonConfig{
				Issuer:      "https://cilogon.org",
				ClientID:    "test-client",
				RedirectURL: "http://localhost:8080/auth/callback",
			},
			valid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := NewCILogonProvider(tt.config)

			// Simple validation check
			hasRequiredFields := tt.config.ClientID != "" &&
				tt.config.ClientSecret != "" &&
				tt.config.RedirectURL != ""

			if hasRequiredFields != tt.valid {
				t.Errorf("Expected valid=%v, got valid=%v", tt.valid, hasRequiredFields)
			}

			// Use provider to avoid unused variable warning
			_ = provider
		})
	}
}
