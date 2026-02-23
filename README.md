# Personal Options Trading Journal

This project is a personal trading journal designed to help users track their options trades, analyze performance, and visualize their profit and loss over time.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Python 3.10+ and uv
- Node.js and npm

### Running with Docker Compose

1.  Build and start the services:
    ```bash
    docker-compose up --build
    ```
2.  The frontend will be available at `http://localhost:3000` and the backend at `http://localhost:8000`.

### Running with Aspire (development orchestration)

Aspire support is available via `aspire/apphost.cs` for development orchestration of:
- `frontend` (Next.js app run natively via Aspire JavaScript integration)
- `backend` (FastAPI/Uvicorn app run natively via Aspire Python integration with `uv`)
- `db` (PostgreSQL 13 container)
- `ib-gateway` (IB Gateway container, optional/opt-in)

The AppHost intentionally omits the existing Prometheus/Jaeger/Grafana/Collector stack because Aspire provides built-in dev-time monitoring with OpenTelemetry and the Aspire dashboard.

1. Install Aspire CLI:
   ```bash
   curl -fsSL https://aspire.dev/install.sh | bash
   ```
2. Run Aspire from repo root:
   ```bash
   aspire run aspire/apphost.cs
   ```
3. (Optional) Enable IB Gateway only when needed:
   ```bash
   export RUN_IB_GATEWAY=true
   export TWS_USERID="your-user"
   export TWS_PASSWORD="your-password"
   aspire run aspire/apphost.cs
   ```
4. Open:
   - Aspire dashboard URL from terminal output
   - Frontend: `http://localhost:3000`
   - Backend: `http://localhost:8000`
   - IB Gateway ports: `4001` (live), `4002` (paper)

Notes:
- Backend/frontend run as local processes (not Docker containers) in Aspire mode.
- Keep Python/uv and Node/npm installed locally when using Aspire mode.
- Frontend API URL is injected from the backend Aspire endpoint reference.
- Backend DB URL is injected from the Aspire Postgres resource and backend waits for DB readiness.
- `ib-gateway` is disabled by default unless `RUN_IB_GATEWAY=true`.
- Existing `docker-compose.yml` remains unchanged and can still be used as-is.
- On Apple Silicon, if the IB image requires amd64 emulation, run with:
  ```bash
  export DOCKER_DEFAULT_PLATFORM=linux/amd64
  ```

### Running Locally

#### Backend

1.  Navigate to the backend directory:
    ```bash
    cd apps/backend
    ```
2.  Create and activate a virtual environment:
    ```bash
    uv venv
    source .venv/bin/activate
    ```
3.  Install dependencies:
    ```bash
    uv pip sync requirements.txt
    ```
4.  Start the backend server:
    ```bash
    uv run uvicorn main:app --reload
    ```
    The backend will be running on `http://localhost:8000`.

#### Frontend

1.  Navigate to the frontend directory:
    ```bash
    cd apps/frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
    The frontend will be available at `http://localhost:3000`.
