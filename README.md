# Personal Options Trading Journal

[![Squad CI](https://github.com/cohenjo/trading-journal/actions/workflows/squad-ci.yml/badge.svg)](https://github.com/cohenjo/trading-journal/actions/workflows/squad-ci.yml)

This project is a personal trading journal designed to help users track their options trades, analyze performance, and visualize their profit and loss over time.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Python 3.10+ and uv
- Node.js and npm

### Running with Docker Compose

Docker Compose now runs **worker only**. The architecture has shifted:
- **DB** → Supabase (cloud)
- **Frontend** → Vercel (cloud)
- **Backend** → Mostly subsumed by worker for compute jobs
- **Worker** → Runs locally in Docker, processes `compute_jobs` queue

1.  Set your Supabase connection string in `.env`:
    ```bash
    DATABASE_URL=postgresql://...@db.xxxxx.supabase.co:5432/postgres
    ```
2.  Build and start the worker:
    ```bash
    docker compose up --build worker
    ```
3.  The worker will poll the `compute_jobs` table and process background jobs.

### Running with Aspire (development orchestration)

> **Note:** Aspire mode is legacy. The stack now runs on Supabase + Vercel + local worker.

For historical reference, Aspire support is available via `aspire/apphost.cs` for development orchestration. See `aspire/README.md` for details.

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
