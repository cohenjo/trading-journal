import logging
from ib_async import IB
import asyncio

logger = logging.getLogger(__name__)

class IBConnectionManager:
    _instance = None
    _ib = None
    _lock = asyncio.Lock()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = IBConnectionManager()
        return cls._instance

    def __init__(self):
        self._ib = IB()

    async def get_ib(self, host='127.0.0.1', port=4002, client_id=None):
        if client_id is None:
            import random
            client_id = random.randint(1000, 9999)
            
        async with self._lock:
            if not self._ib.isConnected():
                try:
                    logger.info(f"Connecting to IBKR at {host}:{port} with clientId {client_id}...")
                    # Increase timeout to 10 seconds
                    await self._ib.connectAsync(host, port, clientId=client_id, timeout=10)
                    # Set market data type to delayed (3) by default for dev/paper
                    self._ib.reqMarketDataType(3) 
                    logger.info("Connected to IBKR.")
                except Exception as e:
                    logger.error(f"Failed to connect to IBKR: {e}")
                    # Try to disconnect to clean up
                    try:
                        self._ib.disconnect()
                    except:
                        pass
                    raise
            return self._ib

    def disconnect(self):
        if self._ib and self._ib.isConnected():
            self._ib.disconnect()
            logger.info("Disconnected from IBKR.")

ib_manager = IBConnectionManager.get_instance()
