package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	defaultPreSemanticMaxCount       = 16
	defaultPreSemanticMaxMemoryBytes = 32 << 20
	defaultPreSemanticMaxBodyBytes   = 16 << 20
	defaultPreSemanticMaxDuration    = 30 * time.Second
)

var (
	errPreSemanticAdmissionCount    = errors.New("pre-semantic admission count cap reached")
	errPreSemanticAdmissionMemory   = errors.New("pre-semantic admission memory cap reached")
	errPreSemanticAdmissionBody     = errors.New("pre-semantic admission body cap reached")
	errPreSemanticAdmissionDuration = errors.New("pre-semantic admission duration cap reached")
)

// semanticEventLatch records the wire boundary separately from the first
// provider semantic event. SSE comments are deliberately wire-only.
type semanticEventLatch struct {
	wireObserved       bool
	semanticObserved   bool
	firstSemanticEvent string
	wireObservedAt     time.Time
	semanticObservedAt time.Time
}

func (l *semanticEventLatch) observeWire(payload []byte) bool {
	if l == nil || len(payload) == 0 {
		return false
	}
	if l.wireObserved {
		return false
	}
	l.wireObserved = true
	l.wireObservedAt = time.Now().UTC()
	return true
}

func (l *semanticEventLatch) observeSemantic(event string) bool {
	if l == nil || l.semanticObserved {
		return false
	}
	event = strings.TrimSpace(event)
	if event == "" {
		return false
	}
	l.semanticObserved = true
	l.firstSemanticEvent = event
	l.semanticObservedAt = time.Now().UTC()
	return true
}

// semanticEventName normalizes the smallest useful provider boundary. It
// ignores SSE comments, retry fields and the terminal [DONE] marker.
func semanticEventName(payload []byte) string {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || bytes.HasPrefix(trimmed, []byte(":")) {
		return ""
	}
	var data []byte
	for _, rawLine := range bytes.Split(trimmed, []byte("\n")) {
		line := bytes.TrimSpace(rawLine)
		switch {
		case len(line) == 0 || bytes.HasPrefix(line, []byte(":")):
			continue
		case bytes.HasPrefix(line, []byte("event:")):
			name := strings.TrimSpace(string(line[len("event:"):]))
			if name == "" || strings.EqualFold(name, "keep-alive") || strings.EqualFold(name, "waiting-for-upstream") {
				continue
			}
			return name
		case bytes.HasPrefix(line, []byte("data:")):
			data = bytes.TrimSpace(line[len("data:"):])
		case bytes.HasPrefix(line, []byte("id:")), bytes.HasPrefix(line, []byte("retry:")):
			continue
		}
	}
	if len(data) == 0 || bytes.Equal(data, []byte("[DONE]")) {
		return ""
	}
	var object map[string]any
	if json.Unmarshal(data, &object) == nil {
		if event, ok := object["type"].(string); ok && strings.TrimSpace(event) != "" {
			return strings.TrimSpace(event)
		}
		return "data"
	}
	var rawObject map[string]any
	if json.Unmarshal(trimmed, &rawObject) == nil {
		if event, ok := rawObject["type"].(string); ok && strings.TrimSpace(event) != "" {
			return strings.TrimSpace(event)
		}
		return "payload"
	}
	if len(data) > 0 {
		return "data"
	}
	return ""
}

type semanticTrackingWriter struct {
	writer io.Writer
	latch  *semanticEventLatch
}

func (w semanticTrackingWriter) Write(payload []byte) (int, error) {
	if w.latch != nil {
		w.latch.observeWire(payload)
		w.latch.observeSemantic(semanticEventName(payload))
	}
	return w.writer.Write(payload)
}

type preSemanticAdmissionConfig struct {
	MaxCount       int
	MaxMemoryBytes int64
	MaxBodyBytes   int64
	MaxDuration    time.Duration
}

func (c preSemanticAdmissionConfig) normalized() preSemanticAdmissionConfig {
	if c.MaxCount <= 0 {
		c.MaxCount = defaultPreSemanticMaxCount
	}
	if c.MaxMemoryBytes <= 0 {
		c.MaxMemoryBytes = defaultPreSemanticMaxMemoryBytes
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = defaultPreSemanticMaxBodyBytes
	}
	if c.MaxDuration <= 0 {
		c.MaxDuration = defaultPreSemanticMaxDuration
	}
	return c
}

type preSemanticAdmission struct {
	config preSemanticAdmissionConfig
	slots  chan struct{}

	mu           sync.Mutex
	activeMemory int64
}

func newPreSemanticAdmission(config preSemanticAdmissionConfig) *preSemanticAdmission {
	config = config.normalized()
	return &preSemanticAdmission{
		config: config,
		slots:  make(chan struct{}, config.MaxCount),
	}
}

func (a *preSemanticAdmission) maxBodyBytes() int64 {
	if a == nil {
		return defaultPreSemanticMaxBodyBytes
	}
	return a.config.MaxBodyBytes
}

type preSemanticLease struct {
	admission *preSemanticAdmission
	bytes     int64
	once      sync.Once
}

