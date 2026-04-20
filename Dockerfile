# syntax=docker/dockerfile:1

# Stage 1: Backend Builder
FROM rust:1.86-bookworm AS backend-builder
WORKDIR /build
# Copy the backend source
# NOTE: This Dockerfile MUST be built from the parent directory of md-bug
# Example: docker build -f md-bug/Dockerfile .
COPY md-bug/backend ./backend
WORKDIR /build/backend
# Build the release binaries
RUN cargo build --release
# Create the work directory to be copied to the final image
RUN mkdir -p /build/work

# Stage 2: Frontend Builder
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build/md-bug
# Copy frontend and its dependency standard-ts-lib
COPY md-bug/frontend ./frontend
WORKDIR /build
COPY standard-ts-lib ./standard-ts-lib
WORKDIR /build/md-bug/frontend
# Enable pnpm and build the production frontend
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install
RUN pnpm run build

# Stage 3: Final Image
FROM gcr.io/distroless/cc-debian12
WORKDIR /app

# Copy binaries from backend-builder
COPY --from=backend-builder /build/backend/target/release/md-bug-backend /app/

# Copy the work directory with appropriate permissions
COPY --from=backend-builder --chmod=777 /build/work /app/work

# Copy static frontend files
COPY --from=frontend-builder /build/md-bug/frontend/public /app/public

# Default environment variables for documentation
ENV BUG_ROOT=/app/work
ENV BUG_PORT=7878

# Expose the default port
EXPOSE 7878

# Start the backend with the specified defaults.
# We use CMD to allow overriding these defaults if necessary.
ENTRYPOINT ["/app/md-bug-backend"]
CMD ["--root", "/app/work", "--port", "7878", "--frontend-dir", "/app/public"]
