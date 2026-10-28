// Package resource holds the wire types and thresholds for the low disk space
// and memory pressure notices. It is a leaf so cmd/go2ts can import it
// without pulling in the server package.
package resource

// Kind names a monitored resource. Each kind has its own episodes, dismissal
// and notice.
type Kind string

const (
	Disk   Kind = "disk"
	Memory Kind = "memory"
)

// Kinds lists every kind in display order.
var Kinds = []Kind{Disk, Memory}

const (
	// DiskThreshold starts a low-space episode when available bytes fall below it.
	DiskThreshold = uint64(2 << 30)
	// DiskCriticalThreshold escalates an episode. Escalation clears any earlier
	// dismissal exactly once and then latches until the episode recovers.
	DiskCriticalThreshold = uint64(500 << 20)

	// A memory episode starts when MemAvailable falls below the low line,
	// MemoryLowPercent of MemTotal but at most MemoryLowCap (a big VM with
	// gigabytes free is not short of memory), or when over the last minute
	// some task was stalled on memory more than MemoryStallPercent of the time
	// (PSI "some" avg60). It escalates below half the low line, or when all
	// tasks were stalled more than MemoryStallPercent of the time (PSI "full"
	// avg60). Both readings swing, so it recovers only above 1.5 times the low
	// line with at most half the stall: hovering around the line must not end
	// one episode and start the next, re-showing a dismissed notice.
	MemoryLowPercent   = 10
	MemoryLowCap       = uint64(2 << 30)
	MemoryStallPercent = 10
)

// Status is the last successful observation of one resource: the database
// filesystem for Disk, the system's memory for Memory.
// Revision orders transitions of one kind, including HTTP dismissal responses versus SSE.
// AvailableBytes, TotalBytes and StallPercent are cached, not persisted, and may change within one revision.
type Status struct {
	Kind           Kind   `json:"kind"`
	EpisodeID      uint64 `json:"episode_id"`
	Revision       uint64 `json:"revision"`
	Active         bool   `json:"active"`
	Critical       bool   `json:"critical"`
	Dismissed      bool   `json:"dismissed"`
	AvailableBytes uint64 `json:"available_bytes"`
	TotalBytes     uint64 `json:"total_bytes"`
	// StallPercent is the share of the last minute in which some task was
	// stalled on memory (PSI "some" avg60). Always zero for Disk, and for
	// Memory on kernels without PSI.
	StallPercent float64 `json:"stall_percent"`
}