func (a *preSemanticAdmission) acquire(parent context.Context, bodyBytes int64) (*preSemanticLease, error) {
	if a == nil {
		a = newPreSemanticAdmission(preSemanticAdmissionConfig{})
	}
	if parent == nil {
		parent = context.Background()
	}
	if bodyBytes < 0 || bodyBytes > a.config.MaxBodyBytes {
		return nil, errPreSemanticAdmissionBody
	}
	// A body which cannot fit in the bounded memory budget is rejected before
	// waiting for a slot; it can never become safe by parking longer.
	if bodyBytes > a.config.MaxMemoryBytes {
		return nil, errPreSemanticAdmissionMemory
	}
	a.mu.Lock()
	memoryUnavailable := a.activeMemory+bodyBytes > a.config.MaxMemoryBytes
	a.mu.Unlock()
	if memoryUnavailable {
		return nil, errPreSemanticAdmissionMemory
	}
	waitCtx, cancel := context.WithTimeout(parent, a.config.MaxDuration)
	defer cancel()
	select {
	case a.slots <- struct{}{}:
	case <-waitCtx.Done():
		if errors.Is(parent.Err(), context.Canceled) {
			return nil, context.Canceled
		}
		if errors.Is(parent.Err(), context.DeadlineExceeded) {
			return nil, context.DeadlineExceeded
		}
		return nil, fmt.Errorf("%w: %w", errPreSemanticAdmissionDuration, errPreSemanticAdmissionCount)
	}
	a.mu.Lock()
	if a.activeMemory+bodyBytes > a.config.MaxMemoryBytes {
		a.mu.Unlock()
		<-a.slots
		return nil, errPreSemanticAdmissionMemory
	}
	a.activeMemory += bodyBytes
	a.mu.Unlock()
	return &preSemanticLease{admission: a, bytes: bodyBytes}, nil
}

func (l *preSemanticLease) release() {
	if l == nil || l.admission == nil {
		return
	}
	l.once.Do(func() {
		a := l.admission
		a.mu.Lock()
		a.activeMemory -= l.bytes
		if a.activeMemory < 0 {
			a.activeMemory = 0
		}
		a.mu.Unlock()
		<-a.slots
	})
}

type sseFrameResult struct {
	frame []byte
	err   error
	done  bool
}

// forEachSSEFrameWithKeepAlive keeps the wire connection alive while the
// upstream is silent. Comments never enter the semantic event stream.
func forEachSSEFrameWithKeepAlive(
	parent context.Context,
	body io.Reader,
	interval time.Duration,
	onFrame func([]byte) error,
	onKeepAlive func() error,
) error {
	if parent == nil {
		parent = context.Background()
	}
	if body == nil {
		return io.EOF
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	frames := make(chan sseFrameResult, 1)
	go func() {
		reader := bufio.NewReader(body)
		var frame bytes.Buffer
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 {
				frame.Write(line)
				if isSSEFrameBoundary(line) {
					payload := bytes.Clone(frame.Bytes())
					frame.Reset()
					select {
					case frames <- sseFrameResult{frame: payload}:
					case <-ctx.Done():
						return
					}
				}
			}
			if err != nil {
				if frame.Len() > 0 {
					select {
					case frames <- sseFrameResult{frame: bytes.Clone(frame.Bytes())}:
					case <-ctx.Done():
						return
					}
				}
				select {
				case frames <- sseFrameResult{err: err, done: true}:
				case <-ctx.Done():
				}
				return
			}
		}
	}()

	var ticker *time.Ticker
	var tickerC <-chan time.Time
	if interval > 0 {
		ticker = time.NewTicker(interval)
		tickerC = ticker.C
		defer ticker.Stop()
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tickerC:
			if onKeepAlive != nil {
				if err := onKeepAlive(); err != nil {
					return err
				}
			}
		case result := <-frames:
			if len(result.frame) > 0 && onFrame != nil {
				if err := onFrame(result.frame); err != nil {
					return err
				}
			}
			if result.done {
				if errors.Is(result.err, io.EOF) {
					return nil
				}
				return result.err
			}
		}
	}
}

func isSSEFrameBoundary(line []byte) bool {
	return bytes.Equal(bytes.TrimSpace(line), nil)
}

func writeAmbiguousSubmission(c *gin.Context, cause error) {
	if c == nil {
		return
	}
	detail := "upstream submission outcome is unknown"
	if cause != nil && strings.TrimSpace(cause.Error()) != "" {
		detail = detail + ": " + strings.TrimSpace(cause.Error())
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusBadGateway, gin.H{
		"schemaVersion":          1,
		"resultCode":             "ambiguous_submission",
		"safeToReplay":           false,
		"reconciliationRequired": true,
		"error": gin.H{
			"type":                    "ambiguous_submission",
			"code":                    "ambiguous_submission",
			"message":                 detail,
			"safe_to_replay":          false,
			"reconciliation_required": true,
		},
	})
}

func writePreSemanticAdmissionError(c *gin.Context, admissionErr error) {
	if errors.Is(admissionErr, errPreSemanticAdmissionBody) {
		writeAPIError(c, http.StatusRequestEntityTooLarge, "request body exceeds the bounded pre-semantic admission limit", "request_body_too_large")
		return
	}
	if errors.Is(admissionErr, context.Canceled) {
		writeAPIError(c, http.StatusRequestTimeout, "request canceled while waiting for pre-semantic admission", "admission_canceled")
		return
	}
	writeAPIError(c, http.StatusTooManyRequests, "pre-semantic admission capacity is bounded", "pre_semantic_admission_limited")
}

func readAndRestoreBodyBounded(r *http.Request, limit int64) ([]byte, bool, error) {
	if r == nil || r.Body == nil {
		return nil, false, nil
	}
	if limit <= 0 {
		limit = defaultPreSemanticMaxBodyBytes
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	_ = r.Body.Close()
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, int64(len(body)) > limit, err
}

func (s *relayServer) preSemanticAdmission() *preSemanticAdmission {
	if s != nil && s.admission != nil {
		return s.admission
	}
	return newPreSemanticAdmission(preSemanticAdmissionConfig{})
}

func (s *relayServer) providerHTTPClient() *http.Client {
	if s != nil && s.httpClient != nil {
		return s.httpClient
	}
	return http.DefaultClient
}
