package server

import "embed"

// debugAssets holds the static pages under /debug/: the index,
// /debug/conversations/, /debug/llm/, and /debug/channels/. List new debug
// pages in debug/index.html.
//
//go:embed debug
var debugAssets embed.FS
