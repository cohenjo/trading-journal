from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import logging
import os

from ib_async import IB, ExecutionFilter
from app.schema.trading_models import TradingAccountConfig, TradingAccountSummary, TradingPosition
from sqlmodel import Session, select, delete

logger = logging.getLogger(__name__)
ZERO = Decimal("0")


def _decimal_from_broker(value: object) -> Decimal:
    """Convert broker numeric payloads to Decimal without binary float math."""

    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return ZERO


def _convert_decimal_currency(amount: Decimal, from_curr: str, to_curr: str) -> Decimal:
    """Convert a Decimal amount using the legacy fixed currency-rate table."""

    from app.utils.currency import RATES

    from_rate = Decimal(str(RATES.get((from_curr or "").upper(), 1)))
    to_rate = Decimal(str(RATES.get((to_curr or "").upper(), 1)))
    if to_rate == ZERO:
        return ZERO
    return (amount * from_rate) / to_rate


class TradingService:
    def __init__(self):
        self.ib = IB()

    async def get_configs(self, db: Session) -> List[TradingAccountConfig]:
        statement = select(TradingAccountConfig)
        return db.exec(statement).all()

    async def get_config(self, db: Session, config_id: Optional[int] = None) -> Optional[TradingAccountConfig]:
        if config_id:
            return db.get(TradingAccountConfig, config_id)
        statement = select(TradingAccountConfig).limit(1)
        return db.exec(statement).first()

    def _ib_host(self, config: TradingAccountConfig) -> str:
        return os.getenv("IB_GATEWAY_HOST") or os.getenv("IB_HOST") or config.host or "127.0.0.1"

    def _ib_port(self, config: TradingAccountConfig) -> int:
        raw_port = os.getenv("IB_GATEWAY_PORT") or os.getenv("IB_PORT") or config.port or 4002
        try:
            return int(raw_port)
        except (TypeError, ValueError):
            logger.warning("Invalid IB gateway port %r; using 4002", raw_port)
            return 4002

    async def connect_ibkr(self, config: TradingAccountConfig):
        host = self._ib_host(config)
        port = self._ib_port(config)
        if not self.ib.isConnected():
            logger.info("Connecting to IBKR at %s:%s with clientId=%s...", host, port, config.client_id)
            await self.ib.connectAsync(host, port, clientId=config.client_id, timeout=20)

            if not config.account_id:
                accounts = self.ib.managedAccounts()
                if accounts:
                    config.account_id = accounts[0]
        return self.ib

    async def disconnect_ibkr(self):
        if self.ib.isConnected():
            self.ib.disconnect()

    async def sync_account(self, db: Session, household_id: UUID, config_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Triggers sync for a specific account or the first one found.
        """
        config = await self.get_config(db, config_id)
        if not config:
            raise Exception("No trading account configured")

        if config.account_type in ("IBKR", "ibkr"):
            return await self.sync_ibkr(db, config, household_id)
        elif config.account_type in ("SCHWAB", "schwab"):
            return await self.sync_schwab(db, config, household_id)
        else:
            raise Exception(f"Unsupported account type: {config.account_type}")

    async def sync_all_configured_accounts(self, db: Session) -> Dict[str, Any]:
        """Sync every household-scoped account configuration for the worker batch."""

        configs = db.exec(select(TradingAccountConfig)).all()
        results: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []

        for config in configs:
            if not config.household_id:
                logger.warning("Skipping trading account %s without household_id", config.id)
                continue
            try:
                results.append(await self.sync_account(db, config.household_id, config_id=config.id))
            except Exception as exc:  # noqa: BLE001 - one account must not crash the scheduler
                logger.exception("Trading sync failed for account config %s", config.id)
                db.rollback()
                failures.append({"account": config.name, "error": str(exc)})

        return {"status": "success" if not failures else "partial", "synced": results, "failed": failures}

    async def sync_ibkr(self, db: Session, config: TradingAccountConfig, household_id: UUID) -> Dict[str, Any]:
        try:
            await self.connect_ibkr(config)

            synced_at = datetime.now(timezone.utc)
            previous_sync = config.last_synced_at or config.last_synced
            summary_data = await self.ib.accountSummaryAsync()
            net_liq = ZERO
            total_cash = ZERO
            currency = "USD"

            for item in summary_data:
                if item.tag == "NetLiquidation":
                    net_liq = _decimal_from_broker(item.value)
                    currency = item.currency
                elif item.tag == "TotalCashValue":
                    total_cash = _decimal_from_broker(item.value)

            db.add(
                TradingAccountSummary(
                    account_config_id=config.id,
                    net_liquidation=net_liq,
                    total_cash=total_cash,
                    currency=currency,
                    timestamp=synced_at,
                    household_id=household_id,
                )
            )

            positions_data = self.ib.positions()
            db.exec(
                delete(TradingPosition)
                .where(TradingPosition.account_config_id == config.id)
                .where(TradingPosition.household_id == household_id)
            )

            for p in positions_data:
                contract = p.contract
                db.add(
                    TradingPosition(
                        account_config_id=config.id,
                        symbol=contract.symbol,
                        amount=_decimal_from_broker(p.position),
                        sec_type=contract.secType,
                        avg_cost=_decimal_from_broker(p.avgCost),
                        con_id=contract.conId,
                        timestamp=synced_at,
                        household_id=household_id,
                    )
                )

            executions_count = await self._sync_ibkr_executions(db, previous_sync, household_id)
            config.last_synced = synced_at
            config.last_synced_at = synced_at
            db.add(config)
            db.commit()

            annual_dividend_income = ZERO
            try:
                from app.schema.dividend_models import DividendTickerData, DividendAccount, DividendPosition

                stk_positions = [p for p in positions_data if p.contract.secType == "STK"]
                tickers = [p.contract.symbol for p in stk_positions]

                if config.linked_account_id:
                    stmt = (
                        select(DividendAccount)
                        .where(DividendAccount.linked_id == config.linked_account_id)
                        .where(DividendAccount.household_id == household_id)
                    )
                    div_accounts = db.exec(stmt).all()

                    for da in div_accounts:
                        db.exec(delete(DividendPosition).where(DividendPosition.account == da.name))
                        for p in stk_positions:
                            db.add(
                                DividendPosition(
                                    account=da.name,
                                    ticker=p.contract.symbol,
                                    shares=_decimal_from_broker(abs(p.position)),
                                )
                            )
                        logger.info(
                            "Synced %s positions to Dividend Dashboard account: %s", len(stk_positions), da.name
                        )
                    db.commit()

                if tickers:
                    stmt = select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))
                    ticker_map = {td.ticker: td for td in db.exec(stmt).all()}

                    for p in stk_positions:
                        symbol = p.contract.symbol
                        if symbol in ticker_map:
                            td = ticker_map[symbol]
                            income = _decimal_from_broker(abs(p.position)) * _decimal_from_broker(td.dividend_rate)
                            annual_dividend_income += _convert_decimal_currency(income, td.currency, currency)

                logger.info(
                    "Calculated annual dividend income for %s: %s %s", config.name, annual_dividend_income, currency
                )
            except Exception as e:
                logger.error("Failed to sync dividend data: %s", e, exc_info=True)

            if config.linked_account_id:
                try:
                    extra_updates = {
                        "dividend_fixed_amount": str(annual_dividend_income),
                        "dividend_mode": "Fixed",
                    }
                    await self._update_finance_snapshot(
                        db, config.linked_account_id, household_id, str(net_liq), extra_updates
                    )
                except Exception as e:
                    logger.error("Failed to update finance snapshot for IBKR sync: %s", e)

            return {
                "status": "success",
                "account": config.name,
                "summary": {"net_liquidation": str(net_liq), "total_cash": str(total_cash), "currency": currency},
                "positions_count": len(positions_data),
                "executions_count": executions_count,
                "last_synced_at": config.last_synced_at.isoformat(),
                "dividend_income": str(annual_dividend_income),
            }
        finally:
            await self.disconnect_ibkr()

    async def _sync_ibkr_executions(
        self,
        db: Session,
        since: datetime | None,
        household_id: UUID,
    ) -> int:
        """Best-effort sync of IB executions since the last account refresh."""

        from app.schema.models import Execution

        exec_filter = ExecutionFilter()
        if since:
            exec_filter.time = since.strftime("%Y%m%d %H:%M:%S")

        try:
            executions = await self.ib.reqExecutionsAsync(exec_filter)
        except Exception as exc:  # noqa: BLE001 - executions are not critical to account freshness
            logger.warning("IB execution sync skipped: %s", exc)
            return 0

        count = 0
        for exec_detail in executions:
            execution = getattr(exec_detail, "execution", None)
            contract = getattr(exec_detail, "contract", None)
            commission_report = getattr(exec_detail, "commissionReport", None)
            exec_id = getattr(execution, "execId", None)
            if not execution or not contract or not exec_id:
                continue

            record = db.get(Execution, exec_id)
            if record is None:
                record = Execution(
                    execId=exec_id,
                    permId=getattr(execution, "permId", 0),
                    orderId=getattr(execution, "orderId", 0),
                    clientId=getattr(execution, "clientId", 0),
                    time=getattr(execution, "time", datetime.now(timezone.utc)),
                    acctNumber=getattr(execution, "acctNumber", ""),
                    exchange=getattr(execution, "exchange", ""),
                    side=getattr(execution, "side", ""),
                    shares=_decimal_from_broker(getattr(execution, "shares", 0)),
                    price=_decimal_from_broker(getattr(execution, "price", 0)),
                    avgPrice=_decimal_from_broker(getattr(execution, "avgPrice", 0)),
                    cumQty=_decimal_from_broker(getattr(execution, "cumQty", 0)),
                    symbol=getattr(contract, "symbol", ""),
                    commission=_decimal_from_broker(getattr(commission_report, "commission", 0)),
                    currency=getattr(commission_report, "currency", "USD"),
                    realizedPNL=_decimal_from_broker(getattr(commission_report, "realizedPNL", 0)),
                )
            record.household_id = household_id
            db.add(record)
            count += 1
        return count

    async def _update_finance_snapshot(
        self, db: Session, linked_id: str, household_id: UUID, new_value: object, extra_updates: Optional[Dict] = None
    ):
        """
        Updates a specific item in the latest finance snapshot and recalculates totals.
        """
        from app.schema.finance_models import FinanceSnapshot

        statement = (
            select(FinanceSnapshot)
            .where(FinanceSnapshot.household_id == household_id)
            .order_by(FinanceSnapshot.date.desc())
            .limit(1)
        )
        snapshot = db.exec(statement).first()

        if not snapshot or not snapshot.data or "items" not in snapshot.data:
            logger.warning(f"No finance snapshot found to update linked account {linked_id}")
            return

        items = snapshot.data["items"]
        updated = False

        for item in items:
            if item.get("id") == linked_id:
                item["value"] = new_value
                if extra_updates:
                    if "details" not in item:
                        item["details"] = {}
                    item["details"].update(extra_updates)
                updated = True
                break

        if updated:
            # Recalculate totals
            from app.utils.currency import convert_currency

            total_savings = 0.0
            total_investments = 0.0
            total_assets = 0.0
            total_liabilities = 0.0

            # Use fixed base currency for snapshot totals (ILS)
            base_curr = snapshot.data.get("mainCurrency", "ILS")

            for item in items:
                val = float(item.get("value", 0))
                item_curr = item.get("currency", "USD")  # Default to USD if missing, but usually present

                # Convert value to base currency for totals
                val_base = convert_currency(val, item_curr, base_curr)

                cat = item.get("category")

                if cat == "Savings":
                    total_savings += val_base
                elif cat == "Investments":
                    total_investments += val_base

                if cat == "Liabilities" or cat == "Debt":
                    total_liabilities += val_base
                else:
                    total_assets += val_base

            snapshot.total_assets = total_assets
            snapshot.total_liabilities = total_liabilities
            snapshot.net_worth = total_assets - total_liabilities

            # Update the JSON data too
            snapshot.data["total_savings"] = total_savings
            snapshot.data["total_investments"] = total_investments
            snapshot.data["total_assets"] = total_assets
            snapshot.data["total_liabilities"] = total_liabilities
            snapshot.data["net_worth"] = snapshot.net_worth

            # Re-assign to trigger mutation detection and use flag_modified
            from sqlalchemy.orm.attributes import flag_modified

            snapshot.data = dict(snapshot.data)
            flag_modified(snapshot, "data")

            db.add(snapshot)
            db.commit()
            logger.info(
                f"Updated finance snapshot item {linked_id} to {new_value} {item_curr}. Totals updated in {base_curr}."
            )

    async def sync_schwab(self, db: Session, config: TradingAccountConfig, household_id: UUID) -> Dict[str, Any]:
        """
        Implements Schwab sync using schwab-py.
        """
        from schwab.auth import client_from_token_file

        try:
            # Note: schwab-py is synchronous in many parts or uses its own pattern.
            # We assume tokens_path is managed/populated by user.
            client = client_from_token_file(config.tokens_path, config.app_key, config.app_secret)

            # Fetch Account Details
            # get_account_details returns a Response object
            resp = client.get_account_details(config.account_hash, fields=client.Account.Fields.POSITIONS)
            if not resp.ok:
                raise Exception(f"Schwab API error: {resp.status_code} - {resp.text}")

            data = resp.json()
            securities_account = data.get("securitiesAccount", {})

            # 1. Summary
            net_liq = float(securities_account.get("currentBalances", {}).get("liquidationValue", 0.0))
            total_cash = float(securities_account.get("currentBalances", {}).get("cashBalance", 0.0))
            currency = "USD"  # Schwab is typically USD

            new_summary = TradingAccountSummary(
                account_config_id=config.id,
                net_liquidation=net_liq,
                total_cash=total_cash,
                currency=currency,
                timestamp=datetime.utcnow(),
                household_id=household_id,
            )
            db.add(new_summary)

            # 2. Positions
            schwab_positions = securities_account.get("positions", [])
            db.exec(
                delete(TradingPosition)
                .where(TradingPosition.account_config_id == config.id)
                .where(TradingPosition.household_id == household_id)
            )

            count = 0
            for p in schwab_positions:
                instrument = p.get("instrument", {})
                symbol = instrument.get("symbol")
                asset_type = instrument.get("assetType")  # e.g. EQUITY

                # Normalize asset type to match IBKR's 'STK', 'OPT', etc if possible
                sec_type = "STK" if asset_type == "EQUITY" else asset_type

                new_pos = TradingPosition(
                    account_config_id=config.id,
                    symbol=symbol,
                    amount=float(p.get("longQuantity", 0.0)) or float(p.get("shortQuantity", 0.0)),
                    sec_type=sec_type,
                    avg_cost=float(p.get("averagePrice", 0.0)),
                    timestamp=datetime.utcnow(),
                    household_id=household_id,
                )
                db.add(new_pos)
                count += 1

            config.last_synced = datetime.utcnow()
            db.add(config)
            db.commit()

            return {
                "status": "success",
                "account": config.name,
                "summary": {"net_liquidation": net_liq, "total_cash": total_cash, "currency": currency},
                "positions_count": count,
                "last_synced": config.last_synced.isoformat(),
            }
        except Exception as e:
            logger.error(f"Schwab sync failed: {str(e)}")
            raise e

    async def sync_to_dividends(self, db: Session, household_id: UUID) -> Dict[str, Any]:
        """
        Propagates STK positions from ALL trading accounts to their linked DividendAccounts.
        """
        from app.schema.dividend_models import DividendAccount, DividendPosition

        configs = await self.get_configs(db)
        synced_accounts = []
        total_positions = 0

        for config in configs:
            if not config.linked_account_id:
                continue

            # Find DividendAccount for this household
            statement = (
                select(DividendAccount)
                .where(DividendAccount.linked_id == config.linked_account_id)
                .where(DividendAccount.household_id == household_id)
            )
            div_account = db.exec(statement).first()
            if not div_account:
                continue

            # Get positions for THIS account and household
            statement = select(TradingPosition).where(
                TradingPosition.account_config_id == config.id,
                TradingPosition.household_id == household_id,
                TradingPosition.sec_type == "STK",
            )
            trading_positions = db.exec(statement).all()

            if trading_positions:
                # Clear existing in THAT div account
                db.exec(delete(DividendPosition).where(DividendPosition.account == div_account.name))
                for tp in trading_positions:
                    new_dp = DividendPosition(account=div_account.name, ticker=tp.symbol, shares=tp.amount)
                    db.add(new_dp)

                synced_accounts.append(div_account.name)
                total_positions += len(trading_positions)

        db.commit()
        return {
            "status": "success",
            "message": f"Synced {total_positions} positions across {len(synced_accounts)} accounts: {', '.join(synced_accounts)}",
            "count": total_positions,
        }

    async def get_latest_summary(self, db: Session) -> Dict[str, Any]:
        statement = select(TradingAccountSummary).order_by(TradingAccountSummary.timestamp.desc()).limit(1)
        summary = db.exec(statement).first()
        if not summary:
            return {"net_liquidation": 0.0, "total_cash": 0.0, "currency": "USD"}

        return {
            "net_liquidation": summary.net_liquidation,
            "total_cash": summary.total_cash,
            "currency": summary.currency,
            "timestamp": summary.timestamp.isoformat(),
        }

    async def get_latest_positions(self, db: Session) -> List[Dict[str, Any]]:
        statement = select(TradingPosition).order_by(TradingPosition.symbol)
        positions = db.exec(statement).all()
        return [
            {
                "symbol": p.symbol,
                "amount": p.amount,
                "type": p.sec_type,
                "avgCost": p.avg_cost,
                "conId": p.con_id,
                "timestamp": p.timestamp.isoformat(),
            }
            for p in positions
        ]


# Singleton instance
trading_service = TradingService()
