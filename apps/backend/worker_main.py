"""Compatibility entrypoint for running the backend worker."""

from app.worker.runtime import start_worker


if __name__ == "__main__":
    start_worker()
