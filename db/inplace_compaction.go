package db

// InPlaceCompaction is the user_data of a MessageTypeInPlaceCompaction row.
// It changes how earlier messages of the same generation are presented to the
// LLM without touching those rows. Records apply in sequence order, each to the
// view produced by the records before it; within a record, trims apply first,
// then squishes, then hides.
type InPlaceCompaction struct {
	Squishes []CompactionSquish `json:"squishes,omitempty"`
	Trims    []CompactionTrim   `json:"trims,omitempty"`
	// HiddenSequenceIDs drops whole messages from the view (context nudges).
	HiddenSequenceIDs []int64 `json:"hidden_sequence_ids,omitempty"`
	// HiddenToolUseIDs drops tool calls together with their results (earlier
	// compact_in_place calls). A message left with no tool call, or with no
	// content, is dropped.
	HiddenToolUseIDs []string `json:"hidden_tool_use_ids,omitempty"`
}

// CompactionSquish replaces the context messages spanning sequence ids
// [FromSequenceID, ToSequenceID] with a single user message carrying Summary.
// The range must start and end on boundaries of the current view (it may
// enclose earlier squishes but not cut through one) and must not split a
// tool_use from its tool_result.
type CompactionSquish struct {
	FromSequenceID int64  `json:"from_sequence_id"`
	ToSequenceID   int64  `json:"to_sequence_id"`
	Summary        string `json:"summary"`
}

// CompactionTrim replaces the content of the tool result for ToolUseID, in the
// message with sequence id SequenceID, by a pointer to the original row.
type CompactionTrim struct {
	SequenceID int64  `json:"sequence_id"`
	ToolUseID  string `json:"tool_use_id"`
}
