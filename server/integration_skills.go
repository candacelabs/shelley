package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"sync"
	"testing"
	"time"

	"shelley.exe.dev/exeenv"
	"shelley.exe.dev/skills"
)

const (
	integrationSkillAttribute    = "type:shelley-skill"
	integrationSkillMaxBytes     = 64 << 10
	integrationSkillMaxFiles     = 64
	integrationSkillFetchWorkers = 8
	// integrationSkillRefreshInterval bounds how often new conversations
	// re-discover skill integrations; integrationSkillRefreshTimeout bounds
	// how long a refresh may delay creating one.
	integrationSkillRefreshInterval = 15 * time.Second
	integrationSkillRefreshTimeout  = 3 * time.Second
)

type integrationSkillEntry struct {
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Team       bool     `json:"team,omitempty"`
	Attributes []string `json:"attributes,omitempty"`
}

// integrationSkillDiscoverer returns the current skill integrations, falling
// back per skill to the previously discovered entry.
type integrationSkillDiscoverer func(ctx context.Context, previous []skills.Skill) ([]skills.Skill, error)

// currentIntegrationSkillDiscoverer returns a discoverer for the current
// exe.dev environment, or nil elsewhere and under `go test`, which must not
// probe the real reflection endpoint.
func currentIntegrationSkillDiscoverer(logger *slog.Logger) integrationSkillDiscoverer {
	if !isExeDev() || testing.Testing() {
		return nil
	}
	env, err := exeenv.Current()
	if err != nil {
		logger.Warn("Shelley skill integration discovery: environment detection failed", "error", err)
		return nil
	}
	return func(ctx context.Context, previous []skills.Skill) ([]skills.Skill, error) {
		return discoverIntegrationSkills(ctx, http.DefaultClient, logger, env, previous)
	}
}

// integrationSkillCache re-discovers exe.dev skill integrations on demand, at
// most once per integrationSkillRefreshInterval, so integrations attached
// after startup reach new conversations. When the integration listing cannot
// be fetched, the previously discovered skills are kept; when one skill
// cannot be fetched, its previous entry is kept. Callers arriving during a
// refresh wait for it and share its result.
type integrationSkillCache struct {
	discover integrationSkillDiscoverer // nil disables discovery
	logger   *slog.Logger

	mu        sync.Mutex
	skills    []skills.Skill
	attempted time.Time
}

// newIntegrationSkillCache primes the cache so the first conversation has
// skills even if reflection is down by then.
func newIntegrationSkillCache(logger *slog.Logger, discover integrationSkillDiscoverer) *integrationSkillCache {
	c := &integrationSkillCache{discover: discover, logger: logger}
	c.Skills(context.Background())
	return c
}

// Skills returns the current skill integrations, refreshing them first when
// the last attempt is at least integrationSkillRefreshInterval old. The
// refresh is detached from ctx's cancellation because its result is shared
// with later callers.
func (c *integrationSkillCache) Skills(ctx context.Context) []skills.Skill {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now := time.Now(); c.discover != nil && now.Sub(c.attempted) >= integrationSkillRefreshInterval {
		c.attempted = now
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), integrationSkillRefreshTimeout)
		defer cancel()
		discovered, err := c.discover(ctx, c.skills)
		if err != nil {
			c.logger.Warn("Shelley skill integration discovery: refresh failed; keeping previous skills", "error", err, "skills", len(c.skills))
		} else {
			c.skills = discovered
		}
	}
	return append([]skills.Skill(nil), c.skills...)
}

