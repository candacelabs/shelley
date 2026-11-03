package db

import (
	"os/exec"
	"syscall"
)

// dieWithParent kills the test cluster when the test binary exits.
func dieWithParent(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}
