package server

import (
	"net/http"

	"shelley.exe.dev/db"
)

// internalError logs err and sends it to the client. Shelley runs on the
// user's own machine, so the details are theirs to see.
func (s *Server) internalError(w http.ResponseWriter, msg string, err error, logArgs ...any) {
	s.logger.Error(msg, append(logArgs, "error", err)...)
	http.Error(w, msg+": "+err.Error(), s.errorStatus(err))
}

// errorStatus is 500, or 507 Insufficient Storage for a full disk so it
// reads as what it is. A full disk also raises the low-disk notice now:
// database errors already do via the pool hook, but file writes don't.
func (s *Server) errorStatus(err error) int {
	if !db.IsDiskFull(err) {
		return http.StatusInternalServerError
	}
	s.onDiskFull()
	return http.StatusInsufficientStorage
}
