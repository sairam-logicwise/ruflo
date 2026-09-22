package schema

import (
	"encoding/json"
	"fmt"
)

// JSONSchemaVersion is the meta-schema all emitted schemas advertise.
const JSONSchemaVersion = "https://json-schema.org/draft/2020-12/schema"

// SchemaBaseURI is the conceptual base for DocOps schema $id URIs. The
// hosted form will exist once the repo is public; the path segment alone
// is what IDE integrations will match against.
const SchemaBaseURI = "https://docops.dev/schema/v1"

// JSONSchemas returns the three canonical JSON Schemas keyed by the
// filename they should be written to. The Context schema's `type` enum is
// sourced from cfg — pass schema.Config{} to emit without an enum (useful
// for `docops init` when no project-specific types exist yet).
func JSONSchemas(cfg Config) (map[string][]byte, error) {
	ctxSchema, err := marshal(contextSchema(cfg))
	if err != nil {
		return nil, fmt.Errorf("marshal context schema: %w", err)
	}
	decSchema, err := marshal(decisionSchema())
	if err != nil {
		return nil, fmt.Errorf("marshal decision schema: %w", err)
	}
	taskSchema, err := marshal(taskSchema())
	if err != nil {
		return nil, fmt.Errorf("marshal task schema: %w", err)
	}
	return map[string][]byte{
		"context.schema.json":  ctxSchema,
		"decision.schema.json": decSchema,
		"task.schema.json":     taskSchema,
	}, nil
}

func marshal(v any) ([]byte, error) {
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}

// object is a small helper type for JSON Schema nodes. Using
// map[string]any directly produces ugly ordered output; this keeps fields
// in a stable, human-readable order.
type object map[string]any

func contextSchema(cfg Config) object {
	typeSchema := object{
		"type":        "string",
		"description": "Project-configured CTX type (see docops.yaml.context_types).",
	}
	if len(cfg.ContextTypes) > 0 {
		typeSchema["enum"] = cfg.ContextTypes
	}
	return object{
		"$schema":              JSONSchemaVersion,
		"$id":                  SchemaBaseURI + "/context.schema.json",
		"title":                "DocOps Context frontmatter",
		"description":          "Stakeholder input documents. File prefix CTX-. See ADR-0002.",
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"title", "type"},
		"properties": object{
			"title": object{
				"type":      "string",
				"minLength": 1,
			},
			"type": typeSchema,
			"supersedes": object{
				"type":    "array",
				"items":   refItem(KindContext),
				"default": []any{},
			},
		},
	}
}

func decisionSchema() object {
	return object{
		"$schema":              JSONSchemaVersion,
		"$id":                  SchemaBaseURI + "/decision.schema.json",
		"title":                "DocOps ADR frontmatter",
		"description":          "Architecture Decision Records. File prefix ADR-. See ADR-0002.",
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"title", "status", "coverage", "date"},
		"properties": object{
			"title": object{
				"type":      "string",
				"minLength": 1,
			},
			"status": object{
				"type": "string",
				"enum": ADRStatuses,
			},
			"coverage": object{
				"type":        "string",
				"enum":        ADRCoverages,
				"description": "required = a completed task must cite this ADR; not-needed = opt-out documented in the ADR body.",
			},
			"date": object{
				"type":    "string",
				"pattern": `^\d{4}-\d{2}-\d{2}$`,
			},
			"supersedes": object{
				"type":    "array",
				"items":   refItem(KindADR),
				"default": []any{},
			},
			"related": object{
				"type":        "array",
				"items":       refItem(Kind("")),
				"default":     []any{},
				"description": "Cross-kind references (CTX or ADR, or TP in rare cases).",
			},
			"tags": object{
				"type":    "array",
				"items":   object{"type": "string"},
				"default": []any{},
			},
			"amendments": object{
				"type":        "array",
				"description": "Post-acceptance edits per ADR-0025. Append-only; must not change the decision itself.",
				"default":     []any{},
				"items": object{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"date", "kind", "by", "summary"},
					"properties": object{
						"date": object{
							"type":    "string",
							"pattern": `^\d{4}-\d{2}-\d{2}$`,
						},
						"kind": object{
							"type":        "string",
							"enum":        AmendmentKinds,
							"description": "editorial = typo/dead link/rename; errata = factual correction; clarification = same decision new framing; late-binding = placeholder now concrete.",
						},
						"by": object{
							"type":      "string",
							"minLength": 1,
						},
						"summary": object{
							"type":      "string",
							"minLength": 1,
						},
						"affects_sections": object{
							"type":  "array",
							"items": object{"type": "string"},
						},
						"ref": object{
							"type":        "string",
							"description": "ADR id, PR URL, issue ref, or task id.",
						},
					},
				},
			},
		},
	}
}

func taskSchema() object {
	return object{
		"$schema":              JSONSchemaVersion,
		"$id":                  SchemaBaseURI + "/task.schema.json",
		"title":                "DocOps Task frontmatter",
		"description":          "Work unit. File prefix TP-. Must cite ≥1 ADR or CTX in `requires` per ADR-0004.",
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"title", "status", "requires"},
		"properties": object{
			"title": object{
				"type":      "string",
				"minLength": 1,
			},
			"status": object{
				"type": "string",
				"enum": TaskStatuses,
			},
			"priority": object{
				"type":    "string",
				"enum":    TaskPriorities,
				"default": "p2",
			},
			"assignee": object{
				"type":    "string",
				"default": "unassigned",
			},
			"requires": object{
				"type":        "array",
				"minItems":    1,
				"description": "Must include ≥1 CTX or ADR reference (ADR-0004).",
				"items": object{
					"type":    "string",
					"pattern": IDPattern,
				},
				"contains": object{
					"type":    "string",
					"pattern": `^(CTX|ADR)-\d+$`,
				},
			},
			"depends_on": object{
				"type":    "array",
				"items":   refItem(KindTask),
				"default": []any{},
			},
		},
	}
}

// refItem returns the `items` schema for an array of references to a
// specific kind. When kind is empty, any valid ID shape is allowed.
func refItem(kind Kind) object {
	if kind == "" {
		return object{"type": "string", "pattern": IDPattern}
	}
	return object{
		"type":    "string",
		"pattern": fmt.Sprintf(`^%s-\d+$`, kind.Prefix()),
	}
}
