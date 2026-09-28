// Package validator orchestrates per-document schema checks and the
// cross-document graph invariants that make `docops validate` a
// useful pre-commit gate (ADR-0004, ADR-0006).
package validator

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/logicwind/docops/internal/config"
	"github.com/logicwind/docops/internal/loader"
	"github.com/logicwind/docops/internal/schema"
)

// Severity matches the config.Severity triple; duplicated here to avoid a
// package cycle when callers only depend on validator.
type Severity string

const (
	SeverityError Severity = "error"
	SeverityWarn  Severity = "warn"
)

// Finding is one problem (or warning) discovered during validation.
type Finding struct {
	Severity Severity `json:"severity"`
	Path     string   `json:"path,omitempty"`
	ID       string   `json:"id,omitempty"`
	Field    string   `json:"field,omitempty"`
	Rule     string   `json:"rule"`
	Message  string   `json:"message"`
}

// Report is the result of Validate — split into errors and warnings so
// callers can decide exit codes and rendering without re-sorting.
type Report struct {
	Files    []string  `json:"files"`
	Errors   []Finding `json:"errors"`
	Warnings []Finding `json:"warnings"`
}

// OK reports whether the run found no errors. Warnings do not break OK.
func (r Report) OK() bool { return len(r.Errors) == 0 }

// Validate runs all schema and graph checks against the loaded DocSet and
// returns a deterministic Report. Rules that are configurable via
// docops.yaml gaps: consult cfg.Gaps.
func Validate(set *loader.DocSet, cfg config.Config) Report {
	r := Report{}
	r.Files = make([]string, 0, len(set.Order))
	for _, id := range set.Order {
		r.Files = append(r.Files, set.Docs[id].Path)
	}

	schemaCfg := schema.Config{ContextTypes: cfg.ContextTypes}

	// Pass 1: per-doc schema validation.
	for _, id := range set.Order {
		doc := set.Docs[id]

		if doc.ParseErr != nil {
			r.Errors = append(r.Errors, Finding{
				Severity: SeverityError,
				Path:     doc.Path,
				ID:       doc.ID,
				Rule:     "frontmatter-parse",
				Message:  doc.ParseErr.Error(),
			})
			continue
		}

		var err error
		switch doc.Kind {
		case schema.KindContext:
			err = schema.ValidateContext(*doc.Context, schemaCfg)
		case schema.KindADR:
			err = schema.ValidateADR(*doc.ADR)
		case schema.KindTask:
			err = schema.ValidateTask(*doc.Task)
		}
		for _, fe := range explodeSchemaErrors(err) {
			r.Errors = append(r.Errors, Finding{
				Severity: SeverityError,
				Path:     doc.Path,
				ID:       doc.ID,
				Field:    fe.Field,
				Rule:     "schema",
				Message:  fe.Message,
			})
		}

		// Amendment marker correlation (ADR-0025) — needs body access.
		// Demoted to warnings on superseded ADRs (editorial fixes on
		// archived decisions are allowed).
		if doc.Kind == schema.KindADR && doc.ADR != nil {
			markerErrs := schema.ValidateAmendmentMarkers(doc.ADR.Amendments, doc.Body)
			sev := SeverityError
			if doc.ADR.Status == "superseded" {
				sev = SeverityWarn
			}
			for _, fe := range markerErrs {
				f := Finding{
					Severity: sev,
					Path:     doc.Path,
					ID:       doc.ID,
					Field:    fe.Field,
					Rule:     "amendment-markers",
					Message:  fe.Message,
				}
				if sev == SeverityWarn {
					r.Warnings = append(r.Warnings, f)
				} else {
					r.Errors = append(r.Errors, f)
				}
			}
		}
	}

	// Pass 2: reference resolution — every ID in every edge field must
	// point to a doc in the set.
	for _, id := range set.Order {
		doc := set.Docs[id]
		if doc.ParseErr != nil {
			continue
		}
		for _, edge := range docEdges(doc) {
			for i, ref := range edge.refs {
				if set.Has(ref) {
					continue
				}
				r.Errors = append(r.Errors, Finding{
					Severity: SeverityError,
					Path:     doc.Path,
					ID:       doc.ID,
					Field:    fmt.Sprintf("%s[%d]", edge.field, i),
					Rule:     "reference-unresolved",
					Message:  fmt.Sprintf("%q does not exist in this project", ref),
				})
			}
		}
	}

	// Pass 3: cycle detection on supersedes and depends_on.
	for _, cycle := range detectCycles(set, func(d *loader.Doc) []string { return d.Supersedes() }) {
		r.Errors = append(r.Errors, Finding{
			Severity: SeverityError,
			ID:       cycle[0],
			Path:     set.Docs[cycle[0]].Path,
			Field:    "supersedes",
			Rule:     "cycle",
			Message:  "cycle detected: " + strings.Join(cycle, " → "),
		})
	}
	for _, cycle := range detectCycles(set, func(d *loader.Doc) []string { return d.DependsOn() }) {
		r.Errors = append(r.Errors, Finding{
			Severity: SeverityError,
			ID:       cycle[0],
			Path:     set.Docs[cycle[0]].Path,
			Field:    "depends_on",
			Rule:     "cycle",
			Message:  "cycle detected: " + strings.Join(cycle, " → "),
		})
	}

	// Pass 4: citing a superseded doc. Severity is per-kind per config.
	for _, id := range set.Order {
		doc := set.Docs[id]
		if doc.ParseErr != nil {
			continue
		}
		// Only Tasks citing superseded CTX/ADR in `requires:` is wired
		// to config today. Other cases could follow the same pattern.
		if doc.Kind != schema.KindTask {
			continue
		}
		for i, ref := range doc.Requires() {
			target := set.Get(ref)
			if target == nil {
				continue // already reported in pass 2
			}
			if target.Status() != "superseded" {
				continue
			}
			sev := warnOrError(cfg, target.Kind)
			if sev == "" {
				continue // "off" — skip
			}
			finding := Finding{
				Severity: Severity(sev),
				Path:     doc.Path,
				ID:       doc.ID,
				Field:    fmt.Sprintf("requires[%d]", i),
				Rule:     "citation-superseded",
				Message:  fmt.Sprintf("cites superseded %s %s", target.Kind.Prefix(), target.ID),
			}
			if sev == SeverityError {
				r.Errors = append(r.Errors, finding)
			} else {
				r.Warnings = append(r.Warnings, finding)
			}
		}
	}

	sortFindings(r.Errors)
	sortFindings(r.Warnings)
	return r
}

