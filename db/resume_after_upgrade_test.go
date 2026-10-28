package db

import (
	"context"
	"slices"
	"testing"

	"shelley.exe.dev/llm"
)

// TestConsumeResumeAfterUpgrade covers the one-shot resume flag: absent
// (ordinary restart, durable conversation bit + stale working clear), present
// (upgrade restart, flags preserved and IDs returned), and the second call
// after a consume (back to the ordinary interruption path).
func TestConsumeResumeAfterUpgrade(t *testing.T) {
	tests := []struct {
		name            string
		setFlag         bool
		consumeCall     int // number of times to call, result of the last call is asserted
		wantIDs         bool
		wantWorking     bool
		wantInterrupted bool
	}{
		{name: "flag absent marks interrupted and clears stale flags", setFlag: false, consumeCall: 1, wantInterrupted: true},
		{name: "flag present returns version tokens and preserves working state", setFlag: true, consumeCall: 1, wantIDs: true, wantWorking: true},
		{name: "second call after consume takes ordinary interruption path", setFlag: true, consumeCall: 2, wantInterrupted: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, cleanup := NewTestDB(t)
			defer cleanup()
			ctx := t.Context()

			working, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
			if err != nil {
				t.Fatalf("CreateConversation: %v", err)
			}
			idle, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
			if err != nil {
				t.Fatalf("CreateConversation: %v", err)
			}
			if err := database.SetConversationAgentWorking(ctx, working.ConversationID, true); err != nil {
				t.Fatalf("SetConversationAgentWorking: %v", err)
			}

			if tt.setFlag {
				if err := database.SetSetting(ctx, ResumeAfterUpgradeSettingKey, "1"); err != nil {
					t.Fatalf("SetSetting: %v", err)
				}
			}

			var resumes []UpgradeResume
			for range tt.consumeCall {
				resumes, err = database.ConsumeResumeAfterUpgrade(ctx)
				if err != nil {
					t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
				}
			}
			ids := make([]string, len(resumes))
			for i, resume := range resumes {
				ids[i] = resume.ConversationID
			}

			wantIDs := []string(nil)
			if tt.wantIDs {
				wantIDs = []string{working.ConversationID}
			}
			if !slices.Equal(ids, wantIDs) {
				t.Errorf("ids = %v, want %v", ids, wantIDs)
			}

			// The flag row must always be gone after a consume.
			if v, err := database.GetSetting(ctx, ResumeAfterUpgradeSettingKey); err != nil || v != "" {
				t.Errorf("flag row after consume = %q, %v; want empty", v, err)
			}

			got, err := database.GetConversationByID(ctx, working.ConversationID)
			if err != nil {
				t.Fatalf("GetConversationByID: %v", err)
			}
			if got.AgentWorking != tt.wantWorking {
				t.Errorf("agent_working = %v, want %v", got.AgentWorking, tt.wantWorking)
			}
			if got.TurnInterrupted != tt.wantInterrupted {
				t.Errorf("turn_interrupted = %v, want %v", got.TurnInterrupted, tt.wantInterrupted)
			}
			idleGot, err := database.GetConversationByID(ctx, idle.ConversationID)
			if err != nil {
				t.Fatalf("GetConversationByID: %v", err)
			}
			if idleGot.AgentWorking {
				t.Error("idle conversation should never be marked working")
			}
			if idleGot.TurnInterrupted {
				t.Error("idle conversation should never be marked interrupted")
			}

			messages, err := database.ListMessages(ctx, working.ConversationID)
			if err != nil {
				t.Fatalf("ListMessages: %v", err)
			}
			if len(messages) != 0 {
				t.Fatalf("startup recovery must not add transcript rows: %+v", messages)
			}
		})
	}
}

