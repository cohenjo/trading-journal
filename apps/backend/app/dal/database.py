import os
from sqlmodel import SQLModel, create_engine, Session

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/trading_journal")

engine = create_engine(DATABASE_URL, echo=True)


def create_db_and_tables():
    # SQLModel.metadata.create_all(engine)
    pass


def get_session():
    with Session(engine) as session:
        yield session