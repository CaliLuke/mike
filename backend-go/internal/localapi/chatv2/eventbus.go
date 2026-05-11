package chatv2

import (
	"sync"
	"sync/atomic"
	"time"
)

// Broadcaster fans out Events from the chat workflow / activities to one or
// more SSE subscribers. There is one Broadcaster per chat_id, registered in
// the package-level Registry on first publish. When the workflow completes
// (or aborts) it calls Close to terminate every subscriber's channel.
//
// The metrics fields exist so callers can snapshot bus throughput onto the
// chat's parent span (`api.chat_stream_v2`) when the request ends. They are
// atomics so Publish doesn't pay an extra lock to update them.
type Broadcaster struct {
	mu     sync.Mutex
	subs   map[int]chan Event
	nextID int
	closed bool

	published       atomic.Int64
	delivered       atomic.Int64
	blockedCount    atomic.Int64
	blockedTotalUs  atomic.Int64
	maxBlockedUs    atomic.Int64
	maxSubscribers  atomic.Int64
	totalSubscribed atomic.Int64
}

// BroadcasterStats is a snapshot of Broadcaster counters at one instant.
// Returned by Stats(); intended for span attribution on request teardown.
type BroadcasterStats struct {
	Published         int64
	Delivered         int64
	BlockedCount      int64
	BlockedTotalMs    float64
	MaxBlockedMs      float64
	MaxSubscribers    int64
	TotalSubscribed   int64
	ActiveSubscribers int
}

// Stats snapshots the counters. Cheap; safe to call at any time.
func (b *Broadcaster) Stats() BroadcasterStats {
	b.mu.Lock()
	active := len(b.subs)
	b.mu.Unlock()
	return BroadcasterStats{
		Published:         b.published.Load(),
		Delivered:         b.delivered.Load(),
		BlockedCount:      b.blockedCount.Load(),
		BlockedTotalMs:    float64(b.blockedTotalUs.Load()) / 1000.0,
		MaxBlockedMs:      float64(b.maxBlockedUs.Load()) / 1000.0,
		MaxSubscribers:    b.maxSubscribers.Load(),
		TotalSubscribed:   b.totalSubscribed.Load(),
		ActiveSubscribers: active,
	}
}

func newBroadcaster() *Broadcaster {
	return &Broadcaster{subs: map[int]chan Event{}}
}

// SubscriberBufferSize is the per-subscriber channel buffer. A 20-second
// LLM response can produce hundreds of reasoning-delta events; the buffer
// has to outsize a typical burst so a brief consumer hiccup doesn't push
// us into the block path.
const SubscriberBufferSize = 1024

// Subscribe registers a buffered channel and returns it plus an unsubscribe
// function. Publish blocks if the subscriber is slow; see Publish for why.
// A subscriber that needs the full history (e.g. browser reconnect mid-chat)
// should cold-read the persisted timeline before subscribing.
func (b *Broadcaster) Subscribe() (<-chan Event, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.nextID
	b.nextID++
	ch := make(chan Event, SubscriberBufferSize)
	if b.closed {
		close(ch)
		return ch, func() {}
	}
	b.subs[id] = ch
	active := int64(len(b.subs))
	b.totalSubscribed.Add(1)
	for {
		prev := b.maxSubscribers.Load()
		if active <= prev || b.maxSubscribers.CompareAndSwap(prev, active) {
			break
		}
	}
	return ch, func() { b.unsubscribe(id) }
}

func (b *Broadcaster) unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subs[id]; ok {
		delete(b.subs, id)
		close(ch)
	}
}

// Publish fans the event out to all current subscribers. We BLOCK rather
// than drop when a subscriber's buffer is full: a dropped chat_completed
// (or content_delta) was reproducing as "Thinking…" hung forever in the
// browser, because the UI only clears its thinking placeholder when one
// of those terminal events lands. For a local single-process app the
// correct backpressure is "slow the producer down to the consumer's
// pace" — the upper-bound activity goroutine pause is bounded by how
// fast the SSE handler can flush bytes to the open connection.
//
// Holding b.mu across the send means one slow subscriber can stall
// publishes to other subscribers too. That's an acceptable trade-off
// today: the broadcaster always has 0 or 1 subscriber (per chat).
func (b *Broadcaster) Publish(e Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.published.Add(1)
	for _, ch := range b.subs {
		// Fast path: non-blocking send. If the buffer has headroom we don't
		// touch the wall clock at all.
		select {
		case ch <- e:
			b.delivered.Add(1)
			continue
		default:
		}
		// Slow path: block, time it, record. This is the signal we now want
		// when "Thinking… forever" comes back — non-zero blockedTotalUs
		// proves the consumer can't keep up.
		start := time.Now()
		ch <- e
		dur := time.Since(start).Microseconds()
		b.delivered.Add(1)
		b.blockedCount.Add(1)
		b.blockedTotalUs.Add(dur)
		for {
			prev := b.maxBlockedUs.Load()
			if dur <= prev || b.maxBlockedUs.CompareAndSwap(prev, dur) {
				break
			}
		}
	}
}

// Close terminates every subscriber's channel and marks the broadcaster as
// finished; subsequent Publish calls are no-ops. Idempotent.
func (b *Broadcaster) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.closed = true
	for _, ch := range b.subs {
		close(ch)
	}
	b.subs = map[int]chan Event{}
}

// Registry maps chat_id to its Broadcaster. Activities and the HTTP handler
// both look up by chat_id so they meet in the middle without sharing a parent.
type Registry struct {
	m sync.Map // chatID string -> *Broadcaster
}

// NewRegistry constructs an empty registry.
func NewRegistry() *Registry { return &Registry{} }

// GetOrCreate returns the broadcaster for chatID, creating one on first use.
func (r *Registry) GetOrCreate(chatID string) *Broadcaster {
	if existing, ok := r.m.Load(chatID); ok {
		if b, ok := existing.(*Broadcaster); ok {
			return b
		}
	}
	created := newBroadcaster()
	actual, loaded := r.m.LoadOrStore(chatID, created)
	if loaded {
		if b, ok := actual.(*Broadcaster); ok {
			return b
		}
	}
	return created
}

// Get returns the broadcaster for chatID if one exists, else nil.
func (r *Registry) Get(chatID string) *Broadcaster {
	if existing, ok := r.m.Load(chatID); ok {
		if b, ok := existing.(*Broadcaster); ok {
			return b
		}
	}
	return nil
}

// Remove deletes the broadcaster for chatID after closing it. Safe to call
// on an unknown chat_id.
func (r *Registry) Remove(chatID string) {
	if existing, ok := r.m.LoadAndDelete(chatID); ok {
		if b, ok := existing.(*Broadcaster); ok {
			b.Close()
		}
	}
}
