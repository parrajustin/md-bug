# md-bug Backend

The `md-bug` backend is a Rust-based web server that manages bug data using hierarchical storage and binary serialization (`rkyv`). It provides a REST API for the frontend and AI agents (via MCP).

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (2021 edition)

### Launching the Server

To start the backend server, run the following command from the `md-bug/backend` directory:

```bash
cargo run -- --root <DATA_DIRECTORY>
```

Replace `<DATA_DIRECTORY>` with the path where you want the bug data to be stored. If the directory does not exist, it will be created automatically, along with a `default` component folder.

### Command-Line Flags

The following flags are available when running the backend:

| Flag | Short | Default | Description |
| :--- | :---: | :--- | :--- |
| `--root` | `-r` | (Required) | The base directory where all bug components and data are stored. |
| `--port` | `-p` | `8080` | The port the HTTP server will listen on. |
| `--frontend-dir` | `-f` | `../frontend/public` | The directory containing the static frontend files (HTML, JS, CSS). |

### Example

```bash
cargo run -- -r ./bug-data -p 9000
```

## Testing

The backend includes a suite of unit tests to verify API functionality and data integrity. Tests are located in `src/api/api_test.rs`.

To run the tests:

```bash
cargo test
```
