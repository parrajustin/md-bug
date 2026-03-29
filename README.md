# md-bug

Markdown buganizer like tool.

## Project Structure

- `frontend/`: React-based bug viewer.
- `backend/`: Rust-based API server and data manager.

## Quick Start (Backend)

To run the backend server with fake data generation:

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Start the server with the `--fake-data` flag:
   ```bash
   cargo run -- --root ./data --fake-data
   ```

For more details on backend configuration, see [backend/README.md](backend/README.md).

## Quick Start (Frontend)

To build the frontend:

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Run the build script:
   ```bash
   npm run build
   ```
