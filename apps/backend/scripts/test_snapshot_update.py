
import asyncio
import os
from sqlmodel import Session, create_engine, select
from app.schema.finance_models import FinanceSnapshot
from app.services.trading_service import TradingService

async def main():
    engine = create_engine(os.environ.get('DATABASE_URL', 'postgresql://user:password@localhost/trading_journal'))
    session = Session(engine)
    
    # Target linked_id for IBKR (set TRADING_LINKED_ID in env for local debugging)
    linked_id = os.environ.get('TRADING_LINKED_ID', 'REPLACE_WITH_LINKED_ID')
    
    service = TradingService()
    
    print("Pre-update check:")
    snapshot = session.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)).first()
    ibkr = next((i for i in snapshot.data['items'] if i.get('id') == linked_id), None)
    print(f"IBKR Details: {ibkr.get('details')}")
    
    extra_updates = {
        "dividend_fixed_amount": 24000.5,
        "dividend_mode": "Fixed"
    }
    
    print("\nUpdating snapshot...")
    await service._update_finance_snapshot(session, linked_id, 788054.14, extra_updates)
    
    # Refresh and check
    session.expire_all()
    snapshot = session.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc()).limit(1)).first()
    ibkr = next((i for i in snapshot.data['items'] if i.get('id') == linked_id), None)
    print(f"IBKR Details After Update: {ibkr.get('details')}")
    
    if ibkr.get('details').get('dividend_fixed_amount') == 24000.5:
        print("\nSUCCESS: Snapshot updated correctly.")
    else:
        print("\nFAILURE: Snapshot details NOT updated.")

if __name__ == "__main__":
    asyncio.run(main())
