// Source of truth for md-bug's Docker Compose configuration.
//
// compose.yaml and compose.build.yaml are GENERATED from this file — do not edit
// them by hand. Regenerate with ./gen-compose.sh, which also validates against the
// official Compose specification.
//
//	./gen-compose.sh                       # vet + regenerate both YAML files
//	docker compose up -d                   # run the published image
//	docker compose logs -f                 # bootstrap admin password is printed ONCE, here
//	docker compose -f compose.yaml -f compose.build.yaml up -d --build   # build from source
//
// On first start the server creates the bootstrap administrator and prints a
// generated password to stdout exactly once. Capture it from `docker compose logs`
// before that output rolls away. The account is flagged must_change_password, so it
// can do nothing but rotate that password at first login.
//
// Note `cue export` does not carry comments into the generated YAML. That is why the
// prose lives here: this file is what you read and edit, the YAML is build output.
package dev

import "cue.dev/x/dockercompose"

// Identifies this project in the generated env-manifest.json, so manifests from
// several repos can be concatenated and still say where each variable came from.
_project: "md-bug"

// ---------------------------------------------------------------------------
// Host variables — the ${...} values the `docker compose` CLI expands on your
// machine, from the shell or from .env. See env.cue for the host-vs-container
// distinction; these never reach the container on their own.
//
// Declaring them here rather than writing "${MD_BUG_PORT:-7878}" inline is what
// makes them extractable: .env.example and env-manifest.json are both generated
// from this block, and env.cue fails `cue vet` if a compose file interpolates
// anything that is not registered here.
// ---------------------------------------------------------------------------
_host: [Name=string]: #HostVar & {name: Name}
_host: {
	MD_BUG_TAG: {
		description: "Image tag to run. Published tags are architecture-suffixed — latest-x86_64 and latest-aarch64. There is no plain `latest`."
		default:     "latest-x86_64"
	}
	MD_BUG_PORT: {
		description: "Port the server binds inside the container. Feeds both BUG_PORT and the container side of the port mapping."
		default:     "7878"
	}
	MD_BUG_HOST_PORT: {
		description: "Port published on the host. Change this alone to move the service without touching the container."
		default:     "7878"
	}
	MD_BUG_ADMIN_USERNAME: {
		description: "Username of the bootstrap administrator created on first run. Only consulted while the account store is empty."
		default:     "admin"
	}
	RUST_LOG: {
		description: "Tracing filter for the backend, e.g. info, debug, md_bug_backend=debug. Both a host var and a container var of the same name."
		default:     "debug"
	}
}

// ---------------------------------------------------------------------------
// Knobs. Declared once and referenced everywhere below, so the image reference,
// the data path and the port cannot drift between the three services the way
// they can in hand-written YAML.
//
// `_`-prefixed fields are hidden: CUE evaluates them but never exports them, so
// none of this leaks into compose.yaml.
// ---------------------------------------------------------------------------

_image: "xerofuzzion/md-bug:\(_host.MD_BUG_TAG.ref)"

// The server binary, and the data directory it owns. `_root` is also passed as
// --root by the one-shot services, so both halves stay in agreement.
_binary: "/app/md-bug-backend"
_root:   "/app/work"

// Host path backing _root. Everything lives here: component trees, bug markdown,
// rkyv metadata, and users.json (accounts and hashed tokens). Back up this
// directory and nothing else; lose it and the install is gone.
//
// To hand storage to Docker instead (avoids host uid/gid mismatches), set this to
// "md-bug-data" — the named volume declared at the bottom of this file. Because
// every service references _dataMount, that one edit moves all three at once.
_hostData: "./bug-data"

_dataMount: "\(_hostData):\(_root)"

// Container port. Referenced by both BUG_PORT and the ports mapping, which is
// exactly the pair that silently desynchronises in hand-written compose files.
_port:     _host.MD_BUG_PORT.ref
_hostPort: _host.MD_BUG_HOST_PORT.ref

// ---------------------------------------------------------------------------
// Shared service fragment.
//
// Repeating the image's own ENTRYPOINT looks redundant, but it is load-bearing:
// overriding the entrypoint is what clears the image's CMD, which otherwise passes
// --root/--port/--frontend-dir explicitly. clap gives CLI arguments precedence over
// their env fallbacks, so with the stock CMD in place every BUG_*/FRONTEND_DIR
// value below would be silently ignored. (`command: []` and `command: ""` do NOT
// clear a CMD — verified against Compose v5.)
// ---------------------------------------------------------------------------
_base: {
	image:      _image
	entrypoint: [_binary]
	volumes: [_dataMount]
}

// One-shot administrative services.
//
// Each makes the process do its job and *exit* rather than serve. `restart: "no"`
// is set here rather than left to convention: because CUE unifies, a future edit
// that tries to give one of these `restart: "unless-stopped"` is a conflict at
// `cue vet` time, not a restart loop discovered in production.
//
// `profiles` keeps them out of `docker compose up`; `docker compose run` ignores
// profiles, which is how they are meant to be invoked.
_oneshot: _base & {
	profiles: ["tools"]
	restart: "no"
}

