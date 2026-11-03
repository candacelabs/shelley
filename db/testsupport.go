package db

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib" // the database/sql driver CreateSchema runs on
)

// Shelley's tests run on PostgreSQL, as Shelley does: the server named by
// TestDatabaseEnv, else a throwaway cluster started from initdb and postgres
// on PATH, one per test binary. Every migration is applied once to a
// template database, and each test gets a fresh clone of it.
const (
	// TestDatabaseEnv names a PostgreSQL server (a URL or keyword DSN of its
	// maintenance database) the tests may create databases on.
	TestDatabaseEnv = "SHELLEY_TEST_DATABASE_URL"
	testTemplate    = "shelley_test_template"
	testUser        = "shelley"
	testReadyLine   = "database system is ready to accept connections"
	testMigrateTime = 60 * time.Second
)

// ErrNoTestPostgres is a test run with no server named and no initdb on PATH.
var ErrNoTestPostgres = errors.New("db: tests need PostgreSQL: set " + TestDatabaseEnv + " or put initdb and postgres on PATH")

type testTB interface {
	Helper()
	Fatalf(format string, args ...any)
	TempDir() string
}

// testServer is the one PostgreSQL server of a test binary.
type testServer struct {
	once     sync.Once
	err      error
	admin    string // DSN of its maintenance database
	dsn      func(database string) string
	sequence atomic.Int64
}

var testPostgres testServer

// NewTestDB creates a fresh migrated test database, cloned from the template.
func NewTestDB(tb testTB) (*DB, func()) {
	tb.Helper()
	testPostgres.once.Do(func() { testPostgres.err = testPostgres.start() })
	if testPostgres.err != nil {
		tb.Fatalf("Failed to prepare the test database server: %v", testPostgres.err)
	}
	ctx := context.Background()
	name := fmt.Sprintf("shelley_test_%d_%d", os.Getpid(), testPostgres.sequence.Add(1))
	admin, err := pgx.Connect(ctx, testPostgres.admin)
	if err != nil {
		tb.Fatalf("Failed to reach the test database server: %v", err)
	}
	defer admin.Close(ctx)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name+" TEMPLATE "+testTemplate); err != nil {
		tb.Fatalf("Failed to clone the test database template: %v", err)
	}
	database, err := New(Config{DSN: testPostgres.dsn(name), Dir: tb.TempDir()})
	if err != nil {
		tb.Fatalf("Failed to open the test database: %v", err)
	}
	return database, func() {
		_ = database.Close()
	}
}

// start finds or starts the server and migrates the template.
func (server *testServer) start() error {
	if named := os.Getenv(TestDatabaseEnv); named != "" {
		if _, err := pgx.ParseConfig(named); err != nil {
			return fmt.Errorf("%s: %w", TestDatabaseEnv, err)
		}
		server.admin = named
		server.dsn = func(database string) string { return withDatabase(named, database) }
	} else if err := server.startCluster(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), testMigrateTime)
	defer cancel()
	admin, err := pgx.Connect(ctx, server.admin)
	if err != nil {
		return err
	}
	defer admin.Close(ctx)
	if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+testTemplate); err != nil {
		return err
	}
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+testTemplate); err != nil {
		return err
	}
	// The tables first, as an embedder's migrations (or CreateSchema) make
	// them; then Migrate, as Shelley's start does.
	tables, err := sql.Open("pgx", server.dsn(testTemplate))
	if err != nil {
		return err
	}
	if err := CreateSchema(ctx, tables); err != nil {
		_ = tables.Close()
		return err
	}
	if err := tables.Close(); err != nil {
		return err
	}
	template, err := New(Config{DSN: server.dsn(testTemplate)})
	if err != nil {
		return err
	}
	if err := template.Migrate(ctx); err != nil {
		_ = template.Close()
		return fmt.Errorf("migrate the template: %w", err)
	}
	if err := template.Close(); err != nil {
		return err
	}
	// Nothing connects to the template again: every clone needs it idle.
	_, err = admin.Exec(ctx, "ALTER DATABASE "+testTemplate+" WITH ALLOW_CONNECTIONS false")
	return err
}

// withDatabase is dsn (a postgres:// URL or a keyword DSN) naming database.
func withDatabase(dsn, database string) string {
	if parsed, err := url.Parse(dsn); err == nil && (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql") {
		parsed.Path = "/" + database
		return parsed.String()
	}
	// In a keyword DSN the last dbname wins.
	return dsn + " dbname=" + database
}

// startCluster starts a throwaway cluster in a temporary directory, its
// socket there and no TCP port, killed with the test binary where the OS
// allows (testsupport_linux.go).
func (server *testServer) startCluster() error {
	initdb, err := exec.LookPath("initdb")
	if err != nil {
		return ErrNoTestPostgres
	}
	root, err := os.MkdirTemp("", "shelley-test-postgres-")
	if err != nil {
		return err
	}
	data := filepath.Join(root, "data")
	setup := exec.Command(initdb, "-D", data, "-A", "trust", "-U", testUser, "--no-sync", "-E", "UTF8")
	setup.Env = append(os.Environ(), "LC_ALL=C")
	if output, err := setup.CombinedOutput(); err != nil {
		return fmt.Errorf("initdb: %w: %s", err, output)
	}
	postgres := exec.Command(filepath.Join(filepath.Dir(initdb), "postgres"), "-D", data, "-k", root,
		"-c", "listen_addresses=", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off")
	dieWithParent(postgres)
	logs, err := postgres.StderrPipe()
	if err != nil {
		return err
	}
	if err := postgres.Start(); err != nil {
		return err
	}
	// Ready when the server says so on stderr.
	scanner := bufio.NewScanner(logs)
	ready := false
	for !ready && scanner.Scan() {
		ready = strings.Contains(scanner.Text(), testReadyLine)
	}
	if !ready {
		return errors.New("db: the test postgres exited before it accepted connections")
	}
	go func() {
		for scanner.Scan() {
		}
	}()
	server.dsn = func(database string) string {
		return fmt.Sprintf("host=%s user=%s dbname=%s sslmode=disable", root, testUser, database)
	}
	server.admin = server.dsn("postgres")
	return nil
}
