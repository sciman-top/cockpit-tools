package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
)

const (
	readinessSchemaVersion = 1
	readinessMaxWait       = 5 * time.Second
	readinessPollInterval  = 25 * time.Millisecond
	readinessSuccessWindow = 15 * time.Minute
	readinessProbeTimeout  = 5 * time.Second
)

const (
	readinessStateReady       = "ready"
	readinessStateDegraded    = "degraded"
	readinessStateCooling     = "cooling"
	readinessStateUnavailable = "unavailable"
	readinessStateUnknown     = "unknown"
)

type readinessScope struct {
	Model       string `json:"model"`
	APIKeyClass string `json:"apiKeyClass"`
}

// readinessSnapshot is the stable v1 wire contract consumed by Watch Runtime.
// It intentionally contains only scope labels, hashes/ids are not required for
// route admission and secrets never cross this boundary.
type readinessSnapshot struct {
	SchemaVersion     int            `json:"schemaVersion"`
	State             string         `json:"state"`
	Generation        uint64         `json:"generation"`
	ObservedAtUtc     time.Time      `json:"observedAtUtc"`
	ReasonCode        string         `json:"reasonCode"`
	RetryAfterMs      int64          `json:"retryAfterMs"`
	RecentLiveSuccess bool           `json:"recentLiveSuccess"`
	Scope             readinessScope `json:"scope"`
}

type readinessEvaluation struct {
	state      string
	reasonCode string
	retryAfter time.Duration
}

type readinessTracker struct {
	mu            sync.Mutex
	generation    uint64
	scopes        map[string]readinessSnapshot
	recentSuccess map[string]time.Time
	recentFailure map[string]time.Time
	probes        map[string]*readinessProbeCall
	changeSignal  chan struct{}
}

type readinessProbeCall struct {
	done chan struct{}
	err  error
}

func newReadinessTracker() *readinessTracker {
	return &readinessTracker{
		scopes:        make(map[string]readinessSnapshot),
		recentSuccess: make(map[string]time.Time),
		recentFailure: make(map[string]time.Time),
		probes:        make(map[string]*readinessProbeCall),
		changeSignal:  make(chan struct{}),
	}
}

func (t *readinessTracker) signal() {
	if t == nil {
		return
	}
	t.mu.Lock()
	t.signalLocked()
	t.mu.Unlock()
}

func (t *readinessTracker) signalLocked() {
	if t.changeSignal == nil {
		t.changeSignal = make(chan struct{})
		return
	}
	close(t.changeSignal)
	t.changeSignal = make(chan struct{})
}

func (t *readinessTracker) currentSignal() <-chan struct{} {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.changeSignal
}

func (t *readinessTracker) markLiveSuccess(spec *apiKeySpec, model string, observedAt time.Time) {
	if t == nil {
		return
	}
	key := readinessScopeKey(spec, model)
	t.mu.Lock()
	t.recentSuccess[key] = observedAt.UTC()
	delete(t.recentFailure, key)
	t.signalLocked()
	t.mu.Unlock()
}

func (t *readinessTracker) markLiveFailure(spec *apiKeySpec, model string, observedAt time.Time) {
	if t == nil {
		return
	}
	key := readinessScopeKey(spec, model)
	t.mu.Lock()
	delete(t.recentSuccess, key)
	t.recentFailure[key] = observedAt.UTC()
	t.signalLocked()
	t.mu.Unlock()
}

func (t *readinessTracker) hasRecentLiveSuccess(spec *apiKeySpec, model string, now time.Time) bool {
	if t == nil {
		return false
	}
	key := readinessScopeKey(spec, model)
	t.mu.Lock()
	defer t.mu.Unlock()
	observedAt, ok := t.recentSuccess[key]
	return ok && !observedAt.IsZero() && now.Sub(observedAt) <= readinessSuccessWindow
}

func (t *readinessTracker) runProbe(ctx context.Context, spec *apiKeySpec, model string, probe func(context.Context) error) error {
	key := readinessScopeKey(spec, model)
	t.mu.Lock()
	if existing := t.probes[key]; existing != nil {
		t.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-existing.done:
			return existing.err
		}
	}
	call := &readinessProbeCall{done: make(chan struct{})}
	t.probes[key] = call
	t.mu.Unlock()

	call.err = probe(ctx)
	t.mu.Lock()
	delete(t.probes, key)
	close(call.done)
	t.mu.Unlock()
	return call.err
}

