import time
import yfinance as yf
from datetime import datetime, timedelta
from typing import List, Dict, Any
from sqlmodel import Session, select
from app.schema.dividend_models import (
    DividendPosition,
    DividendPositionCreate,
    DividendPositionStats,
    DividendDashboardStats,
    DividendTickerData
)
from app.utils.currency import normalize_currency, convert_currency
from opentelemetry import trace, metrics
import logging

logger = logging.getLogger(__name__)

tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# Metrics
ticker_update_counter = meter.create_counter(
    "dividend.ticker_updates",
    description="Number of dividend ticker data updates performed"
)
enrich_duration_histogram = meter.create_histogram(
    "dividend.enrich_duration",
    unit="ms",
    description="Duration of position enrichment"
)

def get_all_positions(db: Session, account: str = None) -> List[DividendPosition]:
    statement = select(DividendPosition).order_by(DividendPosition.ticker)
    if account:
        statement = statement.where(DividendPosition.account == account)
    return db.exec(statement).all()

def create_position(db: Session, position: DividendPositionCreate) -> DividendPosition:
    db_position = DividendPosition.from_orm(position)
    db.add(db_position)
    db.commit()
    db.refresh(db_position)
    return db_position

def update_position(db: Session, position_id: int, updates: DividendPositionCreate) -> DividendPosition:
    db_position = db.get(DividendPosition, position_id)
    if not db_position:
        return None
    
    db_position.account = updates.account
    db_position.ticker = updates.ticker
    db_position.shares = updates.shares
    db.add(db_position)
    db.commit()
    db.refresh(db_position)
    return db_position

def delete_position(db: Session, position_id: int) -> bool:
    db_position = db.get(DividendPosition, position_id)
    if not db_position:
        return False
    db.delete(db_position)
    db.commit()
    return True

def calculate_cagr(start_val: float, end_val: float, years: int) -> float:
    if start_val == 0 or years == 0:
        return 0.0
    return (end_val / start_val) ** (1 / years) - 1

def get_market_data_batch(tickers: List[str], db: Session) -> Dict[str, DividendTickerData]:
    with tracer.start_as_current_span("get_market_data_batch") as span:
        span.set_attribute("tickers_count", len(tickers))
        
        # 1. Load existing from DB
        stmt = select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))
        existing_data = db.exec(stmt).all()
        cache_map = {d.ticker: d for d in existing_data}
        
        return cache_map

def resolve_dividend_data(ticker: str, info: dict, divs: Any, price: float, is_sub: bool) -> tuple:
    """
    Robustly resolve dividend_rate and dividend_yield from multiple sources.
    Handles annualization and sanity checks for periodic payments.
    """
    div_rate = 0.0
    div_yield = 0.0
    
    # 1. Gather all potential rates
    info_rate = info.get('dividendRate')
    trailing_rate = info.get('trailingAnnualDividendRate')
    info_yield = info.get('dividendYield')  # Usually a decimal like 0.035
    
    # Calculate TTM from history
    ttm_rate = 0.0
    if divs is not None and not divs.empty:
        try:
            # Ensure index is timezone-aware if needed
            cutoff = datetime.now(divs.index.tz) if divs.index.tz else datetime.now()
            cutoff -= timedelta(days=366)
            ttm_rate = divs[divs.index > cutoff].sum()
            
            # Sub-currency heuristic for TTM
            if is_sub and price > 0 and (ttm_rate / price) > 0.5:
                ttm_rate = ttm_rate / 100.0
        except Exception as e:
            logger.debug(f"TTM calculation failed for {ticker}: {e}")

    # 2. Candidate evaluation
    candidates = []
    if info_rate and info_rate > 0:
        # Heuristic: Detect if info_rate is periodic (single payment) instead of annual
        if price > 0:
             current_yield_detect = info_rate / price
             # If reported yield < 2.5% BUT TTM implies > 4%, info_rate is likely periodic
             if current_yield_detect < 0.025 and (ttm_rate / price) > 0.04:
                  candidates.append(info_rate * 4)   # Quarterly
                  candidates.append(info_rate * 12)  # Monthly
             
             # Also handle sub-currency here if info_rate is still in pence but price in GBP
             if is_sub and current_yield_detect > 0.5:
                  candidates.append(info_rate / 100.0)
             else:
                  candidates.append(info_rate)
        else:
            candidates.append(info_rate)
             
    if trailing_rate and trailing_rate > 0:
        candidates.append(trailing_rate)
    if ttm_rate and ttm_rate > 0:
        candidates.append(ttm_rate)
        
    # Reference yield for picking the best candidate
    target_yield = info_yield if (info_yield and info_yield > 0) else 0.0
    
    if candidates:
        if target_yield > 0 and price > 0:
            # Pick candidate that produces yield closest to info_yield
            div_rate = min(candidates, key=lambda x: abs((x/price) - target_yield))
        else:
            # Fallback: pick the maximum plausible rate (to avoid periodic under-reporting)
            # Cap at 25% yield to filtered out erroneous spikes
            plausible = [c for c in candidates if price > 0 and (c/price) < 0.25]
            if plausible:
                div_rate = max(plausible)
            else:
                div_rate = max(candidates) if candidates else 0.0

    # 3. Final Yield Calculation
    if div_rate > 0 and price > 0:
        div_yield = div_rate / price
    elif target_yield > 0:
        div_yield = target_yield
        div_rate = div_yield * price
        
    return float(div_rate), float(div_yield)

