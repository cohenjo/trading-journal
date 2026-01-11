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