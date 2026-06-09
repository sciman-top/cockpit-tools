package helps

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
	log "github.com/sirupsen/logrus"
)

type proxySource string

const (
	proxySourceNone   proxySource = "none"
	proxySourceAuth   proxySource = "auth"
	proxySourceConfig proxySource = "config"
	proxySourceEnv    proxySource = "env"
)

type proxyBypassDecision struct {
	Bypass bool
	Reason string
}

type proxyBypassRoundTripper struct {
	cfg         *config.Config
	auth        *cliproxyauth.Auth
	proxySource proxySource
	direct      http.RoundTripper
	proxied     http.RoundTripper
}

func detectProxyBypassForRequest(req *http.Request, auth *cliproxyauth.Auth, source proxySource) proxyBypassDecision {
	if req == nil || req.URL == nil {
		return proxyBypassDecision{}
	}
	if source == proxySourceAuth || source == proxySourceNone {
		return proxyBypassDecision{}
	}
	if decision, ok := matchConfiguredProxyBypass(req, defaultProxyBypassRules()); ok {
		return decision
	}
	return proxyBypassDecision{}
}

func matchConfiguredProxyBypass(req *http.Request, rules []config.TransportBypassRule) (proxyBypassDecision, bool) {
	if req == nil || req.URL == nil || len(rules) == 0 {
		return proxyBypassDecision{}, false
	}

	host := strings.ToLower(strings.TrimSpace(req.URL.Hostname()))
	path := normalizeRequestMatchPath(req.URL.Path)
	accept := strings.ToLower(strings.TrimSpace(req.Header.Get("Accept")))

	for _, rule := range rules {
		if strings.ToLower(strings.TrimSpace(rule.Host)) != host {
			continue
		}
		if rule.SSEOnly && !strings.Contains(accept, "text/event-stream") {
			continue
		}
		exactPath := normalizeRequestMatchPath(rule.Path)
		prefixPath := normalizeRequestMatchPath(rule.PathPrefix)
		if exactPath != "" && path != exactPath {
			continue
		}
		if prefixPath != "" && !strings.HasPrefix(path, prefixPath) {
			continue
		}
		action := strings.ToLower(strings.TrimSpace(rule.Action))
		if action == "" {
			action = "direct"
		}
		if action != "direct" {
			continue
		}
		return proxyBypassDecision{
			Bypass: true,
			Reason: formatProxyBypassReason(rule, host, path),
		}, true
	}

	return proxyBypassDecision{}, false
}

func defaultProxyBypassRules() []config.TransportBypassRule {
	return []config.TransportBypassRule{
		{
			Host:    "ai.input.im",
			Path:    "/responses",
			SSEOnly: true,
			Action:  "direct",
		},
	}
}

func configuredProxyBypassRules(cfg *config.Config) []config.TransportBypassRule {
	if cfg == nil || len(cfg.TransportBypass) == 0 {
		return defaultProxyBypassRules()
	}

	merged := make([]config.TransportBypassRule, 0, len(cfg.TransportBypass)+len(defaultProxyBypassRules()))
	merged = append(merged, cfg.TransportBypass...)
	for _, fallback := range defaultProxyBypassRules() {
		if hasEquivalentProxyBypassRule(merged, fallback) {
			continue
		}
		merged = append(merged, fallback)
	}
	return merged
}

func hasEquivalentProxyBypassRule(rules []config.TransportBypassRule, candidate config.TransportBypassRule) bool {
	candidateHost := strings.ToLower(strings.TrimSpace(candidate.Host))
	candidatePath := normalizeRequestMatchPath(candidate.Path)
	candidatePrefix := normalizeRequestMatchPath(candidate.PathPrefix)
	candidateAction := strings.ToLower(strings.TrimSpace(candidate.Action))
	if candidateAction == "" {
		candidateAction = "direct"
	}

	for _, rule := range rules {
		action := strings.ToLower(strings.TrimSpace(rule.Action))
		if action == "" {
			action = "direct"
		}
		if strings.ToLower(strings.TrimSpace(rule.Host)) != candidateHost {
			continue
		}
		if normalizeRequestMatchPath(rule.Path) != candidatePath {
			continue
		}
		if normalizeRequestMatchPath(rule.PathPrefix) != candidatePrefix {
			continue
		}
		if rule.SSEOnly != candidate.SSEOnly {
			continue
		}
		if action != candidateAction {
			continue
		}
		return true
	}

	return false
}

