import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
from ib_async import IB, Stock, Option, Index, Bond, Contract
from app.schema.trading_models import TradingAccountConfig, TradingAccountSummary, TradingPosition
from sqlmodel import Session, select, delete
import logging

logger = logging.getLogger(__name__)

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

    async def connect_ibkr(self, config: TradingAccountConfig):
        if not self.ib.isConnected():
            logger.info(f"Connecting to IBKR at {config.host}:{config.port} with clientId={config.client_id}...")
            await self.ib.connectAsync(config.host, config.port, clientId=config.client_id, timeout=20)
            
            if not config.account_id:
                accounts = self.ib.managedAccounts()
                if accounts: config.account_id = accounts[0]
        return self.ib

    async def disconnect_ibkr(self):
        if self.ib.isConnected():
            self.ib.disconnect()

    async def sync_account(self, db: Session, config_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Triggers sync for a specific account or the first one found.
        """
        config = await self.get_config(db, config_id)
        if not config:
            raise Exception("No trading account configured")

        if config.account_type == "IBKR":
            return await self.sync_ibkr(db, config)
        elif config.account_type == "SCHWAB":
            return await self.sync_schwab(db, config)
        else:
            raise Exception(f"Unsupported account type: {config.account_type}")

    async def sync_ibkr(self, db: Session, config: TradingAccountConfig) -> Dict[str, Any]:
        try:
            await self.connect_ibkr(config)
            
            summary_data = await self.ib.accountSummaryAsync()
            net_liq = 0.0
            total_cash = 0.0
            currency = "USD"
            
            for item in summary_data:
                if item.tag == "NetLiquidation":
                    net_liq = float(item.value)
                    currency = item.currency
                elif item.tag == "TotalCashValue":
                    total_cash = float(item.value)
            
            new_summary = TradingAccountSummary(
                account_config_id=config.id,
                net_liquidation=net_liq,
                total_cash=total_cash,
                currency=currency,
                timestamp=datetime.utcnow()
            )
            db.add(new_summary)

            positions_data = self.ib.positions()
            # Clear old positions for THIS account
            db.exec(delete(TradingPosition).where(TradingPosition.account_config_id == config.id))
            
            for p in positions_data:
                contract = p.contract
                new_pos = TradingPosition(
                    account_config_id=config.id,
                    symbol=contract.symbol,
                    amount=p.position,
                    sec_type=contract.secType,
                    avg_cost=p.avgCost,
                    con_id=contract.conId,
                    timestamp=datetime.utcnow()
                )
                db.add(new_pos)
            
            config.last_synced = datetime.utcnow()
            db.add(config)
            db.commit()
            
            # 4. Update Dividend Dashboard and Propagate to Snapshot
            annual_dividend_income = 0.0
            try:
                from app.schema.dividend_models import DividendTickerData, DividendAccount, DividendPosition
                from app.utils.currency import convert_currency
                from sqlalchemy import delete
                
                # A. Get all STK positions for this account
                stk_positions = [p for p in positions_data if p.contract.secType == "STK"]
                tickers = [p.contract.symbol for p in stk_positions]
                
                # B. Sync to Dividend Positions table if linked
                if config.linked_account_id:
                    # Find dividend account(s) linked to the same FinanceItem
                    stmt = select(DividendAccount).where(DividendAccount.linked_id == config.linked_account_id)
                    div_accounts = db.exec(stmt).all()
                    
                    for da in div_accounts:
                        # Clear old positions for THIS dashboard account
                        db.exec(delete(DividendPosition).where(DividendPosition.account == da.name))
                        # Insert new ones
                        for p in stk_positions:
                            db.add(DividendPosition(
                                account=da.name,
                                ticker=p.contract.symbol,
                                shares=abs(p.position)
                            ))
                        logger.info(f"Synced {len(stk_positions)} positions to Dividend Dashboard account: {da.name}")
                    db.commit()

                # C. Calculate total annual income for the Snapshot updates
                if tickers:
                    stmt = select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))
                    ticker_data_list = db.exec(stmt).all()
                    ticker_map = {td.ticker: td for td in ticker_data_list}
                    
                    for p in stk_positions:
                        symbol = p.contract.symbol
                        if symbol in ticker_map:
                            td = ticker_map[symbol]
                            # Calc income: shares * rate. Convert to account currency.
                            income = abs(p.position) * td.dividend_rate
                            income_converted = convert_currency(income, td.currency, currency)
                            annual_dividend_income += income_converted
                            
                logger.info(f"Calculated annual dividend income for {config.name}: {annual_dividend_income} {currency}")
            except Exception as e:
                logger.error(f"Failed to sync dividend data: {e}", exc_info=True)

            # 5. Propagate totals to Finance Snapshot if linked
            if config.linked_account_id:
                try:
                    extra_updates = {
                        "dividend_fixed_amount": annual_dividend_income,
                        "dividend_mode": "Fixed"
                    }
                    await self._update_finance_snapshot(db, config.linked_account_id, net_liq, extra_updates)
                except Exception as e:
                    logger.error(f"Failed to update finance snapshot for IBKR sync: {e}")

            return {
                "status": "success",
                "account": config.name,
                "summary": {"net_liquidation": net_liq, "total_cash": total_cash, "currency": currency},
                "positions_count": len(positions_data),
                "last_synced": config.last_synced.isoformat(),
                "dividend_income": annual_dividend_income
            }
        finally:
            await self.disconnect_ibkr()

    async def _update_finance_snapshot(self, db: Session, linked_id: str, new_value: float, extra_updates: Optional[Dict] = None):
        """
        Updates a specific item in the latest finance snapshot and recalculates totals.
        """
        from app.schema.finance_models import FinanceSnapshot
        
        statement = select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)
        snapshot = db.exec(statement).first()
        
        if not snapshot or not snapshot.data or 'items' not in snapshot.data:
            logger.warning(f"No finance snapshot found to update linked account {linked_id}")
            return

        items = snapshot.data['items']
        updated = False
        
        for item in items:
            if item.get('id') == linked_id:
                item['value'] = new_value
                if extra_updates:
                    if 'details' not in item:
                        item['details'] = {}
                    item['details'].update(extra_updates)
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
            base_curr = snapshot.data.get('mainCurrency', 'ILS')
            
            for item in items:
                val = float(item.get('value', 0))
                item_curr = item.get('currency', 'USD') # Default to USD if missing, but usually present
                
                # Convert value to base currency for totals
                val_base = convert_currency(val, item_curr, base_curr)
                
                cat = item.get('category')
                
                if cat == 'Savings': total_savings += val_base
                elif cat == 'Investments': total_investments += val_base
                
                if cat == 'Liabilities' or cat == 'Debt':
                    total_liabilities += val_base
                else:
                    total_assets += val_base
            
            snapshot.total_assets = total_assets
            snapshot.total_liabilities = total_liabilities
            snapshot.net_worth = total_assets - total_liabilities
            
            # Update the JSON data too
            snapshot.data['total_savings'] = total_savings
            snapshot.data['total_investments'] = total_investments
            snapshot.data['total_assets'] = total_assets
            snapshot.data['total_liabilities'] = total_liabilities
            snapshot.data['net_worth'] = snapshot.net_worth
            
            # Re-assign to trigger mutation detection and use flag_modified
            from sqlalchemy.orm.attributes import flag_modified
            snapshot.data = dict(snapshot.data)
            flag_modified(snapshot, "data")
            
            db.add(snapshot)
            db.commit()
            logger.info(f"Updated finance snapshot item {linked_id} to {new_value} {item_curr}. Totals updated in {base_curr}.")

    async def sync_schwab(self, db: Session, config: TradingAccountConfig) -> Dict[str, Any]:
        """
        Implements Schwab sync using schwab-py.
        """
        import schwab
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
            securities_account = data.get('securitiesAccount', {})
            
            # 1. Summary
            net_liq = float(securities_account.get('currentBalances', {}).get('liquidationValue', 0.0))
            total_cash = float(securities_account.get('currentBalances', {}).get('cashBalance', 0.0))
            currency = "USD" # Schwab is typically USD
            
            new_summary = TradingAccountSummary(
                account_config_id=config.id,
                net_liquidation=net_liq,
                total_cash=total_cash,
                currency=currency,
                timestamp=datetime.utcnow()
            )
            db.add(new_summary)
            
            # 2. Positions
            schwab_positions = securities_account.get('positions', [])
            db.exec(delete(TradingPosition).where(TradingPosition.account_config_id == config.id))
            
            count = 0
            for p in schwab_positions:
                instrument = p.get('instrument', {})
                symbol = instrument.get('symbol')
                asset_type = instrument.get('assetType') # e.g. EQUITY
                
                # Normalize asset type to match IBKR's 'STK', 'OPT', etc if possible
                sec_type = "STK" if asset_type == "EQUITY" else asset_type
                
                new_pos = TradingPosition(
                    account_config_id=config.id,
                    symbol=symbol,
                    amount=float(p.get('longQuantity', 0.0)) or float(p.get('shortQuantity', 0.0)),
                    sec_type=sec_type,
                    avg_cost=float(p.get('averagePrice', 0.0)),
                    timestamp=datetime.utcnow()
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
                "last_synced": config.last_synced.isoformat()
            }
        except Exception as e:
            logger.error(f"Schwab sync failed: {str(e)}")
            raise e

    async def sync_to_dividends(self, db: Session) -> Dict[str, Any]:
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
                
            # Find DividendAccount
            statement = select(DividendAccount).where(DividendAccount.linked_id == config.linked_account_id)
            div_account = db.exec(statement).first()
            if not div_account: continue
            
            # Get positions for THIS account
            statement = select(TradingPosition).where(
                TradingPosition.account_config_id == config.id,
                TradingPosition.sec_type == "STK"
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
            "count": total_positions
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
            "timestamp": summary.timestamp.isoformat()
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
                "timestamp": p.timestamp.isoformat()
            }
            for p in positions
        ]

# Singleton instance
trading_service = TradingService()
