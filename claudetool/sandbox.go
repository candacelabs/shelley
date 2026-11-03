package claudetool

import "context"

// Sandbox runs a conversation's commands somewhere other than this host's
// shell (csf: a sandbox per conversation). A nil Sandbox runs them here.
type Sandbox interface {
	// WorkingDir is the directory on this host the conversation's tools work
	// in: the bash tool's start, and where the file tools read and write.
	WorkingDir(ctx context.Context, conversationID string) (string, error)
	// Wrap is the shell command that runs command, in wd (a directory under
	// WorkingDir), inside the conversation's sandbox. The bash tool's job
	// wrapper still runs on this host, so output and exit status flow back.
	Wrap(conversationID string, command string, wd string) string
}
