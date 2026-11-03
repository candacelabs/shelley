package db

import "testing"

func TestRebind(t *testing.T) {
	for _, c := range []struct{ name, in, want string }{
		{"no placeholders", "SELECT 1", "SELECT 1"},
		{"in order", "SELECT * FROM t WHERE a = ? AND b IN (?, ?)", "SELECT * FROM t WHERE a = $1 AND b IN ($2, $3)"},
		{"string literal", "SELECT 'why?' , ? FROM t", "SELECT 'why?' , $1 FROM t"},
		{"doubled quote", "SELECT 'it''s ?', ?", "SELECT 'it''s ?', $1"},
		{"quoted identifier", `SELECT "a?b" FROM t WHERE x = ?`, `SELECT "a?b" FROM t WHERE x = $1`},
		{"line comment", "SELECT ? -- what?\n, ?", "SELECT $1 -- what?\n, $2"},
		{"block comment", "SELECT /* ? */ ?", "SELECT /* ? */ $1"},
		{"dollar quote", "DO $body$ SELECT '?' $body$; SELECT ?", "DO $body$ SELECT '?' $body$; SELECT $1"},
		{"already numbered", "SELECT $1, $2", "SELECT $1, $2"},
		{"json path", "SELECT x->>'a?' FROM t WHERE id = ?", "SELECT x->>'a?' FROM t WHERE id = $1"},
	} {
		if got := Rebind(c.in); got != c.want {
			t.Errorf("%s: Rebind(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}
