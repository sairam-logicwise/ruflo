// Package schema defines the source-frontmatter types for the three DocOps
// document kinds (Context, ADR, Task) and the validators and JSON Schema
// emitters that keep them aligned with ADR-0002 (bare-minimum frontmatter).
package schema

import "regexp"

// Kind identifies which doc type a file belongs to. The filename prefix is
// the canonical ID per ADR-0003, so the kind is derivable from the name.
type Kind string

const (
	KindContext Kind = "CTX"
	KindADR     Kind = "ADR"
	KindTask    Kind = "TP"
)

// Enum values. Kept as vars so the validator and JSON Schema emitter share
// a single source of truth and cannot drift.
var (
	ADRStatuses    = []string{"draft", "accepted", "superseded"}
	ADRCoverages   = []string{"required", "not-needed"}
	TaskStatuses   = []string{"backlog", "active", "blocked", "done"}
	TaskPriorities = []string{"p0", "p1", "p2"}

	// AmendmentKinds enumerates the four allowed amendment classes per
	// ADR-0025. `editorial` and `late-binding` are non-semantic;
	// `errata` and `clarification` are semantic-adjacent but must not
	// re-decide anything (tooling enforces mechanical correlates only).
	AmendmentKinds = []string{"editorial", "errata", "clarification", "late-binding"}
)

// IDPattern is the regex every ID reference must match (ADR-0003).
const IDPattern = `^(CTX|ADR|TP)-\d+$`

// IDRegexp is the compiled form of IDPattern for runtime checks.
var IDRegexp = regexp.MustCompile(IDPattern)

// Context (CTX-*) — stakeholder inputs. Three source fields (ADR-0002).
type Context struct {
	Title      string   `yaml:"title"`
	Type       string   `yaml:"type"`
	Supersedes []string `yaml:"supersedes"`
}

// ADR (ADR-*) — architecture decision records. Seven source fields (ADR-0002).
// Plus `amendments`, an additive append-only log of post-acceptance edits
// per ADR-0025 — orthogonal to status/implementation; absence is fine.
type ADR struct {
	Title      string      `yaml:"title"`
	Status     string      `yaml:"status"`
	Coverage   string      `yaml:"coverage"`
	Date       string      `yaml:"date"`
	Supersedes []string    `yaml:"supersedes"`
	Related    []string    `yaml:"related"`
	Tags       []string    `yaml:"tags"`
	Amendments []Amendment `yaml:"amendments,omitempty"`
}

// Amendment is one post-acceptance edit to an ADR per ADR-0025. Amendments
// must not change the decision itself — only correct, clarify, or pin
// late-binding details. The hard rule is enforced socially; the validator
// enforces mechanical correlates (kind enum, ISO date, marker correspondence).
type Amendment struct {
	Date            string   `yaml:"date"`
	Kind            string   `yaml:"kind"`
	By              string   `yaml:"by"`
	Summary         string   `yaml:"summary"`
	AffectsSections []string `yaml:"affects_sections,omitempty"`
	Ref             string   `yaml:"ref,omitempty"`
}

// Task (TP-*) — work units. Six source fields (ADR-0002).
type Task struct {
	Title     string   `yaml:"title"`
	Status    string   `yaml:"status"`
	Priority  string   `yaml:"priority"`
	Assignee  string   `yaml:"assignee"`
	Requires  []string `yaml:"requires"`
	DependsOn []string `yaml:"depends_on"`
}

// KindFromFilename returns the Kind implied by a filename's ID prefix, e.g.
// "ADR-0012-foo.md" → KindADR. Returns false if the name does not start
// with a known prefix.
func KindFromFilename(name string) (Kind, bool) {
	switch {
	case len(name) > 4 && name[:4] == "CTX-":
		return KindContext, true
	case len(name) > 4 && name[:4] == "ADR-":
		return KindADR, true
	case len(name) > 3 && name[:3] == "TP-":
		return KindTask, true
	}
	return "", false
}

// KindPrefix returns the ID prefix DocOps uses for a given kind.
func (k Kind) Prefix() string {
	switch k {
	case KindContext:
		return "CTX"
	case KindADR:
		return "ADR"
	case KindTask:
		return "TP"
	}
	return ""
}