func markConversationInterrupted(t *testing.T, database *DB, conversationID string) {
	t.Helper()
	ctx := context.Background()
	if err := database.SetConversationAgentWorking(ctx, conversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}
	if _, err := database.ConsumeResumeAfterUpgrade(ctx); err != nil {
		t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
	}
	got, err := database.GetConversationByID(ctx, conversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if !got.TurnInterrupted || got.AgentWorking {
		t.Fatalf("interrupted setup produced interrupted=%v working=%v", got.TurnInterrupted, got.AgentWorking)
	}
}

func TestClaimInterruptedTurn(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	markConversationInterrupted(t, database, conversation.ConversationID)

	claimed, err := database.ClaimInterruptedTurn(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("ClaimInterruptedTurn: %v", err)
	}
	if !claimed {
		t.Fatal("first claim rejected")
	}
	claimed, err = database.ClaimInterruptedTurn(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("second ClaimInterruptedTurn: %v", err)
	}
	if claimed {
		t.Fatal("duplicate claim succeeded")
	}

	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if got.TurnInterrupted || !got.AgentWorking {
		t.Fatalf("claimed conversation interrupted=%v working=%v, want false/true", got.TurnInterrupted, got.AgentWorking)
	}
}

func TestClaimUpgradeInterruptedTurn(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}
	if err := database.SetSetting(ctx, ResumeAfterUpgradeSettingKey, "1"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	resumes, err := database.ConsumeResumeAfterUpgrade(ctx)
	if err != nil {
		t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
	}
	if len(resumes) != 1 || resumes[0].ConversationID != conversation.ConversationID {
		t.Fatalf("resumes = %v, want token for %s", resumes, conversation.ConversationID)
	}

	claimed, err := database.ClaimUpgradeInterruptedTurn(ctx, resumes[0])
	if err != nil {
		t.Fatalf("ClaimUpgradeInterruptedTurn: %v", err)
	}
	if !claimed {
		t.Fatal("first claim rejected")
	}
	claimed, err = database.ClaimUpgradeInterruptedTurn(ctx, resumes[0])
	if err != nil {
		t.Fatalf("second ClaimUpgradeInterruptedTurn: %v", err)
	}
	if claimed {
		t.Fatal("duplicate claim succeeded")
	}

	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if !got.TurnInterrupted || !got.AgentWorking {
		t.Fatalf("claimed conversation interrupted=%v working=%v, want true/true", got.TurnInterrupted, got.AgentWorking)
	}
	finished, err := database.FinishUpgradeInterruptedTurn(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("FinishUpgradeInterruptedTurn: %v", err)
	}
	if !finished {
		t.Fatal("finishing claim failed")
	}
	got, err = database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID after finish: %v", err)
	}
	if got.TurnInterrupted || !got.AgentWorking {
		t.Fatalf("finished conversation interrupted=%v working=%v, want false/true", got.TurnInterrupted, got.AgentWorking)
	}
}

func TestConsumeResumeAfterUpgradeRearmsClaimedTurn(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := t.Context()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}
	if err := database.SetSetting(ctx, ResumeAfterUpgradeSettingKey, "1"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	resumes, err := database.ConsumeResumeAfterUpgrade(ctx)
	if err != nil || len(resumes) != 1 {
		t.Fatalf("first ConsumeResumeAfterUpgrade = %v, %v", resumes, err)
	}
	claimed, err := database.ClaimUpgradeInterruptedTurn(ctx, resumes[0])
	if err != nil || !claimed {
		t.Fatalf("first ClaimUpgradeInterruptedTurn = %v, %v", claimed, err)
	}

	// Simulate another upgrade restart after the worker claimed the turn but
	// before it finished preparing Retry().
	if err := database.SetSetting(ctx, ResumeAfterUpgradeSettingKey, "1"); err != nil {
		t.Fatalf("SetSetting again: %v", err)
	}
	resumes, err = database.ConsumeResumeAfterUpgrade(ctx)
	if err != nil || len(resumes) != 1 {
		t.Fatalf("second ConsumeResumeAfterUpgrade = %v, %v", resumes, err)
	}
	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if !got.AgentWorking || got.TurnInterrupted {
		t.Fatalf("rearmed state working=%v interrupted=%v, want true/false", got.AgentWorking, got.TurnInterrupted)
	}
	claimed, err = database.ClaimUpgradeInterruptedTurn(ctx, resumes[0])
	if err != nil || !claimed {
		t.Fatalf("second ClaimUpgradeInterruptedTurn = %v, %v", claimed, err)
	}
}

