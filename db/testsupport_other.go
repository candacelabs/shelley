//go:build !linux

package db

import "os/exec"

// dieWithParent has no portable form off Linux: the cluster ends with its
// temporary directory's owner, and a long-lived one is TestDatabaseEnv's job.
func dieWithParent(*exec.Cmd) {}

// processAlive is true off Linux: without a portable probe, a cluster is
// never swept from under a running binary.
func processAlive(int) bool { return true }
