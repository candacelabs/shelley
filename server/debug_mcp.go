package server

import (
	_ "embed"
	"html/template"
	"maps"
	"net/http"
	"slices"
	"time"

	"shelley.exe.dev/db/generated"
	"shelley.exe.dev/mcp"
)

var (
	//go:embed debug_mcp.html
	debugMCPHTML string
	//go:embed debug_mcp.css
	debugMCPCSS string

	debugMCPTemplate = template.Must(template.New("debug_mcp").Funcs(template.FuncMap{
		"ago":   func(t time.Time) string { return time.Since(t).Round(time.Second).String() },
		"clock": func(t time.Time) string { return t.Format("2006-01-02 15:04:05") },
	}).Parse(debugMCPHTML))
)

// handleDebugMCP shows the MCP servers, sessions and recent events.
func (s *Server) handleDebugMCP(w http.ResponseWriter, r *http.Request) {
	var rows []generated.McpServer
	err := s.db.Queries(r.Context(), func(q *generated.Queries) (err error) {
		rows, err = q.ListMCPServers(r.Context())
		return err
	})
	type server struct {
		mcp.Server
		HeaderNames []string
		Login       mcp.LoginState
	}
	var servers []server
	for _, row := range rows {
		if err != nil {
			break
		}
		var v server
		if v.Server, err = mcpServerFromRow(row); err == nil {
			v.HeaderNames = slices.Sorted(maps.Keys(v.Headers))
			v.Login, err = s.mcp.LoginState(r.Context(), v.Server)
		}
		servers = append(servers, v)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	setLoginHeaders(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	err = debugMCPTemplate.Execute(w, map[string]any{
		"Servers":  servers,
		"Snapshot": s.mcp.Snapshot(),
		"CSS":      template.CSS(debugMCPCSS),
	})
	if err != nil {
		s.logger.Error("rendering /debug/mcp", "error", err)
	}
}
