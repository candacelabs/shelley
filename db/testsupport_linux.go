package db

import (
	"errors"
	"os/exec"
	"syscall"
)

// dieWithParent kills the test cluster when the test binary exits.
func dieWithParent(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}

// processAlive reports whether pid runs: signal 0 probes without
// signalling, and EPERM is another user's live process.
func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
