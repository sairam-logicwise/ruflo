package schema

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// AmendmentMarkerRe matches the inline body marker `[AMENDED YYYY-MM-DD kind]`
// that ADR-0025 places next to amended prose. Capture groups: 1=date, 2=kind.
var AmendmentMarkerRe = regexp.MustCompile(`\[AMENDED (\d{4}-\d{2}-\d{2}) (editorial|errata|clarification|late-binding)\]`)

// Config carries project-level inputs the validator needs but cannot hard-code.
// Today that is just the set of allowed CTX `type` values (from docops.yaml).
type Config struct {
	ContextTypes []string
}

// FieldError describes a single validation failure on a specific field.
type FieldError struct {
	Field   string
	Message string
}

func (e FieldError) Error() string { return fmt.Sprintf("%s: %s", e.Field, e.Message) }

// ValidationErrors is the batch-style error returned by Validate*: callers
// see every problem at once rather than fixing them one at a time.
type ValidationErrors []FieldError

func (es ValidationErrors) Error() string {
	parts := make([]string, len(es))
	for i, e := range es {
		parts[i] = e.Error()
	}
	return strings.Join(parts, "; ")
}

// ErrorOrNil returns nil when the slice is empty so callers can use the
// idiomatic `if err := Validate(...); err != nil` pattern.
func (es ValidationErrors) ErrorOrNil() error {
	if len(es) == 0 {
		return nil
	}
	return es
}

// ValidateContext checks a Context against ADR-0002 and the supplied Config.
func ValidateContext(c Context, cfg Config) error {
	var errs ValidationErrors
	if strings.TrimSpace(c.Title) == "" {
		errs = append(errs, FieldError{Field: "title", Message: "required"})
	}
	if strings.TrimSpace(c.Type) == "" {
		errs = append(errs, FieldError{Field: "type", Message: "required"})
	} else if len(cfg.ContextTypes) > 0 && !slices.Contains(cfg.ContextTypes, c.Type) {
		errs = append(errs, FieldError{
			Field:   "type",
			Message: fmt.Sprintf("type %q is not one of: %s", c.Type, strings.Join(cfg.ContextTypes, ", ")),
		})
	}
	errs = append(errs, validateRefList("supersedes", c.Supersedes, KindContext)...)
	return errs.ErrorOrNil()
}

// ValidateADR checks an ADR against ADR-0002.
func ValidateADR(a ADR) error {
	var errs ValidationErrors
	if strings.TrimSpace(a.Title) == "" {
		errs = append(errs, FieldError{Field: "title", Message: "required"})
	}
	errs = appendEnumCheck(errs, "status", a.Status, ADRStatuses, true)
	errs = appendEnumCheck(errs, "coverage", a.Coverage, ADRCoverages, true)
	if strings.TrimSpace(a.Date) == "" {
		errs = append(errs, FieldError{Field: "date", Message: "required (YYYY-MM-DD)"})
	} else if !looksLikeISODate(a.Date) {
		errs = append(errs, FieldError{
			Field:   "date",
			Message: fmt.Sprintf("%q is not in YYYY-MM-DD form", a.Date),
		})
	}
	errs = append(errs, validateRefList("supersedes", a.Supersedes, KindADR)...)
	// `related` is intentionally cross-kind: an ADR often relates to the
	// CTX that motivated it, or to a sibling ADR. Any well-formed ID is ok.
	errs = append(errs, validateRefList("related", a.Related, Kind(""))...)
	// `tags` is free-form strings; no ref validation.
	for i, am := range a.Amendments {
		errs = append(errs, validateAmendmentEntry(am, i)...)
	}
	return errs.ErrorOrNil()
}

// validateAmendmentEntry checks the frontmatter-only fields of one
// amendment per ADR-0025: kind enum, ISO date, non-empty by + summary.
// Marker correlation lives in ValidateAmendmentMarkers (needs the body).
func validateAmendmentEntry(am Amendment, idx int) ValidationErrors {
	prefix := fmt.Sprintf("amendments[%d]", idx)
	var errs ValidationErrors
	if strings.TrimSpace(am.Date) == "" {
		errs = append(errs, FieldError{Field: prefix + ".date", Message: "required (YYYY-MM-DD)"})
	} else if !looksLikeISODate(am.Date) {
		errs = append(errs, FieldError{Field: prefix + ".date", Message: fmt.Sprintf("%q is not in YYYY-MM-DD form", am.Date)})
	}
	errs = appendEnumCheck(errs, prefix+".kind", am.Kind, AmendmentKinds, true)
	if strings.TrimSpace(am.By) == "" {
		errs = append(errs, FieldError{Field: prefix + ".by", Message: "required"})
	}
	if strings.TrimSpace(am.Summary) == "" {
		errs = append(errs, FieldError{Field: prefix + ".summary", Message: "required (non-empty)"})
	}
	return errs
}

