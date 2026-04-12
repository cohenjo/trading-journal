"""add insurance_policies table

Revision ID: acadd4bc6806
Revises: 5fe76bf46802
Create Date: 2025-07-22 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = 'acadd4bc6806'
down_revision = '5fe76bf46802'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('insurance_policies',
        sa.Column('id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('owner', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('provider', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('policy_number', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('sum_insured', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('monthly_premium', sa.Float(), nullable=True),
        sa.Column('beneficiaries', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('expiry_date', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('website', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('notes', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('insurance_policies')
