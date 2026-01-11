import asyncio
from datetime import datetime, timedelta
import sys
import os
from dotenv import load_dotenv
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from ib_async import IB, ExecutionFilter
from sqlmodel import Session, select
from app.dal.database import engine
from app.schema.models import Execution

load_dotenv()

IB_HOST = os.getenv("IB_HOST", "127.0.0.1")
IB_PORT = int(os.getenv("IB_PORT", 4001))
IB_CLIENT_ID = int(os.getenv("IB_CLIENT_ID", 2))

async def sync_executions():
    ib = IB()
    try:
        await ib.connectAsync(IB_HOST, IB_PORT, clientId=IB_CLIENT_ID, timeout=30)
        print("Connected to IB Gateway for execution sync")

        exec_filter = ExecutionFilter()
        exec_filter.symbol = 'NDX'  # NDX index options
        exec_filter.secType = 'OPT'  # Option trades
        exec_filter.time = '20250630 00:00:00'  # Must be within last ~24h
        executions = await ib.reqExecutionsAsync(exec_filter)

        with Session(engine) as session:
            for exec_detail in executions:
                execution_record = session.get(Execution, exec_detail.execution.execId)
                if not execution_record:
                    execution_record = Execution(
                        execId=exec_detail.execution.execId,
                        permId=exec_detail.execution.permId,
                        orderId=exec_detail.execution.orderId,
                        clientId=exec_detail.execution.clientId,
                        time=exec_detail.execution.time,
                        acctNumber=exec_detail.execution.acctNumber,
                        exchange=exec_detail.execution.exchange,
                        side=exec_detail.execution.side,
                        shares=exec_detail.execution.shares,
                        price=exec_detail.execution.price,
                        avgPrice=exec_detail.execution.avgPrice,
                        cumQty=exec_detail.execution.cumQty,
                        symbol=exec_detail.contract.symbol,
                        commission=exec_detail.commissionReport.commission,
                        currency=exec_detail.commissionReport.currency,
                        realizedPNL=exec_detail.commissionReport.realizedPNL,
                    )
                    session.add(execution_record)
            session.commit()
            print(f"Synced {len(executions)} executions.")

    except Exception as e:
        print(f"An error occurred during execution sync: {e}")
    finally:
        if ib.isConnected():
            ib.disconnect()
            print("Disconnected from IB Gateway")

if __name__ == "__main__":
    asyncio.run(sync_executions())