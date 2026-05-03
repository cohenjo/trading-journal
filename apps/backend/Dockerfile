# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Install uv
RUN pip install uv

# Copy the pyproject.toml file to the working directory
COPY pyproject.toml ./

# Install dependencies using uv
RUN uv venv
RUN uv pip sync pyproject.toml
RUN uv pip install alembic

# Copy the rest of the application's code to the working directory
COPY . .

# Command to run the application
CMD ["uv", "run", "python", "-m", "app.worker.runtime"]
