package server

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"shelley.exe.dev/server/resource"
)

func TestClassifyMemory(t *testing.T) {
	t.Parallel()
	const gib = uint64(1) << 30
	for _, tc := range []struct {
		name          string
		reading       resourceReading
		active        bool
		low, critical bool
	}{
		{"healthy", resourceReading{available: 500, total: 1000, someStall: 1, fullStall: 1}, false, false, false},
		{"exactly low line", resourceReading{available: 100, total: 1000}, false, false, false},
		{"below low line", resourceReading{available: 99, total: 1000}, false, true, false},
		{"exactly half the line", resourceReading{available: 50, total: 1000}, false, true, false},
		{"below half the line", resourceReading{available: 49, total: 1000}, false, true, true},
		{"exactly stall percent", resourceReading{available: 500, total: 1000, someStall: 10, fullStall: 10}, false, false, false},
		{"some tasks stalled", resourceReading{available: 500, total: 1000, someStall: 10.01, fullStall: 9}, false, true, false},
		{"all tasks stalled", resourceReading{available: 500, total: 1000, someStall: 30, fullStall: 10.01}, false, true, true},
		// Big VMs: the line is capped, and the percentages must not overflow.
		{"large, gigabytes free", resourceReading{available: 6 * gib, total: 64 * gib}, false, false, false},
		{"large, below cap", resourceReading{available: 2*gib - 1, total: 64 * gib}, false, true, false},
		{"large, below half the cap", resourceReading{available: gib - 1, total: 64 * gib}, false, true, true},
		// An active episode ends only above 1.5 times the line and with at
		// most half the stall.
		{"active, above line", resourceReading{available: 149, total: 1000}, true, true, false},
		{"active, recovered", resourceReading{available: 150, total: 1000, someStall: 5}, true, false, false},
		{"active, still stalled", resourceReading{available: 500, total: 1000, someStall: 5.01}, true, true, false},
		{"active, below half the line", resourceReading{available: 49, total: 1000}, true, true, true},
	} {
		low, critical := classify(resource.Memory, tc.reading, tc.active)
		if low != tc.low || critical != tc.critical {
			t.Errorf("%s: low=%v critical=%v, want %v %v", tc.name, low, critical, tc.low, tc.critical)
		}
	}
}

// A monitor whose init failed is dropped; no re-check may keep it probing.
func TestFailedResourceInitLeavesNoRecheck(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		s, database, _ := newTestServer(t)
		if err := database.SetSetting(t.Context(), memorySettingKey, `{"episode_id":1,"revision":1,"active":true}`); err != nil {
			t.Fatal(err)
		}
		s.resourceRecheckEvery = resourceRecheckInterval
		var probes atomic.Int32
		probe := func() (resourceReading, error) {
			probes.Add(1)
			return resourceReading{}, errors.New("no meminfo")
		}
		if err := s.initResourceMonitor(t.Context(), resource.Memory, probe); err == nil || s.memory.Load() != nil {
			t.Fatalf("init: %v", err)
		}
		time.Sleep(10 * resourceRecheckInterval)
		synctest.Wait()
		if n := probes.Load(); n != 1 {
			t.Fatalf("probed %d times after failed init", n)
		}
	})
}

// Readings hovering around the line keep one episode, and its dismissal.
func TestMemoryHysteresis(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	memory := resourceReading{available: 99, total: 1000}
	if err := s.initResourceMonitor(t.Context(), resource.Memory, func() (resourceReading, error) { return memory, nil }); err != nil {
		t.Fatal(err)
	}
	m := s.memory.Load()
	if _, err := m.dismiss(t.Context(), 1); err != nil {
		t.Fatal(err)
	}
	for _, available := range []uint64{120, 95, 149} {
		memory.available = available
		s.refreshResources(t.Context())
		if got := m.snapshot(); !got.Active || !got.Dismissed || got.EpisodeID != 1 {
			t.Fatalf("at %d: %+v", available, got)
		}
	}
	memory.available = 150
	s.refreshResources(t.Context())
	memory.available = 120
	s.refreshResources(t.Context())
	if got := m.snapshot(); got.Active || got.EpisodeID != 1 {
		t.Fatalf("after recovery: %+v", got)
	}
}

// While a notice is active, the monitor re-checks itself once nothing else
// has sampled for resourceRecheckInterval, until recovery or shutdown.
func TestResourceRecheckWhileActive(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		s, _, _ := newTestServer(t)
		s.resourceRecheckEvery = resourceRecheckInterval
		var available atomic.Uint64
		var probes atomic.Int32
		available.Store(99)
		probe := func() (resourceReading, error) {
			probes.Add(1)
			return resourceReading{available: available.Load(), total: 1000}, nil
		}
		if err := s.initResourceMonitor(t.Context(), resource.Memory, probe); err != nil {
			t.Fatal(err)
		}
		after := func(d time.Duration, wantProbes int32) {
			t.Helper()
			time.Sleep(d)
			synctest.Wait()
			if n := probes.Load(); n != wantProbes {
				t.Fatalf("%d probes, want %d", n, wantProbes)
			}
		}
		after(resourceRecheckInterval-time.Second, 1)
		s.refreshResources(t.Context()) // pushes the re-check out
		after(2*time.Second, 2)
		after(resourceRecheckInterval, 3)
		available.Store(500)
		after(resourceRecheckInterval, 4)
		if s.memory.Load().snapshot().Active {
			t.Fatal("re-check did not clear the notice")
		}
		after(10*resourceRecheckInterval, 4)

		available.Store(99)
		s.refreshResources(t.Context())
		close(s.shutdownCh)
		after(10*resourceRecheckInterval, 5)
	})
}

