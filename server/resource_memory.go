package server

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func readMemory() (resourceReading, error) {
	return readMemoryFiles("/proc/meminfo", "/proc/pressure/memory")
}

// readMemoryFiles reads MemAvailable and MemTotal from meminfo and the avg60
// stalls from the PSI file. A kernel without PSI, or one booted with psi=0,
// is judged by MemAvailable alone.
func readMemoryFiles(meminfoPath, pressurePath string) (resourceReading, error) {
	meminfo, err := os.ReadFile(meminfoPath)
	if err != nil {
		return resourceReading{}, err
	}
	kB := map[string]uint64{}
	for line := range strings.Lines(string(meminfo)) {
		key, value, _ := strings.Cut(line, ":")
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		number, ok := strings.CutSuffix(strings.TrimSpace(value), " kB")
		n, err := strconv.ParseUint(number, 10, 64)
		if !ok || err != nil {
			return resourceReading{}, fmt.Errorf("%s: bad %s line %q", meminfoPath, key, line)
		}
		kB[key] = n
	}
	if len(kB) != 2 {
		return resourceReading{}, fmt.Errorf("%s: missing MemTotal or MemAvailable", meminfoPath)
	}
	r := resourceReading{available: kB["MemAvailable"] << 10, total: kB["MemTotal"] << 10}

	pressure, err := os.ReadFile(pressurePath)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, unix.EOPNOTSUPP) {
		return r, nil
	}
	if err != nil {
		return resourceReading{}, err
	}
	// some avg10=1.48 avg60=1.28 avg300=0.45 total=478283023
	// full avg10=1.12 avg60=0.95 avg300=0.34 total=355220663
	stalls := map[string]float64{}
	for line := range strings.Lines(string(pressure)) {
		fields := strings.Fields(line)
		if len(fields) < 3 || (fields[0] != "some" && fields[0] != "full") {
			continue
		}
		avg60, ok := strings.CutPrefix(fields[2], "avg60=")
		stall, err := strconv.ParseFloat(avg60, 64)
		if !ok || err != nil {
			return resourceReading{}, fmt.Errorf("%s: bad line %q", pressurePath, line)
		}
		stalls[fields[0]] = stall
	}
	if len(stalls) != 2 {
		return resourceReading{}, fmt.Errorf("%s: missing some or full line", pressurePath)
	}
	r.someStall, r.fullStall = stalls["some"], stalls["full"]
	return r, nil
}
