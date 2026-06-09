package helps

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

func TestNewProxyAwareHTTPClientDirectBypassesGlobalProxy(t *testing.T) {
	t.Parallel()

	client := NewProxyAwareHTTPClient(
		context.Background(),
		&config.Config{SDKConfig: sdkconfig.SDKConfig{ProxyURL: "http://global-proxy.example.com:8080"}},
		&cliproxyauth.Auth{ProxyURL: "direct"},
		0,
	)

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected direct transport to disable proxy function")
	}
}

func TestDetectProxyBypassForRequestBypassesAiInputResponsesSSEOnInheritedProxy(t *testing.T) {
	t.Parallel()

	req, err := http.NewRequest(http.MethodPost, "https://ai.input.im/responses", strings.NewReader(`{"stream":true}`))
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	decision := detectProxyBypassForRequest(req, &cliproxyauth.Auth{}, proxySourceConfig)
	if !decision.Bypass {
		t.Fatal("expected inherited proxy request to bypass proxy for ai.input.im responses SSE")
	}
	if decision.Reason == "" {
		t.Fatal("expected bypass decision to include a reason")
	}
}

func TestDetectProxyBypassForRequestSkipsExplicitAuthProxy(t *testing.T) {
	t.Parallel()

	req, err := http.NewRequest(http.MethodPost, "https://ai.input.im/responses", strings.NewReader(`{"stream":true}`))
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	decision := detectProxyBypassForRequest(req, &cliproxyauth.Auth{ProxyURL: "http://account-proxy.example.com:8080"}, proxySourceAuth)
	if decision.Bypass {
		t.Fatalf("expected explicit auth proxy to win, got bypass reason %q", decision.Reason)
	}
}

func TestDetectProxyBypassForRequestUsesConfiguredPathPrefixRule(t *testing.T) {
	t.Parallel()

	req, err := http.NewRequest(http.MethodPost, "http://35.213.82.91:8003/v1/responses", strings.NewReader(`{"stream":true}`))
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	cfg := &config.Config{
		SDKConfig: config.SDKConfig{
			TransportBypass: []config.TransportBypassRule{
				{
					Host:       "35.213.82.91",
					PathPrefix: "/v1/responses",
					SSEOnly:    true,
					Action:     "direct",
				},
			},
		},
	}
	cfg.SanitizeTransportBypass()

	decision := detectProxyBypassForRequestWithConfig(req, cfg, &cliproxyauth.Auth{}, proxySourceConfig)
	if !decision.Bypass {
		t.Fatal("expected configured path-prefix rule to bypass inherited proxy")
	}
	if !strings.Contains(decision.Reason, "35.213.82.91") {
		t.Fatalf("expected reason to mention configured host, got %q", decision.Reason)
	}
	if !strings.Contains(decision.Reason, "/v1/responses") {
		t.Fatalf("expected reason to mention configured path-prefix, got %q", decision.Reason)
	}
}

func TestDetectProxyBypassForRequestSkipsConfiguredRuleWithoutSSEAccept(t *testing.T) {
	t.Parallel()

	req, err := http.NewRequest(http.MethodPost, "http://35.213.82.91:8003/v1/responses", strings.NewReader(`{"stream":false}`))
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	req.Header.Set("Accept", "application/json")

	cfg := &config.Config{
		SDKConfig: config.SDKConfig{
			TransportBypass: []config.TransportBypassRule{
				{
					Host:       "35.213.82.91",
					PathPrefix: "/v1/responses",
					SSEOnly:    true,
				},
			},
		},
	}
	cfg.SanitizeTransportBypass()

	decision := detectProxyBypassForRequestWithConfig(req, cfg, &cliproxyauth.Auth{}, proxySourceConfig)
	if decision.Bypass {
		t.Fatalf("expected non-SSE request to skip bypass, got reason %q", decision.Reason)
	}
}

func TestProxyBypassRoundTripperFallsBackToProxyWhenDirectDialFails(t *testing.T) {
	t.Parallel()

	req, err := http.NewRequest(http.MethodPost, "https://ai.input.im/responses", strings.NewReader(`{"stream":true}`))
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	directCalls := 0
	proxyCalls := 0
	rt := &proxyBypassRoundTripper{
		auth:        &cliproxyauth.Auth{},
		proxySource: proxySourceConfig,
		direct: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			directCalls++
			return nil, errors.New("dial tcp: direct path failed")
		}),
		proxied: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			proxyCalls++
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("io.ReadAll returned error: %v", err)
			}
			if got := string(body); got != `{"stream":true}` {
				t.Fatalf("body = %q, want %q", got, `{"stream":true}`)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("ok")),
				Request:    req,
			}, nil
		}),
	}

	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip returned error: %v", err)
	}
	if errClose := resp.Body.Close(); errClose != nil {
		t.Fatalf("response body close returned error: %v", errClose)
	}
	if directCalls != 1 {
		t.Fatalf("directCalls = %d, want 1", directCalls)
	}
	if proxyCalls != 1 {
		t.Fatalf("proxyCalls = %d, want 1", proxyCalls)
	}
}

func TestProxyBypassRoundTripperRecordsTransportDecisionInRequestLog(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ctx := context.WithValue(context.Background(), "gin", ginCtx)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://ai.input.im/responses", strings.NewReader(`{"stream":true}`))
	if err != nil {
		t.Fatalf("http.NewRequestWithContext returned error: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	RecordAPIRequest(ctx, &config.Config{SDKConfig: config.SDKConfig{RequestLog: true}}, UpstreamRequestLog{
		URL:    req.URL.String(),
		Method: req.Method,
	})

	rt := &proxyBypassRoundTripper{
		auth:        &cliproxyauth.Auth{},
		cfg:         &config.Config{SDKConfig: config.SDKConfig{RequestLog: true}},
		proxySource: proxySourceConfig,
		direct: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return nil, errors.New("direct path failed")
		}),
		proxied: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("ok")),
				Request:    req,
			}, nil
		}),
	}

	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip returned error: %v", err)
	}
	if errClose := resp.Body.Close(); errClose != nil {
		t.Fatalf("response body close returned error: %v", errClose)
	}

	raw, exists := ginCtx.Get(apiResponseKey)
	if !exists {
		t.Fatal("expected api response log to be present")
	}
	responseLog, ok := raw.([]byte)
	if !ok {
		t.Fatalf("api response log type = %T, want []byte", raw)
	}
	text := string(responseLog)
	if !strings.Contains(text, "Transport: action=direct_bypass_attempt") {
		t.Fatalf("expected direct attempt in response log, got %q", text)
	}
	if !strings.Contains(text, "Transport: action=direct_bypass_failed_fallback_proxy") {
		t.Fatalf("expected proxy fallback in response log, got %q", text)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