const (
	testMeminfo = `MemTotal:       16370340 kB
MemFree:         1048576 kB
MemAvailable:   13074136 kB
Buffers:            1024 kB
`
	testPressure = `some avg10=1.48 avg60=12.50 avg300=0.45 total=478283023
full avg10=1.12 avg60=0.95 avg300=0.34 total=355220663
`
)

func writeTestFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadMemoryFiles(t *testing.T) {
	t.Parallel()
	meminfo := writeTestFile(t, "meminfo", testMeminfo)
	got, err := readMemoryFiles(meminfo, writeTestFile(t, "memory", testPressure))
	want := resourceReading{available: 13074136 << 10, total: 16370340 << 10, someStall: 12.5, fullStall: 0.95}
	if err != nil || got != want {
		t.Fatalf("got %+v, %v; want %+v", got, err, want)
	}
	// A kernel without PSI is judged by MemAvailable alone.
	got, err = readMemoryFiles(meminfo, filepath.Join(t.TempDir(), "missing"))
	want.someStall, want.fullStall = 0, 0
	if err != nil || got != want {
		t.Fatalf("without PSI: got %+v, %v; want %+v", got, err, want)
	}
	for _, tc := range []struct{ name, meminfo, pressure string }{
		{"no MemAvailable", "MemTotal: 100 kB\n", testPressure},
		{"bad unit", strings.Replace(testMeminfo, "13074136 kB", "13074136 MB", 1), testPressure},
		{"bad number", strings.Replace(testMeminfo, "13074136", "lots", 1), testPressure},
		{"no full line", testMeminfo, "some avg10=1.48 avg60=1.28 avg300=0.45 total=478283023\n"},
		{"bad stall", testMeminfo, strings.Replace(testPressure, "avg60=12.50", "avg60=x", 1)},
	} {
		if _, err := readMemoryFiles(writeTestFile(t, "meminfo", tc.meminfo), writeTestFile(t, "memory", tc.pressure)); err == nil {
			t.Errorf("%s: no error", tc.name)
		}
	}
	if _, err := readMemoryFiles(filepath.Join(t.TempDir(), "missing"), filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Error("missing meminfo: no error")
	}
	if runtime.GOOS == "linux" {
		if r, err := readMemory(); err != nil || r.total == 0 || r.available > r.total {
			t.Fatalf("this machine: %+v, %v", r, err)
		}
	}
}

// Memory and disk keep separate episodes: a stream gets a snapshot of each,
// in display order, and dismissing one leaves the other alone, across
// restarts too.
func TestMemoryNoticeIsIndependentOfDisk(t *testing.T) {
	t.Parallel()
	s, database, _ := newTestServer(t)
	diskAvailable := resource.DiskThreshold - 1
	initTestDiskSpace(t, s, &diskAvailable)
	memory := resourceReading{available: 40, total: 1000, someStall: 42}
	probe := func() (resourceReading, error) { return memory, nil }
	if err := s.initResourceMonitor(t.Context(), resource.Memory, probe); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()

	stream, closeStream := openResourceStream(t, httpServer.URL+"/api/stream2")
	defer closeStream()
	disk, mem := readResourceFrame(t, stream), readResourceFrame(t, stream)
	if disk.Kind != resource.Disk || !disk.Active || disk.Critical {
		t.Fatalf("disk snapshot: %+v", disk)
	}
	wantMem := resource.Status{Kind: resource.Memory, EpisodeID: 1, Revision: 1, Active: true, Critical: true, AvailableBytes: 40, TotalBytes: 1000, StallPercent: 42}
	if mem != wantMem {
		t.Fatalf("memory snapshot: %+v, want %+v", mem, wantMem)
	}

	dismissed := dismissResourceHTTP(t, mux, resource.Memory, mem.EpisodeID)
	if got := readResourceFrame(t, stream); got != dismissed || !got.Dismissed || got.Kind != resource.Memory {
		t.Fatalf("memory dismissal frame: %+v, want %+v", got, dismissed)
	}
	if got := s.diskSpace.Load().snapshot(); got != disk {
		t.Fatalf("memory dismissal changed disk: %+v", got)
	}
	// Visible notices push fresh numbers; the dismissed one stays quiet.
	diskAvailable--
	memory.someStall = 43
	s.refreshResources(t.Context())
	if got := readResourceFrame(t, stream); got.Kind != resource.Disk || got.AvailableBytes != diskAvailable {
		t.Fatalf("disk refresh frame: %+v", got)
	}
	if got := s.memory.Load().snapshot(); got.StallPercent != 43 || got.Revision != dismissed.Revision {
		t.Fatalf("memory refresh: %+v", got)
	}

	saved, err := database.GetSetting(t.Context(), memorySettingKey)
	if err != nil || !strings.Contains(saved, `"dismissed":true`) || strings.Contains(saved, "stall") {
		t.Fatalf("persisted memory episode: %s, %v", saved, err)
	}
	restarted := NewServer(database, s.llmManager, s.toolSetConfig, s.logger, true, "predictable", "")
	if err := restarted.initResourceMonitor(t.Context(), resource.Memory, probe); err != nil {
		t.Fatal(err)
	}
	if got := restarted.memory.Load().snapshot(); !got.Dismissed || got.EpisodeID != dismissed.EpisodeID {
		t.Fatalf("restart lost memory dismissal: %+v", got)
	}

	// Recovery and a fresh episode re-show it.
	memory = resourceReading{available: 500, total: 1000}
	s.refreshResources(t.Context())
	memory.available = 99
	s.refreshResources(t.Context())
	if got := s.memory.Load().snapshot(); !got.Active || got.Critical || got.Dismissed || got.EpisodeID != 2 {
		t.Fatalf("next memory episode: %+v", got)
	}
}
