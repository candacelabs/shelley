package server

import "shelley.exe.dev/featureflags"

// FlagPerformanceHUD overlays a small heads-up display in the web UI showing
// live counters of hot reactive recomputations (message coalescing, render
// model rebuilds, markdown parses, scroll/resize handler fires, store
// notifications, ...). The counters themselves are always collected — they
// are plain Map increments, cheap enough to leave on — and are accessible
// from the browser console via window.__shelleyPerf regardless of the flag.
// The flag only controls whether the HUD overlay renders.
var FlagPerformanceHUD = featureflags.Register(featureflags.Flag{
	Name:        "performance-hud",
	Description: "Show a heads-up display of UI recomputation counters (also available via __shelleyPerf in the console).",
	Default:     false,
})
