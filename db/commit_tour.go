package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"shelley.exe.dev/db/generated"
)

const CommitTourKind = "commit-tour"

var ErrCommitTourWorkerInvalid = errors.New("invalid commit tour worker")

func ManagedCommitTourRequest(conversation generated.Conversation) (*CommitTourRequest, bool) {
	if conversation.ParentConversationID == nil || conversation.UserInitiated {
		return nil, false
	}
	opts := ParseConversationOptions(conversation.ConversationOptions)
	request := opts.CommitTour
	if opts.Kind != CommitTourKind || request == nil || !filepath.IsAbs(request.Repository) || !filepath.IsAbs(request.Worktree) || !validCommitTourID(request.Commit) {
		return nil, false
	}
	switch request.State {
	case "building", "complete", "failed":
		return request, true
	default:
		return nil, false
	}
}

func validCommitTourID(hash string) bool {
	if len(hash) < 40 || len(hash) > 64 {
		return false
	}
	for _, c := range hash {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// CreateCommitTourWorker atomically creates a specialized subagent conversation
// whose options durably identify the commit-tour request.
func (db *DB) CreateCommitTourWorker(ctx context.Context, parentID, worktree, model string, opts ConversationOptions) (*generated.Conversation, error) {
	if opts.Kind == "" || opts.CommitTour == nil || opts.CommitTour.Commit == "" {
		return nil, ErrCommitTourWorkerInvalid
	}
	conversationID, err := GenerateConversationID()
	if err != nil {
		return nil, fmt.Errorf("generate commit tour worker id: %w", err)
	}
	shortHash := opts.CommitTour.Commit
	if len(shortHash) > 7 {
		shortHash = shortHash[:7]
	}
	slug := fmt.Sprintf("tour-%s-%s", strings.ToLower(shortHash), strings.ToLower(conversationID))
	optsJSON, err := json.Marshal(opts)
	if err != nil {
		return nil, fmt.Errorf("marshal commit tour worker options: %w", err)
	}

	var conversation generated.Conversation
	err = db.pool.Tx(ctx, func(ctx context.Context, tx *Tx) error {
		q := generated.New(tx.Conn())
		conversation, err = q.CreateSubagentConversation(ctx, generated.CreateSubagentConversationParams{
			ConversationID:       conversationID,
			Slug:                 &slug,
			Cwd:                  &worktree,
			ParentConversationID: &parentID,
		})
		if err != nil {
			return err
		}
		if err := q.UpdateConversationOptions(ctx, generated.UpdateConversationOptionsParams{
			ConversationID:      conversationID,
			ConversationOptions: string(optsJSON),
		}); err != nil {
			return err
		}
		if model != "" {
			if err := q.UpdateConversationModel(ctx, generated.UpdateConversationModelParams{
				ConversationID: conversationID,
				Model:          &model,
			}); err != nil {
				return err
			}
			conversation.Model = &model
		}
		conversation.ConversationOptions = string(optsJSON)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

// UpdateCommitTourWorker mutates a worker's durable status while preserving
// unrelated child options.
func (db *DB) UpdateCommitTourWorker(ctx context.Context, conversationID string, update func(*CommitTourRequest)) (*generated.Conversation, error) {
	var conversation generated.Conversation
	err := db.pool.Tx(ctx, func(ctx context.Context, tx *Tx) error {
		q := generated.New(tx.Conn())
		var err error
		conversation, err = q.GetConversation(ctx, conversationID)
		if err != nil {
			return err
		}
		opts := ParseConversationOptions(conversation.ConversationOptions)
		if opts.CommitTour == nil {
			return ErrCommitTourWorkerInvalid
		}
		update(opts.CommitTour)
		optsJSON, err := json.Marshal(opts)
		if err != nil {
			return fmt.Errorf("marshal commit tour worker options: %w", err)
		}
		if err := q.UpdateConversationOptions(ctx, generated.UpdateConversationOptionsParams{
			ConversationID:      conversationID,
			ConversationOptions: string(optsJSON),
		}); err != nil {
			return err
		}
		conversation.ConversationOptions = string(optsJSON)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &conversation, nil
}

func (db *DB) ListCommitTourWorkers(ctx context.Context) ([]generated.Conversation, error) {
	var conversations []generated.Conversation
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		var err error
		conversations, err = generated.New(rx.Conn()).ListCommitTourWorkers(ctx)
		return err
	})
	return conversations, err
}
