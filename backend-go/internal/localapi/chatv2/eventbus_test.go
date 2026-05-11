package chatv2

import (
	"testing"
	"time"
)

func TestBroadcasterFansOutToAllSubscribers(t *testing.T) {
	b := newBroadcaster()
	defer b.Close()

	ch1, _ := b.Subscribe()
	ch2, _ := b.Subscribe()

	e := NewEvent(EventChatStarted, map[string]any{"chat_id": "abc"})
	b.Publish(e)

	for i, ch := range []<-chan Event{ch1, ch2} {
		select {
		case got := <-ch:
			if got.Type != EventChatStarted {
				t.Fatalf("sub %d: type=%q want=%q", i, got.Type, EventChatStarted)
			}
		case <-time.After(time.Second):
			t.Fatalf("sub %d: timed out waiting for event", i)
		}
	}
}

func TestBroadcasterUnsubscribeStopsDelivery(t *testing.T) {
	b := newBroadcaster()
	defer b.Close()

	ch, cancel := b.Subscribe()
	cancel()

	// Reading from the closed channel returns the zero value immediately.
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatalf("expected closed channel after unsubscribe")
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for channel close")
	}

	// Publish after unsubscribe must not panic.
	b.Publish(NewEvent(EventChatCompleted, nil))
}

func TestBroadcasterCloseIsIdempotent(t *testing.T) {
	b := newBroadcaster()
	b.Close()
	b.Close() // must not panic
	b.Publish(NewEvent(EventChatCompleted, nil))
}

// TestBroadcasterBlocksRatherThanDropsWhenBufferFull pins the design
// choice: publishing must apply backpressure to slow consumers instead
// of silently dropping events. Dropping caused the "Thinking… forever"
// bug in the browser when chat_completed got discarded.
func TestBroadcasterBlocksRatherThanDropsWhenBufferFull(t *testing.T) {
	b := newBroadcaster()
	defer b.Close()
	ch, _ := b.Subscribe()

	// Fill the buffer to capacity without reading anything.
	for range SubscriberBufferSize {
		b.Publish(NewEvent(EventReasoningDelta, map[string]any{"text": "x"}))
	}

	// One more publish should now block until we drain. Run it in a
	// goroutine and confirm it has not returned after a short pause.
	done := make(chan struct{})
	go func() {
		b.Publish(NewEvent(EventChatCompleted, nil))
		close(done)
	}()
	select {
	case <-done:
		t.Fatalf("expected Publish to block on a full buffer, but it returned")
	case <-time.After(20 * time.Millisecond):
		// Expected: still blocked.
	}

	// Drain one event and confirm the blocked publish unblocks.
	<-ch
	select {
	case <-done:
		// Expected.
	case <-time.After(time.Second):
		t.Fatalf("Publish did not unblock after the consumer drained one event")
	}
}

func TestRegistryGetOrCreateReturnsSameInstance(t *testing.T) {
	r := NewRegistry()
	a := r.GetOrCreate("chat1")
	b := r.GetOrCreate("chat1")
	if a != b {
		t.Fatalf("GetOrCreate returned different broadcasters for same chat_id")
	}
}

func TestRegistryRemoveClosesBroadcaster(t *testing.T) {
	r := NewRegistry()
	b := r.GetOrCreate("chat1")
	ch, _ := b.Subscribe()
	r.Remove("chat1")
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatalf("expected channel closed after Remove")
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for channel close after Remove")
	}
	if r.Get("chat1") != nil {
		t.Fatalf("expected nil after Remove")
	}
}