def update_dividend_cache_background(tickers: List[str]):
    """
    Background job to refresh ticker data (Fundamentals + Prices).
    Calls yfinance with robustness and retries.
    """
    from app.dal.database import engine
    
    with Session(engine) as db:
        with tracer.start_as_current_span("update_dividend_cache_background") as span:
            span.set_attribute("tickers_count", len(tickers))
            logger.info(f"Starting background cache update for {len(tickers)} tickers")
            
            # 1. Identify what needs update
            stmt = select(DividendTickerData).where(DividendTickerData.ticker.in_(tickers))
            existing_data = db.exec(stmt).all()
            cache_map = {d.ticker: d for d in existing_data}
            
            cutoff_fundamentals = datetime.now() - timedelta(hours=24)
            cutoff_price = datetime.now() - timedelta(minutes=15)
            
            to_update_fundamentals = []
            to_update_price = []
            
            for t in tickers:
                if t not in cache_map:
                    to_update_fundamentals.append(t)
                    to_update_price.append(t)
                else:
                    if cache_map[t].last_updated < cutoff_fundamentals:
                        to_update_fundamentals.append(t)
                    if cache_map[t].last_updated < cutoff_price:
                        to_update_price.append(t)

            # 2. Update Fundamentals (with retry for flakiness)
            if to_update_fundamentals:
                ticker_update_counter.add(len(to_update_fundamentals))
                try:
                    # Fetch in batch first
                    batch = yf.Tickers(" ".join(to_update_fundamentals))
                    
                    for t in to_update_fundamentals:
                        try:
                            ticker_obj = batch.tickers.get(t)
                            
                            # FLAKINESS RETRY: If info is empty in batch, try single fetch
                            try:
                                if not ticker_obj or not ticker_obj.info or len(ticker_obj.info) < 5:
                                    logger.info(f"Batch info for {t} looks empty, retrying single fetch")
                                    ticker_obj = yf.Ticker(t)
                            except:
                                ticker_obj = yf.Ticker(t)

                            # A. Price & Currency
                            price = 0.0
                            try: price = ticker_obj.fast_info.last_price or 0.0
                            except: pass
                            
                            raw_curr = "USD"
                            try: raw_curr = ticker_obj.fast_info.currency or ticker_obj.info.get('currency') or "USD"
                            except: pass

                            # B. Sub-currency logic
                            curr_upper = raw_curr.upper()
                            is_sub = (raw_curr in ['GBp', 'GBX', 'ILA', 'ZAc', 'ZAX'] or 
                                     curr_upper in ['GBX', 'ILA', 'ZAC'] or
                                     (curr_upper in ['GBP', 'ILS', 'ZAR'] and price > 500))
                            
                            if is_sub:
                                price = price / 100.0

                            # C. Robust Dividend Resolution
                            div_rate, div_yield = resolve_dividend_data(
                                t, ticker_obj.info, ticker_obj.dividends, price, is_sub
                            )

                            # D. DGR Calculation
                            dgr_3y, dgr_5y = 0.0, 0.0
                            try:
                                divs = ticker_obj.dividends
                                if not divs.empty:
                                    annual_divs = divs.groupby(divs.index.year).sum()
                                    if is_sub and price > 0 and (divs.iloc[0] / price) > 0.5:
                                        annual_divs = annual_divs / 100.0
                                    
                                    current_year = datetime.now().year
                                    full_years = annual_divs[annual_divs.index < current_year]
                                    if len(full_years) >= 4:
                                        dgr_3y = calculate_cagr(full_years.iloc[-4], full_years.iloc[-1], 3)
                                    if len(full_years) >= 6:
                                        dgr_5y = calculate_cagr(full_years.iloc[-6], full_years.iloc[-1], 5)
                            except: pass

                            # E. Save to DB
                            currency = normalize_currency(raw_curr, t)
                            if t in cache_map:
                                item = cache_map[t]
                                item.last_updated = datetime.now()
                                item.price = float(price); item.currency = currency
                                item.dividend_yield = float(div_yield); item.dividend_rate = float(div_rate)
                                item.dgr_3y = float(dgr_3y); item.dgr_5y = float(dgr_5y)
                                item.previous_close = float(ticker_obj.info.get('previousClose', 0.0))
                                db.add(item)
                            else:
                                item = DividendTickerData(
                                    ticker=t, last_updated=datetime.now(),
                                    price=float(price), currency=currency,
                                    dividend_yield=float(div_yield), dividend_rate=float(div_rate),
                                    dgr_3y=float(dgr_3y), dgr_5y=float(dgr_5y),
                                    previous_close=float(ticker_obj.info.get('previousClose', 0.0))
                                )
                                db.add(item)
                                cache_map[t] = item
                        except Exception as e:
                            logger.error(f"Failed to update fundamentals for {t}: {e}")
                    db.commit()
                except Exception as e:
                    logger.error(f"Batch update failed: {e}")

            # 3. Update stale Prices (Lite)
            to_update_price = [t for t in to_update_price if t not in to_update_fundamentals]
            if to_update_price:
                try:
                    with tracer.start_as_current_span("fetch_live_prices_background") as live_span:
                        live_span.set_attribute("tickers_count", len(to_update_price))
                        full_batch = yf.Tickers(" ".join(to_update_price))
                        for t in to_update_price:
                             if t in full_batch.tickers:
                                 try:
                                     ticker_obj = full_batch.tickers[t]
                                     live_price = ticker_obj.fast_info.last_price
                                     if live_price:
                                         data_obj = cache_map.get(t)
                                         if data_obj:
                                             if data_obj.currency == 'ILS' and (ticker_obj.fast_info.currency == 'ILA' or t.endswith('.TA')):
                                                  live_price = live_price / 100.0
                                             data_obj.last_updated = datetime.now()
                                             data_obj.price = float(live_price)
                                             db.add(data_obj)
                                 except Exception as e:
                                     logger.error(f"Price update error for {t}: {e}")
                        db.commit()
                except Exception as e:
                    logger.error(f"Failed to fetch live prices in background: {e}")
            logger.info("Background cache update complete")

