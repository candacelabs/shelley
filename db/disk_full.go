package db

import (
	"errors"
	"syscall"

	"github.com/jackc/pgx/v5/pgconn"
)

// sqlStateDiskFull is PostgreSQL's disk_full error (class 53, insufficient
// resources).
const sqlStateDiskFull = "53100"

// IsDiskFull reports whether err means PostgreSQL or the OS ran out of disk
// space (or quota).
func IsDiskFull(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == sqlStateDiskFull {
		return true
	}
	return errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EDQUOT)
}
