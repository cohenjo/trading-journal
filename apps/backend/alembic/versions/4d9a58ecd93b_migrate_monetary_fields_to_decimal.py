"""Migrate monetary float fields to Decimal (Numeric(18,6))

Revision ID: 4d9a58ecd93b
Revises: acadd4bc6806
Create Date: 2025-07-25
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "4d9a58ecd93b"
down_revision = "acadd4bc6806"
branch_labels = None
depends_on = None

# (table, column) pairs to migrate
COLUMNS = [
    # manual_trades
    ("manual_trades", "size"),
    ("manual_trades", "entry_price"),
    ("manual_trades", "exit_price"),
    ("manual_trades", "pnl"),
    # trades
    ("trades", "fxRateToBase"),
    ("trades", "quantity"),
    ("trades", "tradePrice"),
    ("trades", "tradeMoney"),
    ("trades", "proceeds"),
    ("trades", "taxes"),
    ("trades", "ibCommission"),
    ("trades", "netCash"),
    ("trades", "closePrice"),
    ("trades", "cost"),
    ("trades", "fifoPnlRealized"),
    ("trades", "mtmPnl"),
    ("trades", "origTradePrice"),
    ("trades", "changeInPrice"),
    ("trades", "changeInQuantity"),
    ("trades", "accruedInt"),
    ("trades", "fineness"),
    ("trades", "weight"),
    # daily_summaries
    ("daily_summaries", "total_pnl"),
    ("daily_summaries", "win_rate"),
    ("daily_summaries", "avg_win"),
    ("daily_summaries", "avg_loss"),
    # ndx1m
    ("ndx1m", "open"),
    ("ndx1m", "high"),
    ("ndx1m", "low"),
    ("ndx1m", "close"),
    # daily_bars
    ("daily_bars", "open"),
    ("daily_bars", "high"),
    ("daily_bars", "low"),
    ("daily_bars", "close"),
    # executions
    ("executions", "shares"),
    ("executions", "price"),
    ("executions", "avgPrice"),
    ("executions", "cumQty"),
    ("executions", "commission"),
    ("executions", "realizedPNL"),
    # matched_trades
    ("matched_trades", "open_price"),
    ("matched_trades", "close_price"),
    ("matched_trades", "pnl"),
    # trading_account_summaries
    ("trading_account_summaries", "net_liquidation"),
    ("trading_account_summaries", "total_cash"),
    # trading_positions
    ("trading_positions", "amount"),
    ("trading_positions", "avg_cost"),
    # finance_snapshots
    ("finance_snapshots", "net_worth"),
    ("finance_snapshots", "total_assets"),
    ("finance_snapshots", "total_liabilities"),
    # dividend_positions
    ("dividend_positions", "shares"),
    # dividend_ticker_data
    ("dividend_ticker_data", "price"),
    ("dividend_ticker_data", "dividend_yield"),
    ("dividend_ticker_data", "dividend_rate"),
    ("dividend_ticker_data", "dgr_3y"),
    ("dividend_ticker_data", "dgr_5y"),
    ("dividend_ticker_data", "previous_close"),
    # insurance_policies
    ("insurance_policies", "monthly_premium"),
    # option_contracts
    ("option_contracts", "strike"),
    # historical_option_bars
    ("historical_option_bars", "open"),
    ("historical_option_bars", "high"),
    ("historical_option_bars", "low"),
    ("historical_option_bars", "close"),
    ("historical_option_bars", "implied_vol"),
    ("historical_option_bars", "delta"),
    ("historical_option_bars", "gamma"),
    ("historical_option_bars", "theta"),
    ("historical_option_bars", "vega"),
    ("historical_option_bars", "underlying_price"),
    # backtest_runs
    ("backtest_runs", "initial_capital"),
    ("backtest_runs", "final_equity"),
    ("backtest_runs", "total_realized_pnl"),
    ("backtest_runs", "total_unrealized_pnl"),
    # backtest_trades
    ("backtest_trades", "quantity"),
    ("backtest_trades", "price"),
    ("backtest_trades", "commission"),
]


def upgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            type_=sa.Numeric(18, 6),
            existing_type=sa.Float(),
            postgresql_using=f"{col}::numeric(18,6)",
        )


def downgrade() -> None:
    for table, col in COLUMNS:
        op.alter_column(
            table,
            col,
            type_=sa.Float(),
            existing_type=sa.Numeric(18, 6),
            postgresql_using=f"{col}::double precision",
        )
