package chatv2

import "sync"

// Broadcaster fans out Events from the chat workflow / activities to one or
// more SSE subscribers. There is one Broadcaster per chat_id, registered in
// the package-level Registry on first publish. When the workflow completes
// (or aborts) it calls Close to terminate every subscriber's channel.
type Broadcaster struct {
	mu     sync.Mutex
	subs   map[int]chan Event
	nextID int
	closed bool
}

func newBroadcaster() *Broadcaster {
	return &Broadcaster{subs: map[int]chan Event{}}
}

// Subscribe registers a buffered channel and returns it plus an unsubscribe
// function. Buffering keeps a slow consumer from blocking the publisher; if
// the buffer fills, the event is dropped for that subscriber (the activity
// continues, the client falls behind). A subscriber that needs the full
// history should cold-read the persisted timeline before subscribing.
func (b *Broadcaster) Subscribe() (<-chan Event, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	id := b.nextID
	b.nextID++
	ch := make(chan Event, 64)
	if b.closed {
		close(ch)
		return ch, func() {}
	}
	b.subs[id] = ch
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

// Publish fans the event out to all current subscribers without blocking on
// slow ones (full channel = drop for that subscriber).
func (b *Broadcaster) Publish(e Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	for _, ch := range b.subs {
		select {
		case ch <- e:
		default:
			// Subscriber buffer full; drop. Better to lose one event for one
			// client than to stall the entire activity goroutine.
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
		return existing.(*Broadcaster)
	}
	created := newBroadcaster()
	actual, loaded := r.m.LoadOrStore(chatID, created)
	if loaded {
		return actual.(*Broadcaster)
	}
	return created
}

// Get returns the broadcaster for chatID if one exists, else nil.
func (r *Registry) Get(chatID string) *Broadcaster {
	if existing, ok := r.m.Load(chatID); ok {
		return existing.(*Broadcaster)
	}
	return nil
}

// Remove deletes the broadcaster for chatID after closing it. Safe to call
// on an unknown chat_id.
func (r *Registry) Remove(chatID string) {
	if existing, ok := r.m.LoadAndDelete(chatID); ok {
		existing.(*Broadcaster).Close()
	}
}
