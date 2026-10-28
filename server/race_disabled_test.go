//go:build !race

package server

// raceEnabled reports whether the test binary was built with -race, which
// makes CPU-heavy single-goroutine tests several times slower for nothing.
const raceEnabled = false