func normalizeRequestMatchPath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	if trimmed != "/" {
		trimmed = strings.TrimRight(trimmed, "/")
	}
	return trimmed
}

func formatProxyBypassReason(rule config.TransportBypassRule, host string, matchedPath string) string {
	if normalizeRequestMatchPath(rule.Path) != "" {
		if rule.SSEOnly {
			return fmt.Sprintf("%s %s SSE prefers direct transport over inherited proxy", host, normalizeRequestMatchPath(rule.Path))
		}
		return fmt.Sprintf("%s %s prefers direct transport over inherited proxy", host, normalizeRequestMatchPath(rule.Path))
	}
	if normalizeRequestMatchPath(rule.PathPrefix) != "" {
		if rule.SSEOnly {
			return fmt.Sprintf("%s %s* SSE prefers direct transport over inherited proxy", host, normalizeRequestMatchPath(rule.PathPrefix))
		}
		return fmt.Sprintf("%s %s* prefers direct transport over inherited proxy", host, normalizeRequestMatchPath(rule.PathPrefix))
	}
	if rule.SSEOnly {
		return fmt.Sprintf("%s %s SSE prefers direct transport over inherited proxy", host, matchedPath)
	}
	return fmt.Sprintf("%s %s prefers direct transport over inherited proxy", host, matchedPath)
}

func (r *proxyBypassRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if r == nil || r.proxied == nil {
		return nil, fmt.Errorf("proxy bypass round tripper is not configured")
	}
	decision := detectProxyBypassForRequestWithConfig(req, r.cfg, r.auth, r.proxySource)
	if !decision.Bypass || r.direct == nil {
		return r.proxied.RoundTrip(req)
	}

	directReq, err := cloneRequestForTransportRetry(req)
	if err != nil {
		log.WithError(err).Debug("proxy bypass skipped because request body is not replayable")
		return r.proxied.RoundTrip(req)
	}

	log.WithFields(log.Fields{
		"host":         requestHost(req),
		"path":         requestPath(req),
		"proxy_source": r.proxySource,
		"reason":       decision.Reason,
	}).Debug("proxy bypass: trying direct transport")
	RecordAPITransportDecision(req.Context(), r.cfg, UpstreamTransportDecision{
		Action:      "direct_bypass_attempt",
		Host:        requestHost(req),
		Path:        requestPath(req),
		ProxySource: string(r.proxySource),
		Reason:      decision.Reason,
	})

	resp, err := r.direct.RoundTrip(directReq)
	if err == nil {
		RecordAPITransportDecision(req.Context(), r.cfg, UpstreamTransportDecision{
			Action:      "direct_bypass_success",
			Host:        requestHost(req),
			Path:        requestPath(req),
			ProxySource: string(r.proxySource),
			Reason:      decision.Reason,
		})
		return resp, nil
	}

	log.WithFields(log.Fields{
		"host":         requestHost(req),
		"path":         requestPath(req),
		"proxy_source": r.proxySource,
		"reason":       decision.Reason,
	}).WithError(err).Warn("proxy bypass direct transport failed; falling back to proxied transport")
	RecordAPITransportDecision(req.Context(), r.cfg, UpstreamTransportDecision{
		Action:      "direct_bypass_failed_fallback_proxy",
		Host:        requestHost(req),
		Path:        requestPath(req),
		ProxySource: string(r.proxySource),
		Reason:      decision.Reason,
	})

	proxiedReq, cloneErr := cloneRequestForTransportRetry(req)
	if cloneErr != nil {
		return nil, err
	}
	return r.proxied.RoundTrip(proxiedReq)
}

func detectProxyBypassForRequestWithConfig(req *http.Request, cfg *config.Config, auth *cliproxyauth.Auth, source proxySource) proxyBypassDecision {
	if req == nil || req.URL == nil {
		return proxyBypassDecision{}
	}
	if source == proxySourceAuth || source == proxySourceNone {
		return proxyBypassDecision{}
	}
	if decision, ok := matchConfiguredProxyBypass(req, configuredProxyBypassRules(cfg)); ok {
		return decision
	}
	return proxyBypassDecision{}
}

