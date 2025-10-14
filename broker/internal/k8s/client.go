package k8s

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/purdue-af/vscode-k8s-connector/internal/types"
	authenticationv1 "k8s.io/api/authentication/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// ClientInterface defines the interface for Kubernetes operations
type ClientInterface interface {
	// CreateServiceAccount creates a ServiceAccount in the specified namespace
	CreateServiceAccount(ctx context.Context, namespace, name string) error

	// CreateRoleBinding creates a RoleBinding for the ServiceAccount
	CreateRoleBinding(ctx context.Context, namespace, saName, podName string) error

	// MintToken creates a short-lived token for the ServiceAccount
	MintToken(ctx context.Context, namespace, saName string, ttl int64) (string, error)

	// DeleteServiceAccount removes a ServiceAccount and its RoleBinding
	DeleteServiceAccount(ctx context.Context, namespace, name string) error

	// GetPod retrieves pod information
	GetPod(ctx context.Context, namespace, name string) (*types.PodInfo, error)

	// CreateSessionServiceAccount creates a ServiceAccount and RoleBinding for a session
	CreateSessionServiceAccount(ctx context.Context, namespace, podName string) (string, error)
}

// Client implements the k8s.ClientInterface interface
type Client struct {
	clientset *kubernetes.Clientset
}

// NewClient creates a new Kubernetes client
func NewClient(kubeconfigPath string) (*Client, error) {
	var config *rest.Config
	var err error

	if kubeconfigPath != "" {
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	} else {
		config, err = rest.InClusterConfig()
		if err != nil {
			// Fall back to default kubeconfig
			config, err = clientcmd.BuildConfigFromFlags("", clientcmd.RecommendedHomeFile)
		}
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create k8s config: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, fmt.Errorf("failed to create k8s clientset: %w", err)
	}

	return &Client{clientset: clientset}, nil
}

// CreateServiceAccount creates a ServiceAccount in the specified namespace
func (c *Client) CreateServiceAccount(ctx context.Context, namespace, name string) error {
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
	}

	_, err := c.clientset.CoreV1().ServiceAccounts(namespace).Create(ctx, sa, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create service account: %w", err)
	}

	return nil
}

// CreateRoleBinding creates a RoleBinding for the ServiceAccount
func (c *Client) CreateRoleBinding(ctx context.Context, namespace, saName, podName string) error {
	roleBinding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("vscode-session-%s", saName),
			Namespace: namespace,
		},
		Subjects: []rbacv1.Subject{
			{
				Kind:      "ServiceAccount",
				Name:      saName,
				Namespace: namespace,
			},
		},
		RoleRef: rbacv1.RoleRef{
			Kind:     "Role",
			Name:     "vscode-session",
			APIGroup: "rbac.authorization.k8s.io",
		},
	}

	// Create the Role first
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "vscode-session",
			Namespace: namespace,
		},
		Rules: []rbacv1.PolicyRule{
			{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"get"},
			},
			{
				APIGroups:     []string{""},
				Resources:     []string{"pods/exec", "pods/portforward", "pods/log"},
				Verbs:         []string{"create", "get"},
				ResourceNames: []string{podName},
			},
		},
	}

	_, err := c.clientset.RbacV1().Roles(namespace).Create(ctx, role, metav1.CreateOptions{})
	if err != nil {
		// Role might already exist, continue
	}

	_, err = c.clientset.RbacV1().RoleBindings(namespace).Create(ctx, roleBinding, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("failed to create role binding: %w", err)
	}

	return nil
}

// MintToken creates a short-lived token for the ServiceAccount
func (c *Client) MintToken(ctx context.Context, namespace, saName string, ttl int64) (string, error) {
	tokenRequest := &authenticationv1.TokenRequest{
		Spec: authenticationv1.TokenRequestSpec{
			Audiences:         []string{"https://kubernetes.default.svc.cluster.local"},
			ExpirationSeconds: &ttl,
		},
	}

	tokenRequest, err := c.clientset.CoreV1().ServiceAccounts(namespace).CreateToken(
		ctx, saName, tokenRequest, metav1.CreateOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to create token: %w", err)
	}

	return tokenRequest.Status.Token, nil
}

// DeleteServiceAccount removes a ServiceAccount and its RoleBinding
func (c *Client) DeleteServiceAccount(ctx context.Context, namespace, name string) error {
	// Delete RoleBinding first
	roleBindingName := fmt.Sprintf("vscode-session-%s", name)
	err := c.clientset.RbacV1().RoleBindings(namespace).Delete(ctx, roleBindingName, metav1.DeleteOptions{})
	if err != nil {
		// Log but don't fail - RoleBinding might not exist
	}

	// Delete ServiceAccount
	err = c.clientset.CoreV1().ServiceAccounts(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil {
		return fmt.Errorf("failed to delete service account: %w", err)
	}

	return nil
}

// GetPod retrieves pod information
func (c *Client) GetPod(ctx context.Context, namespace, name string) (*types.PodInfo, error) {
	pod, err := c.clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	return &types.PodInfo{
		Name:      pod.Name,
		Namespace: pod.Namespace,
		Status:    string(pod.Status.Phase),
	}, nil
}

// CreateSessionServiceAccount creates a ServiceAccount and RoleBinding for a session
func (c *Client) CreateSessionServiceAccount(ctx context.Context, namespace, podName string) (string, error) {
	// Generate unique ServiceAccount name
	saName := fmt.Sprintf("vscode-sess-%s", uuid.New().String()[:8])

	// Create ServiceAccount
	if err := c.CreateServiceAccount(ctx, namespace, saName); err != nil {
		return "", fmt.Errorf("failed to create service account: %w", err)
	}

	// Create RoleBinding
	if err := c.CreateRoleBinding(ctx, namespace, saName, podName); err != nil {
		// Cleanup ServiceAccount if RoleBinding fails
		c.DeleteServiceAccount(ctx, namespace, saName)
		return "", fmt.Errorf("failed to create role binding: %w", err)
	}

	// Mint token (1 hour TTL)
	token, err := c.MintToken(ctx, namespace, saName, 3600)
	if err != nil {
		// Cleanup if token creation fails
		c.DeleteServiceAccount(ctx, namespace, saName)
		return "", fmt.Errorf("failed to mint token: %w", err)
	}

	return token, nil
}