// ---------------------------------------------------------------------------
// Container variables — what actually reaches the running process, keyed by
// service. The `environment:` map below is derived from this, so the manifest
// and the compose file are the same declaration rather than two copies.
//
// `flag` records the clap argument each one backs; the binary accepts every
// setting as both, and the flag is the name that shows up in --help.
// ---------------------------------------------------------------------------
_containerEnv: [string]: [string]: #ContainerVar
_containerEnv: "md-bug": {
	BUG_ROOT: {
		flag:        "-r, --root"
		description: "Data directory. Required, no default. Created if absent. Holds component trees, bug markdown, rkyv metadata and users.json."
		value:       _root
	}
	BUG_PORT: {
		flag:        "-p, --port"
		description: "Binds 0.0.0.0:<port> inside the container. Binary default is 8080."
		value:       _port
	}
	FRONTEND_DIR: {
		flag:        "-f, --frontend-dir"
		description: "Static SPA files, falling back to index.html. The binary's default is ../frontend/public, which does not exist in the image — so this must be set once the CMD is cleared."
		value:       "/app/public"
	}
	RUST_LOG: {
		description: "Tracing filter for tracing_subscriber::fmt::init()."
		value:       _host.RUST_LOG.ref
	}
	ADMIN_USERNAME: {
		flag:        "--AdminUsername"
		description: "Administrator created on first run, and owner of the auto-created DEFAULT component. Only consulted while the account store is empty; changing it later renames nothing."
		value:       _host.MD_BUG_ADMIN_USERNAME.ref
	}
	GENERATE_FAKE_DATA: {
		flag:        "--fake_data"
		description: "Seeds sample components and bugs at startup. Development only."
		value:       "false"
	}

	// Deliberately absent, and documented here so the reason survives:
	//
	//   CREATE_ROOT_COMPONENT / ADMIN_USER_ID / CREATE_USER  (--CreateRootComponent,
	//     --AdminUserId, --CreateUser) each make the process do its job and *exit*
	//     rather than serve. Under `restart: unless-stopped` that is a restart
	//     loop. They belong on the one-shot services, not here.
	//
	//   MD_BUG_BOT_SUFFIX pins the generated suffix of bot-token identities
	//     (<owner>--<suffix>) so they are reproducible; the e2e suite sets it. The
	//     token secret stays CSPRNG regardless. Leave unset in real deployments —
	//     a taken name makes token creation return 409.
	//
	//   --CreateAdmin (pairs with --CreateUser) is flag-only with no env
	//     equivalent, so it has to be passed on the command line.
}

// The upstream schema types `restart` as a bare `string` — its docstring lists the
// legal values but does not enforce them, so `alwyas` validates fine and only
// surfaces as a Docker error at `up` time. Narrowing it here turns that into a
// `cue vet` failure. This is the part that a YAML file cannot express at all.
#Restart: "no" | "always" | "unless-stopped" | =~"^on-failure(:[0-9]+)?$"

// ---------------------------------------------------------------------------
// The exported files. Unifying with dockercompose.#Schema type-checks both
// against the upstream Compose specification — the schema is closed, so a
// misspelled field is an error here rather than a silently ignored key.
// ---------------------------------------------------------------------------

files: "compose.yaml": dockercompose.#Schema & {
	// Applies to every service defined below, including ones added later.
	services: [string]: restart?: #Restart

	services: {
		"md-bug": _base & {
			container_name: "md-bug"
			restart:        "unless-stopped"

			// Derived from _containerEnv above — the descriptions and clap flags
			// live there so they can also reach env-manifest.json.
			environment: {
				for k, v in _containerEnv["md-bug"] {(k): v.value}
			}

			ports: ["\(_hostPort):\(_port)"]

			// /app/public (frontend bundle) and /app/md-bug-backend (the binary) are
			// baked into the image and read-only at runtime. Only mount over the
			// frontend if you are deliberately serving a locally built one:
			//
			//	volumes: [_dataMount, "./frontend/public:/app/public:ro"]

			// No healthcheck: the final image is distroless (no shell, no curl, no
			// wget), so a probe would mean copying a static binary into the image.
		}

		// docker compose run --rm create-user
		//
		// Prompts for the password twice on the terminal so it never reaches shell
		// history or the process list — hence stdin_open/tty. Append --CreateAdmin
		// to make the account an administrator:
		//
		//	docker compose run --rm create-user \
		//	  --root /app/work --CreateUser alice --CreateAdmin
		// "create-user": _oneshot & {
		// 	stdin_open: true
		// 	tty:        true
		// 	command: ["--root", _root, "--CreateUser", "${MD_BUG_NEW_USER:-newuser}"]
		// }

		// docker compose run --rm create-root-component
		//
		// Writes <root>/<sanitized_name>/component_metadata and exits.
		// MD_BUG_ROOT_ADMIN is matched as a literal ACL string, so it must equal a
		// real account's username or nobody holds ComponentAdmin on the new root.
		// The name needs at least one alphanumeric character.
		// "create-root-component": _oneshot & {
		// 	command: [
		// 		"--root", _root,
		// 		"--CreateRootComponent", "${MD_BUG_ROOT_NAME:-New Root}",
		// 		"--AdminUserId", "${MD_BUG_ROOT_ADMIN:-admin}",
		// 	]
		// }
	}

	// Only used if _hostData above is switched over to it.
	volumes: "md-bug-data": null
}

// ---------------------------------------------------------------------------
// Overlay that builds from source instead of pulling.
//
//	docker compose -f compose.yaml -f compose.build.yaml up -d --build
//
// It is a separate file rather than a second service because a build service
// without a profile would collide with `md-bug` on the host port — `up` starts
// every unprofiled service.
// ---------------------------------------------------------------------------
// files: "compose.build.yaml": dockercompose.#Schema & {
// 	services: "md-bug": {
// 		image: "md-bug:local"
// 		build: {
// 			context:    "."
// 			dockerfile: "Dockerfile"

// 			// frontend/package.json depends on standard-ts-lib as
// 			// "file:../../standard-ts-lib", and inside MonoParra
// 			// tools/standard-ts-lib is a symlink into common/ that BuildKit
// 			// refuses to follow out of the build context. So it is supplied as a
// 			// named build context, mirroring what release.sh does with
// 			// --build-context. A build without this fails.
// 			additional_contexts: standard_ts_lib: "../standard-ts-lib"
// 		}
// 	}
// }
