package claudetool

import (
	"context"
	"errors"
	"testing"
)

var (
	errRefusalSandbox = errors.New("the conversation's sandbox did not open")
	errRefusalVM      = errors.New("the VM's own preparation")
)

// refusalVM is a conversation's VM whose preparation fails with its own
// error, so a patch aimed at it shows it got past the host's refusal.
type refusalVM struct{}

func (refusalVM) Name() string                       { return "project-vm" }
func (refusalVM) Dir() string                        { return "/home/exedev/project" }
func (refusalVM) Prepare(context.Context) error      { return errRefusalVM }
func (refusalVM) Command(string, ...string) []string { return nil }

// A sandbox that failed to open confines this host's files only: a patch
// aimed at the conversation's VM never touches the host, so the refusal
// does not apply to it.
func TestPatchRefusalGuardsOnlyThisHost(t *testing.T) {
	tool := &PatchTool{VM: refusalVM{}, Refusal: errRefusalSandbox}
	onVM, onHost := refusalVM{}.Name(), Localhost

	out := tool.runInput(context.Background(), PatchInput{Path: "main.go", SSHTarget: &onVM})
	if !errors.Is(out.Error, errRefusalVM) {
		t.Fatalf("a patch aimed at the VM: got %v, want the VM's own error %v", out.Error, errRefusalVM)
	}
	out = tool.runInput(context.Background(), PatchInput{Path: "main.go", SSHTarget: &onHost})
	if !errors.Is(out.Error, errRefusalSandbox) {
		t.Fatalf("a patch aimed at this host: got %v, want the sandbox's refusal %v", out.Error, errRefusalSandbox)
	}
}