// edgeList names an edge kind so findings can cite which field failed.
type edgeList struct {
	field string
	refs  []string
}

func docEdges(d *loader.Doc) []edgeList {
	return []edgeList{
		{"supersedes", d.Supersedes()},
		{"related", d.Related()},
		{"requires", d.Requires()},
		{"depends_on", d.DependsOn()},
	}
}

// explodeSchemaErrors turns a schema.ValidationErrors / single error into
// a slice of FieldError-like values.
func explodeSchemaErrors(err error) []schema.FieldError {
	if err == nil {
		return nil
	}
	var ve schema.ValidationErrors
	if errors.As(err, &ve) {
		return ve
	}
	// Single non-typed error — surface its message under a blank field.
	return []schema.FieldError{{Message: err.Error()}}
}

// detectCycles runs per-component DFS over the graph defined by edgesFn.
// Returned cycles are lists of IDs in traversal order with the repeated
// ID appended to close the loop.
func detectCycles(set *loader.DocSet, edgesFn func(*loader.Doc) []string) [][]string {
	const (
		unvisited = 0
		onStack   = 1
		done      = 2
	)
	colour := make(map[string]int, len(set.Docs))
	var cycles [][]string
	var seen = map[string]bool{} // deduplicate cycles by their sorted rotation

	var visit func(id string, stack []string)
	visit = func(id string, stack []string) {
		colour[id] = onStack
		stack = append(stack, id)
		doc := set.Get(id)
		if doc != nil {
			for _, next := range edgesFn(doc) {
				switch colour[next] {
				case unvisited:
					if set.Has(next) {
						visit(next, stack)
					}
				case onStack:
					// Slice the cycle from its first occurrence.
					for i, s := range stack {
						if s == next {
							cyc := append([]string{}, stack[i:]...)
							cyc = append(cyc, next)
							key := cycleKey(cyc)
							if !seen[key] {
								seen[key] = true
								cycles = append(cycles, cyc)
							}
							break
						}
					}
				}
			}
		}
		colour[id] = done
	}

	// Walk in deterministic order.
	for _, id := range set.Order {
		if colour[id] == unvisited {
			visit(id, nil)
		}
	}
	return cycles
}

// cycleKey produces a canonical string for dedup regardless of rotation.
func cycleKey(cyc []string) string {
	// Drop the duplicated closing element, find lexicographically smallest rotation.
	if len(cyc) < 2 {
		return strings.Join(cyc, "→")
	}
	ring := cyc[:len(cyc)-1]
	best := strings.Join(ring, "→")
	for i := 1; i < len(ring); i++ {
		rot := append([]string{}, ring[i:]...)
		rot = append(rot, ring[:i]...)
		s := strings.Join(rot, "→")
		if s < best {
			best = s
		}
	}
	return best
}

// warnOrError maps the target doc kind to the configured severity.
func warnOrError(cfg config.Config, kind schema.Kind) Severity {
	var s config.Severity
	switch kind {
	case schema.KindADR:
		s = cfg.Gaps.TaskRequiresSupersededAdr
	case schema.KindContext:
		s = cfg.Gaps.TaskRequiresSupersededCtx
	}
	s = s.Normalise(config.SeverityWarn)
	switch s {
	case config.SeverityError:
		return SeverityError
	case config.SeverityWarn:
		return SeverityWarn
	case config.SeverityOff:
		return ""
	}
	return SeverityWarn
}

// sortFindings orders findings so output is stable across runs.
func sortFindings(fs []Finding) {
	sort.SliceStable(fs, func(i, j int) bool {
		if fs[i].Path != fs[j].Path {
			return fs[i].Path < fs[j].Path
		}
		if fs[i].Rule != fs[j].Rule {
			return fs[i].Rule < fs[j].Rule
		}
		return fs[i].Field < fs[j].Field
	})
}
