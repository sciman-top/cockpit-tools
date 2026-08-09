package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
)

type readinessContractResponse struct {
	SchemaVersion     int       `json:"schemaVersion"`
	State             string    `json:"state"`
	Generation        uint64    `json:"generation"`
	ObservedAtUtc     time.Time `json:"observedAtUtc"`
	ReasonCode        string    `json:"reasonCode"`
	RetryAfterMs      int64     `json:"retryAfterMs"`
	RecentLiveSuccess bool      `json:"recentLiveSuccess"`
	Scope             struct {
		Model       string `json:"model"`
		APIKeyClass string `json:"apiKeyClass"`
	} `json:"scope"`
}

func newReadinessContractServer(t *testing.T) (*relayServer, *coreauth.Manager, *apiKeySpec) {
	t.Helper()
	account := &accountSpec{ID: "account-1", AuthID: "auth-1", AuthKind: "oauth"}
	spec := &apiKeySpec{
		ID:            "key-1",
		Key:           "client-key",
		Enabled:       true,
		AccountIDs:    []string{account.ID},
		AllowedModels: []string{"gpt-5.6-sol"},
	}
	m := &manifest{
		ModelIDs:        []string{"gpt-5.6-sol"},
		APIKeys:         []apiKeySpec{*spec},
		Accounts:        []accountSpec{*account},
		apiKeyByValue:   map[string]*apiKeySpec{spec.Key: spec},
		accountByID:     map[string]*accountSpec{account.ID: account},
		accountByAuthID: map[string]*accountSpec{account.AuthID: account},
	}
	manager := coreauth.NewManager(nil, &coreauth.RoundRobinSelector{}, nil)
	if _, err := manager.Register(context.Background(), &coreauth.Auth{
		ID:         account.AuthID,
		Provider:   "codex",
		Status:     coreauth.StatusActive,
		Attributes: map[string]string{"account_id": account.ID},
	}); err != nil {
		t.Fatalf("register auth: %v", err)
	}
	tracker := newReadinessTracker()
	return &relayServer{
		runtime:     &fakeRuntime{response: cliproxyexecutor.Response{Payload: []byte(`{"status":"completed"}`)}},
		cfg:         &config.Config{Host: "127.0.0.1", Port: 45335},
		manifest:    m,
		authManager: manager,
		policy:      &requestPolicy{manifest: m, tracker: newRequestUsageTracker()},
		readiness:   tracker,
	}, manager, spec
}

func serveReadinessRequest(router http.Handler, method, target, apiKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func decodeReadinessResponse(t *testing.T, recorder *httptest.ResponseRecorder) readinessContractResponse {
	t.Helper()
	var payload readinessContractResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode readiness response %d: %v; body=%s", recorder.Code, err, recorder.Body.String())
	}
	return payload
}

