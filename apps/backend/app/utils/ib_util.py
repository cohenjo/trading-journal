import asyncio
from ib_async import IB

async def main():
    ib = IB()
    try:
        await ib.connectAsync('127.0.0.1', 4001, clientId=1, timeout=30)
        print("Connected to IB Gateway")

        # Fetch account summary
        account_summary = await ib.accountSummaryAsync()
        print("Account Summary:")
        for account_value in account_summary:
            print(f"{account_value.tag}: {account_value.value} {account_value.currency}")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        if ib.isConnected():
            ib.disconnect()
            print("Disconnected from IB Gateway")

if __name__ == "__main__":
    asyncio.run(main())