// ValidateAmendmentMarkers enforces the body↔frontmatter correspondence
// rules from ADR-0025:
//
//   - Every `[AMENDED YYYY-MM-DD kind]` marker in body has a matching
//     frontmatter entry with the same date + kind.
//   - Every frontmatter entry has either a matching inline marker or a
//     non-empty `affects_sections` (broad structural amendments don't
//     point to a single line and use affects_sections as the anchor).
//
// Markers inside fenced code blocks (```...```) are skipped — ADRs often
// document the marker syntax in examples that aren't real amendments.
//
// Caller demotes errors to warnings for superseded ADRs (editorial fixes
// on archived decisions are allowed per ADR-0025).
func ValidateAmendmentMarkers(amends []Amendment, body []byte) ValidationErrors {
	prose := stripFencedCode(body)
	if len(amends) == 0 && len(AmendmentMarkerRe.FindAll(prose, -1)) == 0 {
		return nil
	}

	type key struct{ date, kind string }
	frontKeys := make(map[key]int, len(amends))
	for i, am := range amends {
		frontKeys[key{am.Date, am.Kind}] = i
	}

	var errs ValidationErrors

	matched := make(map[key]bool, len(amends))
	for _, m := range AmendmentMarkerRe.FindAllSubmatch(prose, -1) {
		k := key{string(m[1]), string(m[2])}
		if _, ok := frontKeys[k]; !ok {
			errs = append(errs, FieldError{
				Field:   "amendments",
				Message: fmt.Sprintf("inline marker [AMENDED %s %s] has no matching frontmatter entry", k.date, k.kind),
			})
			continue
		}
		matched[k] = true
	}

	for i, am := range amends {
		k := key{am.Date, am.Kind}
		if matched[k] {
			continue
		}
		if len(am.AffectsSections) > 0 {
			continue
		}
		errs = append(errs, FieldError{
			Field:   fmt.Sprintf("amendments[%d]", i),
			Message: "frontmatter entry has neither an inline [AMENDED] marker nor affects_sections",
		})
	}

	return errs
}

// stripFencedCode returns body with fenced-code-block contents (everything
// between ``` lines) replaced by blank lines of equal count. Preserves
// byte offsets at line granularity so future positional reporting stays
// accurate. Triple-backtick fences only — indented code blocks are not
// stripped (they're rare in ADR prose).
func stripFencedCode(body []byte) []byte {
	out := make([]byte, 0, len(body))
	inFence := false
	for _, line := range strings.SplitAfter(string(body), "\n") {
		trimmed := strings.TrimSpace(strings.TrimRight(line, "\n"))
		if strings.HasPrefix(trimmed, "```") {
			inFence = !inFence
			// Keep the fence line itself — only the contents are blanked.
			out = append(out, line...)
			continue
		}
		if inFence {
			// Replace with a blank line of equal terminator (preserve newline).
			if strings.HasSuffix(line, "\n") {
				out = append(out, '\n')
			}
			continue
		}
		out = append(out, line...)
	}
	return out
}

// ValidateTask checks a Task against ADR-0002 and the ADR-0004 alignment
// rule (`requires` must contain at least one CTX or ADR reference).
func ValidateTask(t Task) error {
	var errs ValidationErrors
	if strings.TrimSpace(t.Title) == "" {
		errs = append(errs, FieldError{Field: "title", Message: "required"})
	}
	errs = appendEnumCheck(errs, "status", t.Status, TaskStatuses, true)
	errs = appendEnumCheck(errs, "priority", t.Priority, TaskPriorities, false)

	// `requires` validation is two rules: shape + ADR-0004 alignment.
	errs = append(errs, validateRefList("requires", t.Requires, Kind(""))...)
	if len(t.Requires) == 0 {
		errs = append(errs, FieldError{
			Field:   "requires",
			Message: "must cite at least one ADR or CTX (ADR-0004 alignment rule)",
		})
	} else if !containsNonTaskRef(t.Requires) {
		errs = append(errs, FieldError{
			Field:   "requires",
			Message: "must include at least one CTX or ADR reference, not only TP (ADR-0004)",
		})
	}

	errs = append(errs, validateRefList("depends_on", t.DependsOn, KindTask)...)
	return errs.ErrorOrNil()
}

// validateRefList checks every entry of an ID-reference array against the
// ID regex. If restrictTo is non-empty, every entry must also use that
// kind's prefix.
func validateRefList(field string, refs []string, restrictTo Kind) ValidationErrors {
	var errs ValidationErrors
	for i, r := range refs {
		if !IDRegexp.MatchString(r) {
			errs = append(errs, FieldError{
				Field:   fmt.Sprintf("%s[%d]", field, i),
				Message: fmt.Sprintf("%q does not match %s", r, IDPattern),
			})
			continue
		}
		if restrictTo != "" && !strings.HasPrefix(r, restrictTo.Prefix()+"-") {
			errs = append(errs, FieldError{
				Field:   fmt.Sprintf("%s[%d]", field, i),
				Message: fmt.Sprintf("%q must be a %s reference", r, restrictTo.Prefix()),
			})
		}
	}
	return errs
}

// containsNonTaskRef reports whether any reference uses the CTX or ADR prefix.
func containsNonTaskRef(refs []string) bool {
	for _, r := range refs {
		if strings.HasPrefix(r, "CTX-") || strings.HasPrefix(r, "ADR-") {
			return true
		}
	}
	return false
}

// appendEnumCheck validates a string against a closed enum. When required
// is true, an empty value also produces an error. The allowed values are
// always included in the Message so agents can fix the value on first read.
func appendEnumCheck(errs ValidationErrors, field, value string, allowed []string, required bool) ValidationErrors {
	hint := strings.Join(allowed, ", ")
	if value == "" {
		if required {
			errs = append(errs, FieldError{
				Field:   field,
				Message: fmt.Sprintf("required; must be one of: %s", hint),
			})
		}
		return errs
	}
	if !slices.Contains(allowed, value) {
		errs = append(errs, FieldError{
			Field:   field,
			Message: fmt.Sprintf("%s %q is not one of: %s", field, value, hint),
		})
	}
	return errs
}

// looksLikeISODate is a cheap YYYY-MM-DD shape check. The full date range is
// the caller's responsibility — we only reject obviously wrong formats to
// keep the dog-food docs honest.
func looksLikeISODate(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	for i, ch := range s {
		if i == 4 || i == 7 {
			continue
		}
		if ch < '0' || ch > '9' {
			return false
		}
	}
	return true
}
