"""add_ndx1m_table

Revision ID: fb4bdd3a199b
Revises: 335418ec68e3
Create Date: 2025-07-03 00:30:30.036620

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'fb4bdd3a199b'
down_revision = '335418ec68e3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('ndx1m',
    sa.Column('timestamp', sa.DateTime(), nullable=False),
    sa.Column('open', sa.Float(), nullable=False),
    sa.Column('high', sa.Float(), nullable=False),
    sa.Column('low', sa.Float(), nullable=False),
    sa.Column('close', sa.Float(), nullable=False),
    sa.Column('volume', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('timestamp')
    )


def downgrade() -> None:
    op.drop_table('ndx1m')