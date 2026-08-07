// Environment-variable registry, manifest, and drift guards.
//
// This file is deliberately project-agnostic: it defines the vocabulary
// (#HostVar, #ContainerVar), derives the manifest from whatever `files` and
// `_host`/`_containerEnv` the project declares, and enforces that the two cannot
// drift apart. Copy it into another compose project unchanged; only compose.cue
// needs editing.
//
// Two kinds of variable exist and they are NOT interchangeable:
//
//   - Host vars    — read by the `docker compose` CLI on your machine when it
//                    expands ${VAR} while parsing the YAML. These come from your
//                    shell or the `.env` file sitting next to compose.yaml. They
//                    never reach the container unless something passes them in.
//   - Container vars — the `environment:` keys handed to the running process.
//                    md-bug's Rust binary reads these as clap fallbacks.
//
// `.env` feeds the first kind only. A var can be both (RUST_LOG here is a host
// var whose value is piped into a container var of the same name) — the manifest
// records that link via `fromHost`.
package dev

import (
	"list"
	"regexp"
	"strings"
	"encoding/yaml"
)

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// A variable read by the docker compose CLI on the host.
#HostVar: {
	name:        =~"^[A-Za-z_][A-Za-z0-9_]*$"
	description: string

	// Value used when the variable is unset. Ignored when required is true.
	default: string | *""

	// Required vars interpolate as ${NAME} with no fallback, so compose leaves
	// them empty and the service misbehaves rather than silently using a default.
	required: bool | *false

	// Marks values that must never be committed. Such vars are emitted into
	// .env.example with an empty value and a warning rather than their default.
	secret: bool | *false

	// The interpolation string to embed in compose files. Deriving it — rather
	// than hand-writing "${MD_BUG_PORT:-7878}" at each use site — is the point:
	// the name and default cannot disagree between the registry and the YAML.
	ref: string
	if required {
		ref: "${\(name)}"
	}
	if !required {
		ref: "${\(name):-\(default)}"
	}
}

// A variable passed into a container via `environment:`.
#ContainerVar: {
	description: string
	value:       string

	// The CLI flag this variable backs, where one exists. md-bug's binary takes
	// every setting as both a flag and an env var, and the flag is the name that
	// appears in --help, so recording it makes the manifest self-explanatory.
	flag?: string
}

// ---------------------------------------------------------------------------
// Derivation
//
// Everything below is computed from `files`, `_host` and `_containerEnv`. None
// of it is hand-maintained, so none of it can go stale.
// ---------------------------------------------------------------------------

// Marshalled YAML for each exported file, and for each service within it. Text
// is what interpolation actually operates on, so matching against the rendered
// text is what makes usage-detection honest: a var referenced from a commented-out
// service does not appear here, because comments do not survive marshalling.
//
// Note this assumes every exported compose file declares `services`. That holds
// for compose files worth writing; a file without services would error here.
_rendered: {
	for fname, doc in files {
		(fname): {
			whole: yaml.Marshal(doc)
			services: {
				for sname, svc in doc.services {
					(sname): yaml.Marshal(svc)
				}
			}
		}
	}
}

_allText: strings.Join([for _, r in _rendered {r.whole}], "\n")

// Every ${VAR occurrence across every generated file. Collected into a struct
// first because struct keys deduplicate and sort themselves; CUE's
// list.UniqueItems is a validator, not a dedupe function.
_referencedSet: {
	for m in regexp.FindAll(#"\$\{[A-Za-z_][A-Za-z0-9_]*"#, _allText, -1) {
		(strings.TrimPrefix(m, "${")): true
	}
}
_referenced: [for k, _ in _referencedSet {k}]

_declared: [for k, _ in _host {k}]

// GUARD: an interpolation that no one declared.
//
// This is the check that makes the manifest trustworthy — you cannot sneak a
// ${NEW_VAR} into a compose file without also documenting it in _host, so the
// manifest is a complete inventory rather than a best effort. Uncommenting a
// service that uses undeclared vars fails here until they are registered.
//
// Keyed by variable name rather than collected into a list, because the field
// path is what CUE prints: the failure reads
//
//	_hostVarIsDeclared.SNEAKY_VAR: conflicting values true and false
//
// which names the culprit, where a list assertion would only report a length
// mismatch. Fix by adding the variable to _host in compose.cue.
_hostVarIsDeclared: {
	for n in _referenced {
		(n): true & list.Contains(_declared, n)
	}
}

// Declared but not referenced anywhere. Deliberately NOT a hard error: a var can
// legitimately go idle while the service using it is commented out. It is
// reported in the manifest instead so it stays visible.
_unusedHostVars: [
	for k, v in _host if !strings.Contains(_allText, v.ref) {k},
]

// ---------------------------------------------------------------------------
// The manifest
//
// Shaped for aggregation: every record carries `project`, so manifests from many
// repos merge with `jq -s 'map(.hostVars[]) | ...'` without further munging.
// ---------------------------------------------------------------------------

envManifest: {
	project: _project
	source:  "compose.cue"

	// Vars you set on the host — this is exactly the set that belongs in .env.
	hostVars: [
		for k, v in _host {
			{
				name:          v.name
				description:   v.description
				required:      v.required
				secret:        v.secret
				default:       v.default
				interpolation: v.ref

				// Where the var is actually used, derived by matching the
				// rendered text of each service rather than declared by hand.
				usedBy: [
					for fname, r in _rendered
					for sname, text in r.services
					if strings.Contains(text, v.ref) {
						{file: fname, service: sname}
					},
				]
			}
		},
	]

	// Vars handed to the running container.
	containerVars: [
		for sname, vars in _containerEnv
		for k, v in vars {
			{
				name:        k
				service:     sname
				description: v.description
				value:       v.value
				if v.flag != _|_ {
					flag: v.flag
				}

				// Which host vars feed this value, derived by substring match.
				// Empty means the value is fixed at generation time.
				fromHost: [
					for hk, hv in _host if strings.Contains(v.value, hv.ref) {hk},
				]
			}
		},
	]

	unusedHostVars: _unusedHostVars
}

// ---------------------------------------------------------------------------
// .env.example
//
// Rendered as text so it can be copied straight to .env. Secrets are emitted
// empty: a default that looks like a credential invites committing it.
// ---------------------------------------------------------------------------

envExample: strings.Join(list.Concat([
	[
		"# Generated by gen-compose.sh from compose.cue. DO NOT EDIT.",
		"#",
		"# Host-side variables for `docker compose`, read from this file when it is",
		"# named .env and sits next to compose.yaml:  cp .env.example .env",
		"#",
		"# These are expanded by the compose CLI while parsing the YAML. They are NOT",
		"# passed into the container — see envManifest.containerVars for those.",
		"",
	],
	list.Concat([
		for k, v in _host
		let uses = [
			for fname, r in _rendered
			for sname, text in r.services
			if strings.Contains(text, v.ref) {"\(fname):\(sname)"},
		] {
			list.Concat([
				["# \(v.description)"],
				[if v.secret {"# SECRET — do not commit a real value."}],
				[if len(uses) > 0 {"# used by: \(strings.Join(uses, ", "))"}],
				[if len(uses) == 0 {"# currently unused (the service referencing it may be commented out)"}],
				[if v.required {"\(k)="}],
				[if !v.required && v.secret {"# \(k)="}],
				[if !v.required && !v.secret {"\(k)=\(v.default)"}],
				[""],
			])
		},
	]),
]), "\n")
