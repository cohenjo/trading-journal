import logging
from datetime import datetime

from ib_async import util, FlexReport
from sqlalchemy.orm import Session
from app.dal.database import engine
from app.schema.models import Trade

# Your Flex credentials
TOKEN = ''
QUERY_ID = ''

util.logToConsole(logging.INFO)


def parse_flex_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return None


def parse_flex_datetime(datetime_str):
    if not datetime_str:
        return None
    try:
        # Handle potential timezone info if present
        if '.' in datetime_str:
            datetime_str = datetime_str.split('.')[0]
        return datetime.strptime(datetime_str, '%Y-%m-%d;%H%M%S')
    except ValueError:
        return None


def main():
    """
    Downloads and processes the Flex Report synchronously.
    """
    try:
        # Use the synchronous constructor as per the user's example.
        # This will download and parse the report in a blocking manner.
        print("Downloading and parsing Flex Report...")
        report = FlexReport(token=TOKEN, queryId=QUERY_ID)
        trades = report.extract('Trade')

        print(f"Found {len(trades)} trades in the report.")

        with Session(engine) as session:
            for t in trades:
                trade = Trade(
                    tradeID=t.tradeID,
                    accountId=t.accountId,
                    acctAlias=t.acctAlias,
                    model=t.model,
                    currency=t.currency,
                    fxRateToBase=t.fxRateToBase,
                    assetCategory=t.assetCategory,
                    subCategory=t.subCategory,
                    symbol=t.symbol,
                    description=t.description,
                    conid=t.conid,
                    securityID=t.securityID,
                    securityIDType=t.securityIDType,
                    cusip=t.cusip,
                    isin=t.isin,
                    figi=t.figi,
                    listingExchange=t.listingExchange,
                    underlyingConid=t.underlyingConid,
                    underlyingSymbol=t.underlyingSymbol,
                    underlyingSecurityID=t.underlyingSecurityID,
                    underlyingListingExchange=t.underlyingListingExchange,
                    issuer=t.issuer,
                    issuerCountryCode=t.issuerCountryCode,
                    multiplier=t.multiplier,
                    relatedTradeID=t.relatedTradeID,
                    strike=t.strike,
                    reportDate=parse_flex_date(t.reportDate),
                    expiry=t.expiry,
                    dateTime=parse_flex_datetime(t.dateTime),
                    putCall=t.putCall,
                    tradeDate=parse_flex_date(t.tradeDate),
                    principalAdjustFactor=t.principalAdjustFactor,
                    settleDateTarget=parse_flex_date(t.settleDateTarget),
                    transactionType=t.transactionType,
                    exchange=t.exchange,
                    quantity=t.quantity,
                    tradePrice=t.tradePrice,
                    tradeMoney=t.tradeMoney,
                    proceeds=t.proceeds,
                    taxes=t.taxes,
                    ibCommission=t.ibCommission,
                    ibCommissionCurrency=t.ibCommissionCurrency,
                    netCash=t.netCash,
                    closePrice=t.closePrice,
                    openCloseIndicator=t.openCloseIndicator,
                    notes=t.notes,
                    cost=t.cost,
                    fifoPnlRealized=t.fifoPnlRealized,
                    mtmPnl=t.mtmPnl,
                    origTradePrice=t.origTradePrice,
                    origTradeDate=t.origTradeDate,
                    origTradeID=t.origTradeID,
                    origOrderID=t.origOrderID,
                    origTransactionID=t.origTransactionID,
                    buySell=t.buySell,
                    clearingFirmID=t.clearingFirmID,
                    ibOrderID=t.ibOrderID,
                    transactionID=t.transactionID,
                    ibExecID=t.ibExecID,
                    relatedTransactionID=t.relatedTransactionID,
                    rtn=t.rtn,
                    brokerageOrderID=t.brokerageOrderID,
                    orderReference=t.orderReference,
                    volatilityOrderLink=t.volatilityOrderLink,
                    exchOrderId=t.exchOrderId,
                    extExecID=t.extExecID,
                    orderTime=parse_flex_datetime(t.orderTime),
                    openDateTime=t.openDateTime,
                    holdingPeriodDateTime=t.holdingPeriodDateTime,
                    whenRealized=t.whenRealized,
                    whenReopened=t.whenReopened,
                    levelOfDetail=t.levelOfDetail,
                    changeInPrice=t.changeInPrice,
                    changeInQuantity=t.changeInQuantity,
                    orderType=t.orderType,
                    traderID=t.traderID,
                    isAPIOrder=t.isAPIOrder,
                    accruedInt=t.accruedInt,
                    initialInvestment=t.initialInvestment,
                    serialNumber=t.serialNumber,
                    deliveryType=t.deliveryType,
                    commodityType=t.commodityType,
                    fineness=t.fineness,
                    weight=t.weight
                )
                session.merge(trade)
            session.commit()
            print(f"Successfully inserted/updated {len(trades)} trades.")

    except Exception:
        logging.exception("An error occurred:")


if __name__ == "__main__":
    main()
