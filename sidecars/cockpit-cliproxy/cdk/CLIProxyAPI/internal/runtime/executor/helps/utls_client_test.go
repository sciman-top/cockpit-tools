package helps

import (
	"context"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"testing"

	"golang.org/x/net/proxy"
)

type utlsClientRoundTripFunc func(*http.Request) (*http.Response, error)

func (f utlsClientRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestNewUtlsHTTPClientUsesContextRoundTripperForProtectedHost(t *testing.T) {
	t.Parallel()

	called := false
	ctx := context.WithValue(context.Background(), "cliproxy.roundtripper", utlsClientRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		called = true
		if req.URL.Hostname() != "chatgpt.com" {
			t.Fatalf("hostname = %q, want chatgpt.com", req.URL.Hostname())
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader("{}")),
			Request:    req,
		}, nil
	}))

	client := NewUtlsHTTPClient(ctx, nil, nil, 0)
	resp, err := client.Get("https://chatgpt.com/backend-api/codex/responses")
	if err != nil {
		t.Fatalf("client.Get returned error: %v", err)
	}
	if errClose := resp.Body.Close(); errClose != nil {
		t.Fatalf("response body close returned error: %v", errClose)
	}
	if !called {
		t.Fatal("expected context RoundTripper to handle protected host request")
	}
}

func TestNewUtlsHTTPClientUsesEnvironmentProxyForProtectedHost(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Setenv("HTTPS_PROXY", "")
		t.Setenv("HTTP_PROXY", "")
		t.Setenv("ALL_PROXY", "")
		t.Setenv("NO_PROXY", "")
		t.Setenv("https_proxy", "http://proxy.example.com:8080")
		t.Setenv("http_proxy", "")
		t.Setenv("all_proxy", "")
		t.Setenv("no_proxy", "")
		if got := os.Getenv("https_proxy"); got != "http://proxy.example.com:8080" {
			t.Fatalf("https_proxy env = %q, want http://proxy.example.com:8080", got)
		}
	} else {
		t.Setenv("HTTPS_PROXY", "http://proxy.example.com:8080")
		t.Setenv("HTTP_PROXY", "")
		t.Setenv("ALL_PROXY", "")
		t.Setenv("NO_PROXY", "")
		t.Setenv("https_proxy", "")
		t.Setenv("http_proxy", "")
		t.Setenv("all_proxy", "")
		t.Setenv("no_proxy", "")
	}

	if got := envProxyURL(); got != "http://proxy.example.com:8080" {
		t.Fatalf("envProxyURL() = %q, want http://proxy.example.com:8080", got)
	}

	client := NewUtlsHTTPClient(context.Background(), nil, nil, 0)
	fallback, ok := client.Transport.(*fallbackRoundTripper)
	if !ok {
		t.Fatalf("transport type = %T, want *fallbackRoundTripper", client.Transport)
	}
	utlsRT, ok := fallback.utls.(*utlsRoundTripper)
	if !ok {
		t.Fatalf("utls transport type = %T, want *utlsRoundTripper", fallback.utls)
	}
	if utlsRT.dialer == proxy.Direct {
		t.Fatalf("expected protected-host uTLS transport to use HTTPS_PROXY instead of direct dialing, got %T", utlsRT.dialer)
	}
}

func TestNewUtlsHTTPClientWrapsInheritedProxyFallbackWithBypassRoundTripper(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Setenv("HTTPS_PROXY", "")
		t.Setenv("HTTP_PROXY", "")
		t.Setenv("ALL_PROXY", "")
		t.Setenv("NO_PROXY", "")
		t.Setenv("https_proxy", "http://proxy.example.com:8080")
		t.Setenv("http_proxy", "")
		t.Setenv("all_proxy", "")
		t.Setenv("no_proxy", "")
	} else {
		t.Setenv("HTTPS_PROXY", "http://proxy.example.com:8080")
		t.Setenv("HTTP_PROXY", "")
		t.Setenv("ALL_PROXY", "")
		t.Setenv("NO_PROXY", "")
		t.Setenv("https_proxy", "")
		t.Setenv("http_proxy", "")
		t.Setenv("all_proxy", "")
		t.Setenv("no_proxy", "")
	}

	client := NewUtlsHTTPClient(context.Background(), nil, nil, 0)
	fallback, ok := client.Transport.(*fallbackRoundTripper)
	if !ok {
		t.Fatalf("transport type = %T, want *fallbackRoundTripper", client.Transport)
	}
	if _, ok := fallback.fallback.(*proxyBypassRoundTripper); !ok {
		t.Fatalf("fallback transport type = %T, want *proxyBypassRoundTripper", fallback.fallback)
	}
}
