package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

var ErrProviderConflict = errors.New("model provider changed")

type ProviderModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type ModelProvider struct {
	ProviderID   string
	ProviderType string
	Endpoint     string
	APIKey       string
	DisplayName  string
	Models       []ProviderModel
	Version      int64
}

const providerColumns = "provider_id, provider_type, endpoint, api_key, display_name, models, version"

func scanModelProvider(row interface{ Scan(...any) error }) (ModelProvider, error) {
	var p ModelProvider
	var raw string
	err := row.Scan(&p.ProviderID, &p.ProviderType, &p.Endpoint, &p.APIKey, &p.DisplayName, &raw, &p.Version)
	if err != nil {
		return p, err
	}
	if err := json.Unmarshal([]byte(raw), &p.Models); err != nil {
		return p, fmt.Errorf("decode provider models: %w", err)
	}
	return p, nil
}

func (db *DB) GetModelProviders(ctx context.Context) ([]ModelProvider, error) {
	providers := []ModelProvider{}
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		rows, err := rx.Query("SELECT " + providerColumns + " FROM model_providers ORDER BY rowid")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			p, err := scanModelProvider(rows)
			if err != nil {
				return err
			}
			providers = append(providers, p)
		}
		return rows.Err()
	})
	return providers, err
}

func (db *DB) GetModelProvider(ctx context.Context, id string) (*ModelProvider, error) {
	var p ModelProvider
	err := db.pool.Rx(ctx, func(ctx context.Context, rx *Rx) error {
		var err error
		p, err = scanModelProvider(rx.QueryRow("SELECT "+providerColumns+" FROM model_providers WHERE provider_id = ?", id))
		return err
	})
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (db *DB) CreateModelProvider(ctx context.Context, p ModelProvider) error {
	raw, err := json.Marshal(p.Models)
	if err != nil {
		return err
	}
	return db.pool.Tx(ctx, func(ctx context.Context, tx *Tx) error {
		_, err := tx.Exec("INSERT INTO model_providers ("+providerColumns+") VALUES (?, ?, ?, ?, ?, ?, 1)",
			p.ProviderID, p.ProviderType, p.Endpoint, p.APIKey, p.DisplayName, string(raw))
		return err
	})
}

func (db *DB) UpdateModelProvider(ctx context.Context, p ModelProvider, expectedVersion int64) error {
	raw, err := json.Marshal(p.Models)
	if err != nil {
		return err
	}
	return db.pool.Tx(ctx, func(ctx context.Context, tx *Tx) error {
		result, err := tx.Exec(`UPDATE model_providers
			SET provider_type = ?, endpoint = ?, api_key = ?, display_name = ?, models = ?, version = version + 1
			WHERE provider_id = ? AND version = ?`,
			p.ProviderType, p.Endpoint, p.APIKey, p.DisplayName, string(raw), p.ProviderID, expectedVersion)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil || n != 0 {
			return err
		}
		var found string
		err = tx.QueryRow("SELECT provider_id FROM model_providers WHERE provider_id = ?", p.ProviderID).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return sql.ErrNoRows
		}
		if err != nil {
			return err
		}
		return ErrProviderConflict
	})
}

func (db *DB) DeleteModelProvider(ctx context.Context, id string) error {
	return db.pool.Tx(ctx, func(ctx context.Context, tx *Tx) error {
		result, err := tx.Exec("DELETE FROM model_providers WHERE provider_id = ?", id)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return sql.ErrNoRows
		}
		return nil
	})
}