func TestStartingNewTurnClearsInterruptedBit(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	markConversationInterrupted(t, database, conversation.ConversationID)
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}

	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if got.TurnInterrupted {
		t.Fatal("starting a new turn did not resolve the prior interruption")
	}
}

func TestCleanCancellationIsNotMarkedInterrupted(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, true); err != nil {
		t.Fatalf("start working: %v", err)
	}
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, false); err != nil {
		t.Fatalf("cancel working: %v", err)
	}
	if _, err := database.ConsumeResumeAfterUpgrade(ctx); err != nil {
		t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
	}

	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if got.TurnInterrupted {
		t.Fatal("cleanly cancelled conversation was marked interrupted")
	}
}

func TestBookkeepingMessageDoesNotClearInterruptedBit(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	markConversationInterrupted(t, database, conversation.ConversationID)
	if _, err := database.CreateMessage(ctx, CreateMessageParams{
		ConversationID: conversation.ConversationID,
		Type:           MessageTypeGitInfo,
		LLMData:        llm.UserStringMessage("git status changed"),
	}); err != nil {
		t.Fatalf("Create git-info message: %v", err)
	}

	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if !got.TurnInterrupted {
		t.Fatal("bookkeeping message cleared interrupted bit")
	}
}

func TestConsumeResumeAfterUpgradeDoesNotMarkManagedChildren(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	parent, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("Create parent: %v", err)
	}
	child, err := database.CreateConversation(ctx, nil, false, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("Create child: %v", err)
	}
	if _, err := database.UpdateConversationParent(ctx, child.ConversationID, parent.ConversationID); err != nil {
		t.Fatalf("UpdateConversationParent: %v", err)
	}
	if err := database.SetConversationAgentWorking(ctx, child.ConversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}

	if _, err := database.ConsumeResumeAfterUpgrade(ctx); err != nil {
		t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
	}
	messages, err := database.ListMessages(ctx, child.ConversationID)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("managed child received a startup transcript row: %+v", messages)
	}
	got, err := database.GetConversationByID(ctx, child.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if got.AgentWorking {
		t.Fatal("managed child's stale working flag was not cleared")
	}
	if got.TurnInterrupted {
		t.Fatal("managed child should not get a top-level interruption bit")
	}
}

func TestConsumeResumeAfterUpgradeDoesNotMarkCompletedAgentTurn(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := context.Background()

	conversation, err := database.CreateConversation(ctx, nil, true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	if _, err := database.CreateMessage(ctx, CreateMessageParams{
		ConversationID: conversation.ConversationID,
		Type:           MessageTypeAgent,
		LLMData: llm.Message{
			Role:      llm.MessageRoleAssistant,
			Content:   []llm.Content{{Type: llm.ContentTypeText, Text: "already done"}},
			EndOfTurn: true,
		},
	}); err != nil {
		t.Fatalf("CreateMessage: %v", err)
	}
	if _, err := database.CreateMessage(ctx, CreateMessageParams{
		ConversationID: conversation.ConversationID,
		Type:           MessageTypeUser,
		LLMData:        llm.UserStringMessage("changed cwd"),
		UserData:       map[string]any{"cwd_change": true, "to": "/tmp"},
	}); err != nil {
		t.Fatalf("Create cwd-change message: %v", err)
	}
	// Simulate a legacy stale bit from before end-of-turn inserts cleared it
	// atomically. Current code cannot produce this state.
	if err := database.SetConversationAgentWorking(ctx, conversation.ConversationID, true); err != nil {
		t.Fatalf("SetConversationAgentWorking: %v", err)
	}

	if _, err := database.ConsumeResumeAfterUpgrade(ctx); err != nil {
		t.Fatalf("ConsumeResumeAfterUpgrade: %v", err)
	}
	messages, err := database.ListMessages(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("completed turn received a startup transcript row: %+v", messages)
	}
	got, err := database.GetConversationByID(ctx, conversation.ConversationID)
	if err != nil {
		t.Fatalf("GetConversationByID: %v", err)
	}
	if got.AgentWorking {
		t.Fatal("legacy stale working flag was not cleared")
	}
	if got.TurnInterrupted {
		t.Fatal("completed turn was marked interrupted")
	}
}
