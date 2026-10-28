package db

import (
	"errors"
	"syscall"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// IsDiskFull reports whether err means SQLite or the OS ran out of disk space
// (or quota).
func IsDiskFull(err error) bool {
	var se *sqlite.Error
	if errors.As(err, &se) && se.Code()&0xff == sqlite3.SQLITE_FULL {
		return true
	}
	return errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EDQUOT)
}