func (t *readinessTracker) snapshot(server *relayServer, spec *apiKeySpec, model string) readinessSnapshot {
	if t == nil {
		return readinessSnapshot{
			SchemaVersion: readinessSchemaVersion,
			State:         readinessStateUnknown,
			ObservedAtUtc: time.Now().UTC(),
			ReasonCode:    "readiness_tracker_unavailable",
			Scope:         readinessScope{Model: strings.TrimSpace(model), APIKeyClass: apiKeyClass(spec)},
		}
	}
	model = strings.TrimSpace(model)
	now := time.Now().UTC()
	evaluation := server.evaluateReadiness(spec, model, now)
	key := readinessScopeKey(spec, model)
	t.mu.Lock()
	defer t.mu.Unlock()
	recent := false
	if observedAt, ok := t.recentSuccess[key]; ok && !observedAt.IsZero() && now.Sub(observedAt) <= readinessSuccessWindow {
		recent = true
	}
	if recent && evaluation.state == readinessStateUnavailable && evaluation.reasonCode == "route_unavailable" {
		evaluation = readinessEvaluation{state: readinessStateReady, reasonCode: "live_probe_succeeded"}
	}
	if !recent && (evaluation.state == readinessStateReady || evaluation.state == readinessStateDegraded) {
		if _, failed := t.recentFailure[key]; failed {
			evaluation = readinessEvaluation{state: readinessStateUnavailable, reasonCode: "live_probe_failed", retryAfter: time.Second}
		}
	}
	previous, exists := t.scopes[key]
	if !exists || previous.State != evaluation.state || previous.ReasonCode != evaluation.reasonCode || previous.RecentLiveSuccess != recent {
		t.generation++
		if t.generation == 0 {
			t.generation = 1
		}
		t.signalLocked()
	}
	retryAfterMs := durationMillis(evaluation.retryAfter)
	snapshot := readinessSnapshot{
		SchemaVersion:     readinessSchemaVersion,
		State:             evaluation.state,
		Generation:        t.generation,
		ObservedAtUtc:     now,
		ReasonCode:        evaluation.reasonCode,
		RetryAfterMs:      retryAfterMs,
		RecentLiveSuccess: recent,
		Scope: readinessScope{
			Model:       model,
			APIKeyClass: apiKeyClass(spec),
		},
	}
	t.scopes[key] = snapshot
	return snapshot
}

func (t *readinessTracker) waitForGeneration(
	ctx context.Context,
	server *relayServer,
	spec *apiKeySpec,
	model string,
	afterVersion uint64,
	wait time.Duration,
) (readinessSnapshot, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return readinessSnapshot{}, err
	}
	if wait < 0 {
		wait = 0
	}
	if wait > readinessMaxWait {
		wait = readinessMaxWait
	}
	deadline := time.NewTimer(wait)
	defer deadline.Stop()
	ticker := time.NewTicker(readinessPollInterval)
	defer ticker.Stop()
	for {
		snapshot := t.snapshot(server, spec, model)
		if afterVersion == 0 || snapshot.Generation > afterVersion || wait == 0 {
			return snapshot, nil
		}
		signal := t.currentSignal()
		select {
		case <-ctx.Done():
			return readinessSnapshot{}, ctx.Err()
		case <-deadline.C:
			return t.snapshot(server, spec, model), nil
		case <-ticker.C:
		case <-signal:
		}
	}
}

func durationMillis(value time.Duration) int64 {
	if value <= 0 {
		return 0
	}
	return value.Milliseconds()
}

func readinessScopeKey(spec *apiKeySpec, model string) string {
	key := ""
	if spec != nil {
		key = strings.TrimSpace(spec.ID)
		if key == "" {
			key = strings.TrimSpace(spec.Key)
		}
	}
	return strings.ToLower(key + "\x00" + apiKeyClass(spec) + "\x00" + strings.TrimSpace(model))
}

func apiKeyClass(spec *apiKeySpec) string {
	if spec != nil && spec.ProviderGateway != nil {
		return "provider_gateway"
	}
	return "codex"
}

