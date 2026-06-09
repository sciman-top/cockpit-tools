package config

import "testing"

func TestParseConfigBytesSanitizesTransportBypassRules(t *testing.T) {
	t.Parallel()

	cfg, err := ParseConfigBytes([]byte(`
proxy-url: "http://127.0.0.1:10808"
transport-bypass:
  - host: " 35.213.82.91 "
    path-prefix: "v1/responses/"
    sse-only: true
  - host: ""
    path: "/responses"
    action: "direct"
  - host: "example.com"
    path-prefix: "/v1/responses"
    action: "proxy"
`))
	if err != nil {
		t.Fatalf("ParseConfigBytes returned error: %v", err)
	}

	if len(cfg.TransportBypass) != 1 {
		t.Fatalf("transport bypass rule count = %d, want 1", len(cfg.TransportBypass))
	}

	rule := cfg.TransportBypass[0]
	if rule.Host != "35.213.82.91" {
		t.Fatalf("rule host = %q, want %q", rule.Host, "35.213.82.91")
	}
	if rule.PathPrefix != "/v1/responses" {
		t.Fatalf("rule path-prefix = %q, want %q", rule.PathPrefix, "/v1/responses")
	}
	if !rule.SSEOnly {
		t.Fatal("expected sse-only rule to stay true")
	}
	if rule.Action != "direct" {
		t.Fatalf("rule action = %q, want %q", rule.Action, "direct")
	}
}
