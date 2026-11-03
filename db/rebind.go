package db

import (
	"strconv"
	"strings"
)

// Rebind turns a query's SQLite-style ? placeholders into PostgreSQL's $1,
// $2, … in order, so Shelley's hand-written queries (and upstream's) run on
// PostgreSQL unchanged. A ? inside a string literal, a quoted identifier, a
// comment or a dollar-quoted body is left as it is, and a query with no ?
// comes back as it went in.
func Rebind(query string) string {
	if !strings.Contains(query, "?") {
		return query
	}
	var out strings.Builder
	out.Grow(len(query) + 8)
	next := 1
	for i := 0; i < len(query); {
		c := query[i]
		switch {
		case c == '\'' || c == '"':
			end := closing(query, i+1, c)
			out.WriteString(query[i:end])
			i = end
		case c == '-' && i+1 < len(query) && query[i+1] == '-':
			end := strings.IndexByte(query[i:], '\n')
			if end < 0 {
				end = len(query) - i
			}
			out.WriteString(query[i : i+end])
			i += end
		case c == '/' && i+1 < len(query) && query[i+1] == '*':
			end := strings.Index(query[i+2:], "*/")
			if end < 0 {
				end = len(query) - i - 2
			} else {
				end += 2
			}
			out.WriteString(query[i : i+2+end])
			i += 2 + end
		case c == '$':
			if tag, ok := dollarTag(query[i:]); ok {
				end := strings.Index(query[i+len(tag):], tag)
				if end < 0 {
					end = len(query) - i - len(tag)
				} else {
					end += len(tag)
				}
				out.WriteString(query[i : i+len(tag)+end])
				i += len(tag) + end
				continue
			}
			out.WriteByte(c)
			i++
		case c == '?':
			out.WriteByte('$')
			out.WriteString(strconv.Itoa(next))
			next++
			i++
		default:
			out.WriteByte(c)
			i++
		}
	}
	return out.String()
}

// closing is the index just past the quote that closes one opened before
// start; a doubled quote inside is part of the text.
func closing(query string, start int, quote byte) int {
	for i := start; i < len(query); i++ {
		if query[i] != quote {
			continue
		}
		if i+1 < len(query) && query[i+1] == quote {
			i++
			continue
		}
		return i + 1
	}
	return len(query)
}

// dollarTag is the $tag$ (or $$) a dollar-quoted string opens with at the
// start of s; $1 and other placeholders are not one.
func dollarTag(s string) (string, bool) {
	for i := 1; i < len(s); i++ {
		switch c := s[i]; {
		case c == '$':
			return s[:i+1], true
		case c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || (i > 1 && c >= '0' && c <= '9'):
		default:
			return "", false
		}
	}
	return "", false
}