func (s *relayServer) evaluateReadiness(spec *apiKeySpec, model string, now time.Time) readinessEvaluation {
	if s == nil || spec == nil || s.manifest == nil {
		return readinessEvaluation{state: readinessStateUnknown, reasonCode: "scope_unknown"}
	}
	model = strings.TrimSpace(model)
	canonical := canonicalModelForClientModel(s.manifest, spec, model)
	if model == "" || canonical == "" || !validateClientModelVisible(s.manifest, spec, model, canonical) {
		return readinessEvaluation{state: readinessStateUnavailable, reasonCode: "route_not_configured"}
	}
	if spec.ProviderGateway != nil {
		gateway := spec.ProviderGateway
		if strings.TrimSpace(gateway.BaseURL) == "" || strings.TrimSpace(gateway.APIKey) == "" {
			return readinessEvaluation{state: readinessStateUnavailable, reasonCode: "route_not_configured"}
		}
		return readinessEvaluation{state: readinessStateReady, reasonCode: "route_admissible"}
	}
	if s.authManager == nil {
		return readinessEvaluation{state: readinessStateUnknown, reasonCode: "auth_manager_unavailable"}
	}

	var candidates []*coreauth.Auth
	for _, auth := range s.authManager.List() {
		if auth == nil || !strings.EqualFold(strings.TrimSpace(auth.Provider), "codex") {
			continue
		}
		if !readinessAuthInScope(s.manifest, spec, auth) || authModelExcluded(s.manifest, auth, canonical) {
			continue
		}
		candidates = append(candidates, auth)
	}
	if len(candidates) == 0 {
		return readinessEvaluation{state: readinessStateUnavailable, reasonCode: "no_auth_candidate"}
	}

	readyCount := 0
	coolingCount := 0
	otherUnavailableCount := 0
	var earliest time.Time
	for _, auth := range candidates {
		reason, retryAt := readinessAuthBlock(auth, canonical, now)
		if reason == "" {
			readyCount++
			continue
		}
		if reason == "auth_cooling" {
			coolingCount++
			if !retryAt.IsZero() && (earliest.IsZero() || retryAt.Before(earliest)) {
				earliest = retryAt
			}
			continue
		}
		otherUnavailableCount++
	}
	if readyCount > 0 {
		if coolingCount > 0 || otherUnavailableCount > 0 {
			return readinessEvaluation{state: readinessStateDegraded, reasonCode: "route_degraded", retryAfter: remainingDuration(earliest, now)}
		}
		return readinessEvaluation{state: readinessStateReady, reasonCode: "route_admissible"}
	}
	if coolingCount == len(candidates) && !earliest.IsZero() {
		return readinessEvaluation{state: readinessStateCooling, reasonCode: "route_cooling", retryAfter: remainingDuration(earliest, now)}
	}
	return readinessEvaluation{state: readinessStateUnavailable, reasonCode: "route_unavailable"}
}

func readinessAuthInScope(m *manifest, spec *apiKeySpec, auth *coreauth.Auth) bool {
	if spec == nil || len(spec.AccountIDs) == 0 {
		return true
	}
	allowed := make(map[string]struct{}, len(spec.AccountIDs))
	for _, id := range spec.AccountIDs {
		if id = strings.TrimSpace(id); id != "" {
			allowed[id] = struct{}{}
		}
	}
	if account := accountForAuthInManifest(m, auth); account != nil {
		_, ok := allowed[strings.TrimSpace(account.ID)]
		return ok
	}
	if auth != nil && auth.Attributes != nil {
		_, ok := allowed[strings.TrimSpace(auth.Attributes["account_id"])]
		return ok
	}
	return false
}

func readinessAuthBlock(auth *coreauth.Auth, model string, now time.Time) (string, time.Time) {
	if auth == nil || auth.Disabled || auth.Status == coreauth.StatusDisabled {
		return "auth_disabled", time.Time{}
	}
	state := auth.ModelStates[model]
	if state == nil {
		for key, candidate := range auth.ModelStates {
			if strings.EqualFold(strings.TrimSpace(key), strings.TrimSpace(model)) {
				state = candidate
				break
			}
		}
	}
	if state != nil {
		if state.Status == coreauth.StatusDisabled {
			return "auth_disabled", time.Time{}
		}
		if state.Unavailable {
			if !state.NextRetryAfter.IsZero() && state.NextRetryAfter.After(now) {
				return "auth_cooling", state.NextRetryAfter
			}
			return "auth_unavailable", time.Time{}
		}
	}
	if auth.Unavailable {
		if !auth.NextRetryAfter.IsZero() && auth.NextRetryAfter.After(now) {
			return "auth_cooling", auth.NextRetryAfter
		}
		return "auth_unavailable", time.Time{}
	}
	if auth.Status != "" && auth.Status != coreauth.StatusActive {
		return "auth_unavailable", time.Time{}
	}
	return "", time.Time{}
}

func remainingDuration(retryAt, now time.Time) time.Duration {
	if retryAt.IsZero() || !retryAt.After(now) {
		return 0
	}
	return retryAt.Sub(now)
}

func (s *relayServer) handleHealthz(c *gin.Context) {
	configLoaded := s != nil && s.cfg != nil && s.manifest != nil
	status := http.StatusOK
	if !configLoaded {
		status = http.StatusServiceUnavailable
	}
	c.JSON(status, gin.H{
		"schemaVersion": readinessSchemaVersion,
		"state":         map[bool]string{true: "live", false: "unavailable"}[configLoaded],
		"observedAtUtc": time.Now().UTC(),
		"configLoaded":  configLoaded,
	})
}

