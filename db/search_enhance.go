package db

import (
	"context"

	"shelley.exe.dev/db/generated"
)

func (db *DB) SearchEnhancementModel(ctx context.Context, email string) (string, error) {
	var model string
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) (err error) {
		model, err = generated.New(rx.Conn()).GetSearchEnhancementModel(ctx, email)
		return err
	})
	return model, err
}

type SearchMessageContext struct {
	HitID, MessageID, Speaker, Text string
	Distance                        int
}

func (db *DB) SearchMessageContext(ctx context.Context, ids []string) ([]SearchMessageContext, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var result []SearchMessageContext
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		rows, err := generated.New(rx.Conn()).ListSearchMessageContext(ctx, ids)
		if err != nil {
			return err
		}
		for _, row := range rows {
			result = append(result, SearchMessageContext{HitID: row.HitID, MessageID: row.MessageID, Speaker: row.Type, Distance: int(row.Distance), Text: row.Text})
		}
		return nil
	})
	return result, err
}
