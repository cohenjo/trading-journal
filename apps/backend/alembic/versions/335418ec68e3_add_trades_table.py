"""add_trades_table

Revision ID: 335418ec68e3
Revises: 8250ff809a39
Create Date: 2025-07-03 00:30:01.270903

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = '335418ec68e3'
down_revision = '8250ff809a39'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('manualtrade',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('timestamp', sa.DateTime(), nullable=False),
    sa.Column('symbol', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('side', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('size', sa.Float(), nullable=False),
    sa.Column('entry_price', sa.Float(), nullable=False),
    sa.Column('exit_price', sa.Float(), nullable=False),
    sa.Column('pnl', sa.Float(), nullable=False),
    sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('manualtrade')