func (s *relayServer) handleReadyz(c *gin.Context) {
	spec, ok := s.requireAPIKey(c)
	if !ok {
		return
	}
	model := ""
	if c != nil && c.Request != nil && c.Request.URL != nil {
		model = strings.TrimSpace(c.Request.URL.Query().Get("model"))
	}
	if model == "" {
		writeAPIError(c, http.StatusBadRequest, "model is required", "invalid_request")
		return
	}
	if s.readiness == nil {
		s.readiness = newReadinessTracker()
	}
	initial := s.readiness.snapshot(s, spec, model)
	if readinessNeedsActiveProbe(initial) {
		probeCtx, cancel := context.WithTimeout(c.Request.Context(), readinessProbeTimeout)
		probeErr := s.readiness.runProbe(probeCtx, spec, model, func(ctx context.Context) error {
			return s.executeReadinessProbe(ctx, c, spec, model)
		})
		cancel()
		if probeErr != nil {
			s.readiness.markLiveFailure(spec, model, time.Now())
		}
	}
	afterVersion, wait, err := parseReadinessWait(c)
	if err != nil {
		writeAPIError(c, http.StatusBadRequest, err.Error(), "invalid_request")
		return
	}
	snapshot, err := s.readiness.waitForGeneration(c.Request.Context(), s, spec, model, afterVersion, wait)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		writeAPIError(c, http.StatusServiceUnavailable, "readiness unavailable", "readiness_unavailable")
		return
	}
	if snapshot.RetryAfterMs > 0 {
		c.Header("Retry-After", strconv.FormatInt((snapshot.RetryAfterMs+999)/1000, 10))
	}
	c.Header("Cache-Control", "no-store")
	status := http.StatusServiceUnavailable
	if snapshot.State == readinessStateReady || snapshot.State == readinessStateDegraded {
		status = http.StatusOK
	}
	c.JSON(status, snapshot)
}

func readinessNeedsActiveProbe(snapshot readinessSnapshot) bool {
	if snapshot.RecentLiveSuccess || snapshot.RetryAfterMs > 0 {
		return false
	}
	switch snapshot.ReasonCode {
	case "route_admissible", "route_degraded", "route_unavailable", "live_probe_failed":
		return true
	default:
		return false
	}
}

func (s *relayServer) executeReadinessProbe(ctx context.Context, c *gin.Context, spec *apiKeySpec, model string) error {
	if s == nil || s.runtime == nil {
		return errors.New("readiness probe runtime unavailable")
	}
	payload, err := json.Marshal(map[string]any{
		"model":             model,
		"input":             "Reply exactly OK.",
		"max_output_tokens": 4,
		"store":             false,
	})
	if err != nil {
		return err
	}
	// The probe payload is a Responses API request. Do not inherit /readyz as
	// the executor path or request kind: doing so can select the wrong upstream
	// protocol and poison auth cooldown with a probe-generated failure.
	ctx = context.WithValue(ctx, requestKindContextKey, "text")
	req, opts := buildExecutorRequest(c, payload, model, sdktranslator.FormatOpenAIResponse, "", false)
	req.Metadata[cliproxyexecutor.RequestPathMetadataKey] = "/v1/responses"
	opts.Metadata[cliproxyexecutor.RequestPathMetadataKey] = "/v1/responses"
	if _, err = s.runtime.Execute(ctx, []string{"codex"}, req, opts); err != nil {
		return err
	}
	s.readiness.markLiveSuccess(spec, model, time.Now())
	return nil
}

func parseReadinessWait(c *gin.Context) (uint64, time.Duration, error) {
	if c == nil || c.Request == nil || c.Request.URL == nil {
		return 0, 0, nil
	}
	query := c.Request.URL.Query()
	afterRaw := strings.TrimSpace(query.Get("after_version"))
	if afterRaw == "" {
		afterRaw = strings.TrimSpace(query.Get("after_generation"))
	}
	after := uint64(0)
	if afterRaw != "" {
		parsed, err := strconv.ParseUint(afterRaw, 10, 64)
		if err != nil {
			return 0, 0, errors.New("after_version must be a non-negative integer")
		}
		after = parsed
	}
	waitRaw := strings.TrimSpace(query.Get("wait_ms"))
	if waitRaw == "" {
		return after, 0, nil
	}
	parsed, err := strconv.ParseInt(waitRaw, 10, 64)
	if err != nil || parsed < 0 {
		return 0, 0, errors.New("wait_ms must be a non-negative integer")
	}
	if parsed > int64(readinessMaxWait/time.Millisecond) {
		parsed = int64(readinessMaxWait / time.Millisecond)
	}
	return after, time.Duration(parsed) * time.Millisecond, nil
}