func TestHealthzReportsProcessLivenessWithoutAPIKey(t *testing.T) {
	server, _, _ := newReadinessContractServer(t)
	recorder := serveReadinessRequest(server.router(), http.MethodGet, "/healthz", "")
	if recorder.Code != http.StatusOK {
		t.Fatalf("healthz status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		SchemaVersion int    `json:"schemaVersion"`
		State         string `json:"state"`
		ConfigLoaded  bool   `json:"configLoaded"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode healthz: %v", err)
	}
	if payload.SchemaVersion != 1 || payload.State != "live" || !payload.ConfigLoaded {
		t.Fatalf("healthz payload = %#v", payload)
	}
}

func TestReadyzRequiresAuthAndSeparatesRouteAdmissionFromLiveness(t *testing.T) {
	server, manager, _ := newReadinessContractServer(t)
	router := server.router()

	unauthenticated := serveReadinessRequest(router, http.MethodGet, "/readyz?model=gpt-5.6-sol", "")
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated readyz status = %d, want 401", unauthenticated.Code)
	}

	ready := serveReadinessRequest(router, http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	if ready.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200; body=%s", ready.Code, ready.Body.String())
	}
	first := decodeReadinessResponse(t, ready)
	if first.SchemaVersion != 1 || first.State != "ready" || first.ReasonCode != "route_admissible" {
		t.Fatalf("readyz ready payload = %#v", first)
	}
	if first.Scope.Model != "gpt-5.6-sol" || first.Scope.APIKeyClass != "codex" {
		t.Fatalf("readyz scope = %#v", first.Scope)
	}

	auth, ok := manager.GetByID("auth-1")
	if !ok {
		t.Fatal("registered auth missing")
	}
	auth.Unavailable = true
	auth.NextRetryAfter = time.Now().Add(5 * time.Minute)
	auth.Quota.Exceeded = true
	if _, err := manager.Update(context.Background(), auth); err != nil {
		t.Fatalf("cool down auth: %v", err)
	}
	cooling := serveReadinessRequest(router, http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	if cooling.Code != http.StatusServiceUnavailable {
		t.Fatalf("cooling readyz status = %d, want 503; body=%s", cooling.Code, cooling.Body.String())
	}
	second := decodeReadinessResponse(t, cooling)
	if second.State != "cooling" || second.ReasonCode != "route_cooling" || second.RetryAfterMs <= 0 {
		t.Fatalf("readyz cooling payload = %#v", second)
	}
	if second.Generation <= first.Generation {
		t.Fatalf("generation did not advance: ready=%d cooling=%d", first.Generation, second.Generation)
	}
}

func TestReadyzActivelyProbesRouteBeforeReportingReady(t *testing.T) {
	server, _, _ := newReadinessContractServer(t)
	runtime := &fakeRuntime{
		response: cliproxyexecutor.Response{Payload: []byte(`{"id":"probe","object":"response","status":"completed"}`)},
	}
	server.runtime = runtime

	recorder := serveReadinessRequest(server.router(), http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	if recorder.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200; body=%s", recorder.Code, recorder.Body.String())
	}
	payload := decodeReadinessResponse(t, recorder)
	if !payload.RecentLiveSuccess || payload.State != readinessStateReady {
		t.Fatalf("readyz probe-backed payload = %#v", payload)
	}
	if runtime.executeCalls != 1 {
		t.Fatalf("readiness probe execute calls = %d, want 1", runtime.executeCalls)
	}
	if runtime.lastOpts.SourceFormat != sdktranslator.FormatOpenAIResponse {
		t.Fatalf("readiness probe source format = %q, want Responses", runtime.lastOpts.SourceFormat)
	}
	if got := runtime.lastReq.Metadata[cliproxyexecutor.RequestPathMetadataKey]; got != "/v1/responses" {
		t.Fatalf("readiness probe request path = %#v, want /v1/responses", got)
	}
}

func TestReadyzDoesNotReportReadyWhenActiveProbeGets429(t *testing.T) {
	server, _, _ := newReadinessContractServer(t)
	runtime := &fakeRuntime{err: relayStatusError{status: http.StatusTooManyRequests, message: "probe throttled"}}
	server.runtime = runtime

	recorder := serveReadinessRequest(server.router(), http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want 503; body=%s", recorder.Code, recorder.Body.String())
	}
	payload := decodeReadinessResponse(t, recorder)
	if payload.RecentLiveSuccess || payload.State == readinessStateReady || payload.State == readinessStateDegraded {
		t.Fatalf("readyz must fail closed after probe 429: %#v", payload)
	}
	if runtime.executeCalls != 1 {
		t.Fatalf("readiness probe execute calls = %d, want 1", runtime.executeCalls)
	}
}

func TestAuthFailureInvalidatesRecentReadinessSuccess(t *testing.T) {
	server, _, spec := newReadinessContractServer(t)
	server.readiness.markLiveSuccess(spec, "gpt-5.6-sol", time.Now())
	if !server.readiness.hasRecentLiveSuccess(spec, "gpt-5.6-sol", time.Now()) {
		t.Fatal("test precondition: recent success missing")
	}
	ctx := context.WithValue(context.Background(), clientAPIKeyContextKey, spec)
	ctx = context.WithValue(ctx, requestModelContextKey, "gpt-5.6-sol")
	hook := &authHook{manifest: server.manifest, readiness: server.readiness}
	hook.OnResult(ctx, coreauth.Result{
		Model:   "gpt-5.6-sol",
		Success: false,
		Error:   &coreauth.Error{HTTPStatus: http.StatusTooManyRequests, Retryable: true},
	})
	if server.readiness.hasRecentLiveSuccess(spec, "gpt-5.6-sol", time.Now()) {
		t.Fatal("retryable auth failure left stale recent success admissible")
	}
}

func TestReadyzProbesUnavailableRouteAfterCooldownExpires(t *testing.T) {
	server, manager, _ := newReadinessContractServer(t)
	auth, ok := manager.GetByID("auth-1")
	if !ok {
		t.Fatal("registered auth missing")
	}
	auth.Unavailable = true
	auth.NextRetryAfter = time.Now().Add(-time.Second)
	if _, err := manager.Update(context.Background(), auth); err != nil {
		t.Fatalf("expire auth cooldown: %v", err)
	}
	runtime := &fakeRuntime{response: cliproxyexecutor.Response{Payload: []byte(`{"status":"completed"}`)}}
	server.runtime = runtime

	recorder := serveReadinessRequest(server.router(), http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	if recorder.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200 after successful expired-cooldown probe; body=%s", recorder.Code, recorder.Body.String())
	}
	payload := decodeReadinessResponse(t, recorder)
	if !payload.RecentLiveSuccess || runtime.executeCalls != 1 {
		t.Fatalf("expired-cooldown probe was not accepted: payload=%#v calls=%d", payload, runtime.executeCalls)
	}
}

func TestReadyzGenerationWaitWakesOnUnavailableToReady(t *testing.T) {
	server, manager, _ := newReadinessContractServer(t)
	router := server.router()

	auth, ok := manager.GetByID("auth-1")
	if !ok {
		t.Fatal("registered auth missing")
	}
	auth.Unavailable = true
	auth.NextRetryAfter = time.Now().Add(5 * time.Minute)
	auth.Quota.Exceeded = true
	if _, err := manager.Update(context.Background(), auth); err != nil {
		t.Fatalf("cool down auth: %v", err)
	}
	cooling := serveReadinessRequest(router, http.MethodGet, "/readyz?model=gpt-5.6-sol", "client-key")
	coolingPayload := decodeReadinessResponse(t, cooling)

	result := make(chan *httptest.ResponseRecorder, 1)
	started := time.Now()
	go func() {
		result <- serveReadinessRequest(
			router,
			http.MethodGet,
			"/readyz?model=gpt-5.6-sol&after_version="+strconv.FormatUint(coolingPayload.Generation, 10)+"&wait_ms=2000",
			"client-key",
		)
	}()
	time.Sleep(100 * time.Millisecond)
	auth.Unavailable = false
	auth.NextRetryAfter = time.Time{}
	auth.Quota.Exceeded = false
	if _, err := manager.Update(context.Background(), auth); err != nil {
		t.Fatalf("restore auth: %v", err)
	}

	select {
	case recorder := <-result:
		elapsed := time.Since(started)
		if elapsed >= 2*time.Second {
			t.Fatalf("generation wait took %s", elapsed)
		}
		if recorder.Code != http.StatusOK {
			t.Fatalf("readyz after transition status = %d; body=%s", recorder.Code, recorder.Body.String())
		}
		ready := decodeReadinessResponse(t, recorder)
		if ready.State != "ready" || ready.Generation <= coolingPayload.Generation {
			t.Fatalf("readyz after transition payload = %#v", ready)
		}
	case <-time.After(2500 * time.Millisecond):
		t.Fatal("generation wait did not wake within bounded deadline")
	}
}

func TestReadinessWaitHonorsCancellation(t *testing.T) {
	server, _, spec := newReadinessContractServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := server.readiness.waitForGeneration(ctx, server, spec, "gpt-5.6-sol", ^uint64(0), 2*time.Second)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("wait error = %v, want context canceled", err)
	}
}
