package db

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
)

// PostgresSchema is the DDL of Shelley's store (postgres_schema.sql): every
// table, in schema Schema.
//
//go:embed postgres_schema.sql
var PostgresSchema string

// CreateSchema creates Shelley's tables in database when schema Schema has
// no conversations table yet, in one transaction; otherwise it changes
// nothing. An embedder that creates them with its own migrations (csf does)
// need not call it.
func CreateSchema(ctx context.Context, database *sql.DB) error {
	var exists bool
	if err := database.QueryRowContext(ctx, "SELECT to_regclass('"+Schema+".conversations') IS NOT NULL").Scan(&exists); err != nil {
		return fmt.Errorf("check schema %s: %w", Schema, err)
	}
	if exists {
		return nil
	}
	transaction, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if _, err := transaction.ExecContext(ctx, PostgresSchema); err != nil {
		_ = transaction.Rollback()
		return fmt.Errorf("create schema %s: %w", Schema, err)
	}
	return transaction.Commit()
}