def enrich_positions(positions: List[DividendPosition], db: Session, target_currency: str = "USD") -> Dict[str, any]:
    """
    Enrich positions using cached fundamentals + live prices.
    Converts global stats to target_currency.
    """
    if not positions:
        return {
            "stats": DividendDashboardStats(portfolio_yield=0, annual_income=0, dgr_5y=0, currency=target_currency),
            "positions": []
        }

    with tracer.start_as_current_span("enrich_positions") as span:
        span.set_attribute("positions_count", len(positions))
        span.set_attribute("target_currency", target_currency)
        logger.info(f"Enriching {len(positions)} positions, target_currency={target_currency}")
        start_time = time.time()
        
        # Unique tickers
        unique_tickers = list(set(p.ticker for p in positions))
        
        # Batch Get
        market_data_map = get_market_data_batch(unique_tickers, db)
        
        enriched_positions: List[DividendPositionStats] = []
        
        total_value_target = 0.0
        total_annual_income_target = 0.0
        dgr_5y_accum = 0.0
        valid_dgr_count = 0
    
        for pos in positions:
            data = market_data_map.get(pos.ticker)
            
            # Default zero if missing
            price = 0.0
            currency = "USD"
            div_rate = 0.0
            div_yield = 0.0
            dgr_3y = 0.0
            dgr_5y = 0.0
            
            if data:
                price = data.price
                currency = data.currency
                div_rate = data.dividend_rate
                div_yield = data.dividend_yield
                dgr_3y = data.dgr_3y
                dgr_5y = data.dgr_5y
                
            annual_income_local = pos.shares * div_rate
            position_value_local = pos.shares * price
            
            # Accumulate totals in Target Currency
            total_value_target += convert_currency(position_value_local, currency, target_currency)
            total_annual_income_target += convert_currency(annual_income_local, currency, target_currency)
            
            if dgr_5y != 0:
                dgr_5y_accum += dgr_5y
                valid_dgr_count += 1
    
            enriched_positions.append(DividendPositionStats(
                id=pos.id,
                account=pos.account,
                ticker=pos.ticker,
                shares=pos.shares,
                price=round(price, 2),
                dividend_yield=div_yield, 
                annual_income=round(annual_income_local, 2),
                currency=currency,
                dgr_3y=dgr_3y,
                dgr_5y=dgr_5y
            ))
    
        portfolio_yield = (total_annual_income_target / total_value_target) if total_value_target > 0 else 0.0
        avg_dgr_5y = (dgr_5y_accum / valid_dgr_count) if valid_dgr_count > 0 else 0.0
        
        end_time = time.time()
        duration_ms = (end_time - start_time) * 1000
        enrich_duration_histogram.record(duration_ms)
    
        return {
            "stats": DividendDashboardStats(
                portfolio_yield=portfolio_yield,
                annual_income=round(total_annual_income_target, 2),
                dgr_5y=avg_dgr_5y,
                currency=target_currency
            ),
            "positions": enriched_positions
        }
