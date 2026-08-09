package main

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

func TestSemanticEventLatchSeparatesWireAndSemanticBoundaries(t *testing.T) {
	var latch semanticEventLatch
	if latch.observeWire([]byte(": waiting-for-upstream\n\n")) != true {
		t.Fatal("wire observation should be recorded")
	}
	if latch.wireObservedAt.IsZero() {
		t.Fatal("wire observation timestamp should be recorded")
	}
	if latch.semanticObserved {
		t.Fatal("wire-only SSE comment must not become semantic")
	}
	if latch.observeSemantic("response.created") != true {
		t.Fatal("first semantic event should be recorded")
	}
	if !latch.semanticObserved || latch.firstSemanticEvent != "response.created" {
		t.Fatalf("unexpected semantic boundary: %#v", latch)
	}
	if latch.observeSemantic("response.completed") {
		t.Fatal("subsequent semantic events must not replace the first boundary")
	}
}

func TestSemanticEventNameIgnoresWireOnlyComments(t *testing.T) {
	for _, payload := range [][]byte{
		[]byte(": keep-alive\n\n"),
		[]byte("retry: 1000\n\n"),
		[]byte("data: [DONE]\n\n"),
	} {
		if got := semanticEventName(payload); got != "" {
			t.Fatalf("wire-only payload %q became semantic event %q", payload, got)
		}
	}
	if got := semanticEventName([]byte("event: response.created\ndata: {}\n\n")); got != "response.created" {
		t.Fatalf("semantic SSE event = %q", got)
	}
	if got := semanticEventName([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")); got != "data" {
		t.Fatalf("data SSE event = %q", got)
	}
}

func TestPreSemanticAdmissionEnforcesCountMemoryBodyAndDurationCaps(t *testing.T) {
	admission := newPreSemanticAdmission(preSemanticAdmissionConfig{
		MaxCount:       1,
		MaxMemoryBytes: 4,
		MaxBodyBytes:   4,
		MaxDuration:    25 * time.Millisecond,
	})
	first, err := admission.acquire(context.Background(), 4)
	if err != nil {
		t.Fatalf("first admission: %v", err)
	}
	defer first.release()
	if _, err := admission.acquire(context.Background(), 1); !errors.Is(err, errPreSemanticAdmissionMemory) {
		t.Fatalf("memory cap error = %v", err)
	}
	if _, err := admission.acquire(context.Background(), 5); !errors.Is(err, errPreSemanticAdmissionBody) {
		t.Fatalf("body cap error = %v", err)
	}
	first.release()
	holder, err := admission.acquire(context.Background(), 1)
	if err != nil {
		t.Fatalf("count holder admission: %v", err)
	}
	defer holder.release()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	started := time.Now()
	if _, err := admission.acquire(ctx, 1); !errors.Is(err, errPreSemanticAdmissionDuration) || !errors.Is(err, errPreSemanticAdmissionCount) {
		t.Fatalf("count/duration cap error = %v", err)
	}
	if elapsed := time.Since(started); elapsed < 15*time.Millisecond || elapsed > 250*time.Millisecond {
		t.Fatalf("admission did not honor bounded duration: %s", elapsed)
	}
}

func TestPreSemanticAdmissionCancellationDoesNotLeakSlot(t *testing.T) {
	admission := newPreSemanticAdmission(preSemanticAdmissionConfig{
		MaxCount:       1,
		MaxMemoryBytes: 16,
		MaxBodyBytes:   16,
		MaxDuration:    time.Second,
	})
	first, err := admission.acquire(context.Background(), 1)
	if err != nil {
		t.Fatalf("first admission: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := admission.acquire(ctx, 1); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled admission error = %v", err)
	}
	first.release()
	second, err := admission.acquire(context.Background(), 1)
	if err != nil {
		t.Fatalf("slot leaked after release: %v", err)
	}
	second.release()
}

func TestSSEKeepAliveIsWireOnlyAndDoesNotBlockSemanticFrame(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	var output bytes.Buffer
	var latch semanticEventLatch
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- forEachSSEFrameWithKeepAlive(ctx, reader, 5*time.Millisecond, func(frame []byte) error {
			latch.observeWire(frame)
			_, err := output.Write(frame)
			return err
		}, func() error {
			comment := []byte(": keep-alive\n\n")
			latch.observeWire(comment)
			_, err := output.Write(comment)
			return err
		})
	}()
	time.Sleep(20 * time.Millisecond)
	if !strings.Contains(output.String(), ": keep-alive\n\n") {
		t.Fatalf("expected wire-only keepalive, output=%q", output.String())
	}
	if latch.semanticObserved {
		t.Fatal("keepalive must not mark a semantic event")
	}
	_, _ = writer.Write([]byte("event: response.created\ndata: {}\n\n"))
	_ = writer.Close()
	if err := <-done; err != nil {
		t.Fatalf("frame pump: %v", err)
	}
	if !strings.Contains(output.String(), "event: response.created") {
		t.Fatalf("semantic frame missing: %q", output.String())
	}
	if semanticEventName([]byte("event: response.created\ndata: {}\n\n")) == "" {
		t.Fatal("semantic frame should be recognizable")
	}
}
