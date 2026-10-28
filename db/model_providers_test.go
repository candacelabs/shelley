package db

import (
	"database/sql"
	"errors"
	"reflect"
	"testing"
)

func TestModelProviderSnapshotAndVersion(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	ctx := t.Context()
	initial := ModelProvider{
		ProviderID: "account", ProviderType: "openai", Endpoint: "https://api.example/v1",
		APIKey: "secret", DisplayName: "Account",
		Models: []ProviderModel{{ID: "gpt-5.6-sol", Name: "Sol"}, {ID: "gpt-5.5"}},
	}
	if err := database.CreateModelProvider(ctx, initial); err != nil {
		t.Fatal(err)
	}
	got, err := database.GetModelProvider(ctx, "account")
	if err != nil || got.Version != 1 || !reflect.DeepEqual(got.Models, initial.Models) || got.APIKey != "secret" {
		t.Fatalf("created provider: %+v, %v", got, err)
	}
	initial.APIKey = "rotated"
	initial.Models = []ProviderModel{{ID: "gpt-6.1-sol"}}
	if err := database.UpdateModelProvider(ctx, initial, 1); err != nil {
		t.Fatal(err)
	}
	got, err = database.GetModelProvider(ctx, "account")
	if err != nil || got.Version != 2 || got.APIKey != "rotated" || !reflect.DeepEqual(got.Models, initial.Models) {
		t.Fatalf("updated provider: %+v, %v", got, err)
	}
	if err := database.UpdateModelProvider(ctx, ModelProvider{ProviderID: "account", APIKey: "stale"}, 1); !errors.Is(err, ErrProviderConflict) {
		t.Fatalf("stale update: %v", err)
	}
	got, err = database.GetModelProvider(ctx, "account")
	if err != nil || got.Version != 2 || got.APIKey != "rotated" {
		t.Fatalf("stale write changed row: %+v, %v", got, err)
	}
	rows, err := database.GetModelProviders(ctx)
	if err != nil || len(rows) != 1 || !reflect.DeepEqual(rows[0].Models, initial.Models) {
		t.Fatalf("list: %+v, %v", rows, err)
	}
	if err := database.DeleteModelProvider(ctx, "account"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.GetModelProvider(ctx, "account"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("get deleted: %v", err)
	}
	if err := database.DeleteModelProvider(ctx, "account"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("delete missing: %v", err)
	}
	if err := database.UpdateModelProvider(ctx, initial, 2); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("update missing: %v", err)
	}
}