func cloneRequestForTransportRetry(req *http.Request) (*http.Request, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	cloned := req.Clone(req.Context())
	if req.Body == nil || req.Body == http.NoBody {
		cloned.Body = req.Body
		return cloned, nil
	}
	if req.GetBody == nil {
		return nil, fmt.Errorf("request body is not replayable")
	}
	body, err := req.GetBody()
	if err != nil {
		return nil, err
	}
	cloned.Body = body
	return cloned, nil
}

func requestHost(req *http.Request) string {
	if req == nil || req.URL == nil {
		return ""
	}
	return strings.TrimSpace(req.URL.Hostname())
}

func requestPath(req *http.Request) string {
	if req == nil || req.URL == nil {
		return ""
	}
	return strings.TrimSpace(req.URL.Path)
}

// NewProxyAwareHTTPClient creates an HTTP client with proper proxy configuration priority:
// 1. Use auth.ProxyURL if configured (highest priority)
// 2. Use cfg.ProxyURL if auth proxy is not configured
// 3. Use RoundTripper from context if neither are configured
//
// Parameters:
//   - ctx: The context containing optional RoundTripper
//   - cfg: The application configuration
//   - auth: The authentication information
//   - timeout: The client timeout (0 means no timeout)
//
// Returns:
//   - *http.Client: An HTTP client with configured proxy or transport
func NewProxyAwareHTTPClient(ctx context.Context, cfg *config.Config, auth *cliproxyauth.Auth, timeout time.Duration) *http.Client {
	httpClient := &http.Client{}
	if timeout > 0 {
		httpClient.Timeout = timeout
	}

	// Priority 1: Use auth.ProxyURL if configured
	var proxyURL string
	source := proxySourceNone
	if auth != nil {
		proxyURL = strings.TrimSpace(auth.ProxyURL)
		if proxyURL != "" {
			source = proxySourceAuth
		}
	}

	// Priority 2: Use cfg.ProxyURL if auth proxy is not configured
	if proxyURL == "" && cfg != nil {
		proxyURL = strings.TrimSpace(cfg.ProxyURL)
		if proxyURL != "" {
			source = proxySourceConfig
		}
	}

	// If we have a proxy URL configured, set up the transport
	if proxyURL != "" {
		transport := buildProxyTransport(proxyURL)
		if transport != nil {
			httpClient.Transport = wrapProxyBypassRoundTripper(transport, directHTTPTransport(), cfg, auth, source, proxyURL)
			return httpClient
		}
		// If proxy setup failed, log and fall through to context RoundTripper
		log.Debugf("failed to setup proxy from URL: %s, falling back to context transport", proxyutil.Redact(proxyURL))
	}

	// Priority 3: Use RoundTripper from context (typically from RoundTripperFor)
	if rt, ok := ctx.Value("cliproxy.roundtripper").(http.RoundTripper); ok && rt != nil {
		httpClient.Transport = rt
	}

	return httpClient
}

// buildProxyTransport creates an HTTP transport configured for the given proxy URL.
// It supports SOCKS5, HTTP, and HTTPS proxy protocols.
//
// Parameters:
//   - proxyURL: The proxy URL string (e.g., "socks5://user:pass@host:port", "http://host:port")
//
// Returns:
//   - *http.Transport: A configured transport, or nil if the proxy URL is invalid
func buildProxyTransport(proxyURL string) *http.Transport {
	transport, _, errBuild := proxyutil.BuildHTTPTransport(proxyURL)
	if errBuild != nil {
		log.Errorf("%v", errBuild)
		return nil
	}
	return transport
}

func directHTTPTransport() http.RoundTripper {
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return http.DefaultTransport
	}
	clone := base.Clone()
	clone.Proxy = nil
	return clone
}

func wrapProxyBypassRoundTripper(proxied http.RoundTripper, direct http.RoundTripper, cfg *config.Config, auth *cliproxyauth.Auth, source proxySource, proxyURL string) http.RoundTripper {
	if proxied == nil || direct == nil {
		return proxied
	}
	if source == proxySourceAuth || strings.EqualFold(strings.TrimSpace(proxyURL), "direct") {
		return proxied
	}
	return &proxyBypassRoundTripper{
		cfg:         cfg,
		auth:        auth,
		proxySource: source,
		direct:      direct,
		proxied:     proxied,
	}
}