// discoverIntegrationSkills fetches the SKILL.md of every attached skill
// integration. It fails only when the reflection listing cannot be fetched.
// A skill that cannot be fetched or parsed (including because ctx ended) is
// treated as if it still had its entry in previous, if any; duplicate skill
// names are skipped.
func discoverIntegrationSkills(ctx context.Context, httpc *http.Client, logger *slog.Logger, env exeenv.Environment, previous []skills.Skill) ([]skills.Skill, error) {
	var response struct {
		Integrations []integrationSkillEntry `json:"integrations"`
	}
	if err := fetchIntegrationSkillJSON(ctx, httpc, env.ReflectionURL()+"/integrations", &response); err != nil {
		return nil, fmt.Errorf("reflection fetch failed: %w", err)
	}

	type candidate struct {
		entry integrationSkillEntry
		root  string
	}
	var candidates []candidate
	for _, entry := range response.Integrations {
		if entry.Type != "file" || !slices.Contains(entry.Attributes, integrationSkillAttribute) {
			continue
		}
		if !validIntegrationSkillEntryName(entry.Name) {
			logger.Warn("Shelley skill integration discovery: malformed reflection entry", "name", entry.Name)
			continue
		}
		candidates = append(candidates, candidate{
			entry: entry,
			root:  env.IntegrationURL(entry.Name, entry.Team) + "/",
		})
		if len(candidates) == integrationSkillMaxFiles {
			logger.Warn("Shelley skill integration discovery: candidate limit reached", "limit", integrationSkillMaxFiles)
			break
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].entry.Team != candidates[j].entry.Team {
			return !candidates[i].entry.Team
		}
		return candidates[i].root < candidates[j].root
	})

	type result struct {
		skill skills.Skill
		err   error
	}
	results := make([]result, len(candidates))
	jobs := make(chan int)
	var wg sync.WaitGroup
	wg.Add(min(len(candidates), integrationSkillFetchWorkers))
	for range min(len(candidates), integrationSkillFetchWorkers) {
		go func() {
			defer wg.Done()
			for i := range jobs {
				results[i].skill, results[i].err = fetchIntegrationSkill(ctx, httpc, candidates[i].root)
			}
		}()
	}
	for i := range candidates {
		jobs <- i
	}
	close(jobs)
	wg.Wait()

	previousBySource := make(map[string]skills.Skill, len(previous))
	for _, skill := range previous {
		previousBySource[skill.Source] = skill
	}
	seen := make(map[string]bool)
	var discovered []skills.Skill
	for i, candidate := range candidates {
		skill, err := results[i].skill, results[i].err
		if err != nil {
			kept, ok := previousBySource[candidate.root]
			if !ok {
				logger.Warn("Shelley skill integration discovery: skill unavailable", "integration", candidate.entry.Name, "url", candidate.root, "error", err)
				continue
			}
			logger.Warn("Shelley skill integration discovery: skill unavailable; keeping previous", "integration", candidate.entry.Name, "url", candidate.root, "error", err)
			skill = kept
		}
		if seen[skill.Name] {
			logger.Warn("Shelley skill integration discovery: duplicate skill name; skipping", "skill", skill.Name, "integration", candidate.entry.Name, "url", candidate.root)
			continue
		}
		seen[skill.Name] = true
		discovered = append(discovered, skill)
	}
	sort.Slice(discovered, func(i, j int) bool { return discovered[i].Name < discovered[j].Name })
	return discovered, nil
}

func validIntegrationSkillEntryName(name string) bool {
	if len(name) == 0 || len(name) > 63 || name[0] == '-' || name[len(name)-1] == '-' {
		return false
	}
	for _, c := range name {
		if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' {
			continue
		}
		return false
	}
	return true
}

func fetchIntegrationSkillJSON(ctx context.Context, httpc *http.Client, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode %s: %w", url, err)
	}
	return nil
}

// fetchIntegrationSkill fetches and parses the SKILL.md served at url.
func fetchIntegrationSkill(ctx context.Context, httpc *http.Client, url string) (skills.Skill, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return skills.Skill{}, err
	}
	resp, err := httpc.Do(req)
	if err != nil {
		return skills.Skill{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return skills.Skill{}, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, integrationSkillMaxBytes+1))
	if err != nil {
		return skills.Skill{}, err
	}
	if len(body) > integrationSkillMaxBytes {
		return skills.Skill{}, fmt.Errorf("SKILL.md exceeds %d bytes", integrationSkillMaxBytes)
	}
	skill, err := skills.ParseContent(string(body))
	if err != nil {
		return skills.Skill{}, fmt.Errorf("malformed SKILL.md: %w", err)
	}
	skill.Path = ""
	skill.Body = ""
	skill.Source = url
	skill.Origin = "Integration"
	skill.Activate = "curl -s " + url
	return skill, nil
}
