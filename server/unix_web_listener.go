package server

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// maxUnixSocketPath is the longest socket path bind accepts: sun_path less
// its NUL (103 bytes on macOS, 107 on Linux).
var maxUnixSocketPath = len(syscall.RawSockaddrUnix{}.Path) - 1

// ListenWebUnix listens for the web UI on a Unix socket at path (-listen-unix),
// instead of a TCP port. The socket is mode 0600; put it in a private
// directory too, since it is briefly wider between bind and chmod.
//
// A stale socket left by a crashed server is replaced. A live one, or
// anything that isn't a socket, is an error.
func ListenWebUnix(path string) (net.Listener, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if len(path) > maxUnixSocketPath {
		return nil, fmt.Errorf("unix socket path %q is too long: %d bytes, the limit is %d", path, len(path), maxUnixSocketPath)
	}
	if fi, err := os.Lstat(path); err == nil {
		if fi.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("%s exists and is not a socket", path)
		}
		if conn, err := net.DialTimeout("unix", path, 500*time.Millisecond); err == nil {
			conn.Close()
			return nil, fmt.Errorf("unix socket %s is in use by another server", path)
		}
		if err := os.Remove(path); err != nil {
			return nil, fmt.Errorf("remove stale socket: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	ln, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	if err := os.Chmod(path, 0o600); err != nil {
		ln.Close()
		return nil, fmt.Errorf("chmod socket: %w", err)
	}
	return ln, nil
}
