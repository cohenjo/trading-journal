# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install uv and curl (curl used by the HTTP backend healthcheck)
RUN pip install uv && apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy the pyproject.toml file to the working directory
COPY pyproject.toml ./

# Install dependencies using uv
RUN uv venv
RUN uv pip sync pyproject.toml
RUN uv pip install alembic

# Copy the rest of the application's code to the working directory
COPY . .

# Worker liveness probe -- checks heartbeat file freshness (no HTTP server needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-m", "app.worker.healthcheck"]

# Command to run the application
CMD ["uv", "run", "python", "-m", "app.worker.runtime"]
