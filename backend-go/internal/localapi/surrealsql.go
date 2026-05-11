package localapi

import (
	"sort"
	"strconv"
	"strings"
)

// surrealSelect builds a SurrealDB SELECT statement that automatically
// includes any field referenced by ORDER BY in the projection. SurrealDB
// rejects queries that order by a field absent from the projection with
// "Missing order idiom". This helper centralizes the rule so individual
// callsites can't drift back into the bug.
//
// All string contents (table names, where clauses, projection expressions)
// must already be safely escaped by the caller — this helper does not
// quote or validate.
type surrealSelect struct {
	Fields  []string
	From    string
	Where   string
	OrderBy []string
	Limit   int
}

func (q surrealSelect) String() string {
	fields := append([]string(nil), q.Fields...)
	for _, entry := range q.OrderBy {
		base := orderByLeadingField(entry)
		if base == "" || projectionContains(fields, base) {
			continue
		}
		fields = append(fields, base)
	}
	var b strings.Builder
	b.WriteString("SELECT ")
	b.WriteString(strings.Join(fields, ", "))
	b.WriteString(" FROM ")
	b.WriteString(q.From)
	if strings.TrimSpace(q.Where) != "" {
		b.WriteString(" WHERE ")
		b.WriteString(q.Where)
	}
	if len(q.OrderBy) > 0 {
		b.WriteString(" ORDER BY ")
		b.WriteString(strings.Join(q.OrderBy, ", "))
	}
	if q.Limit > 0 {
		b.WriteString(" LIMIT ")
		b.WriteString(strconv.Itoa(q.Limit))
	}
	b.WriteString(";")
	return b.String()
}

// orderByLeadingField extracts the field idiom from an ORDER BY entry such
// as "created_at" or "ft_score DESC", returning the bare field name.
func orderByLeadingField(entry string) string {
	fields := strings.Fields(entry)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

// projectionContains reports whether a projection list already supplies
// the named field. Recognizes both bare `name` projections and `expr AS name`
// aliases so the helper doesn't add a duplicate column.
func projectionContains(fields []string, target string) bool {
	for _, f := range fields {
		trimmed := strings.TrimSpace(f)
		if trimmed == target {
			return true
		}
		if idx := strings.LastIndex(strings.ToUpper(trimmed), " AS "); idx >= 0 {
			alias := strings.TrimSpace(trimmed[idx+4:])
			if alias == target {
				return true
			}
		}
	}
	return false
}

// surrealUpdate builds an UPDATE statement. Target should be a record-id
// expression (e.g. recordID("chat_messages", id)) or a table name. Set is a
// map of field name -> SurrealQL expression — the value side must already be
// safely encoded (use surrealString / recordID / etc. at the callsite).
// Where is the raw WHERE body (no leading WHERE) and is optional.
type surrealUpdate struct {
	Target string
	Set    map[string]string
	Where  string
}

func (q surrealUpdate) String() string {
	if q.Target == "" || len(q.Set) == 0 {
		// Caller bug; degrade to a syntactically invalid statement so it
		// fails fast instead of silently doing nothing.
		return "UPDATE ;"
	}
	keys := make([]string, 0, len(q.Set))
	for k := range q.Set {
		keys = append(keys, k)
	}
	sort.Strings(keys) // deterministic output for tests and tracing
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, k+" = "+q.Set[k])
	}
	var b strings.Builder
	b.WriteString("UPDATE ")
	b.WriteString(q.Target)
	b.WriteString(" SET ")
	b.WriteString(strings.Join(pairs, ", "))
	if strings.TrimSpace(q.Where) != "" {
		b.WriteString(" WHERE ")
		b.WriteString(q.Where)
	}
	b.WriteString(";")
	return b.String()
}

// surrealCreate builds a CREATE … CONTENT { … } statement. RecordID should
// be a fully-qualified record id expression (recordID("companies", "...")).
// Content values must already be SurrealQL-encoded (surrealString, etc.).
type surrealCreate struct {
	RecordID string
	Content  map[string]string
}

func (q surrealCreate) String() string {
	if q.RecordID == "" || len(q.Content) == 0 {
		return "CREATE ;"
	}
	keys := make([]string, 0, len(q.Content))
	for k := range q.Content {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, k := range keys {
		pairs = append(pairs, k+": "+q.Content[k])
	}
	var b strings.Builder
	b.WriteString("CREATE ")
	b.WriteString(q.RecordID)
	b.WriteString(" CONTENT { ")
	b.WriteString(strings.Join(pairs, ", "))
	b.WriteString(" };")
	return b.String()
}
