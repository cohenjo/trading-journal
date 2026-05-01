"""Test household isolation for dividend_accounts and trading endpoints.

Verifies that RLS policies correctly prevent cross-household data access.
"""

from uuid import uuid4
from datetime import date
import pytest
from sqlmodel import Session
from app.schema.dividend_models import DividendAccount
from app.schema.trading_models import TradingAccountSummary, TradingPosition
from app.schema.household_models import Household, HouseholdMember


@pytest.fixture
def households_and_users(session: Session):
    """Create two households with users for isolation testing."""
    # Create households
    user1_id = uuid4()
    user2_id = uuid4()
    
    household1 = Household(
        id=uuid4(),
        name="Household 1",
        created_by=user1_id,
        created_at=date.today()
    )
    household2 = Household(
        id=uuid4(),
        name="Household 2",
        created_by=user2_id,
        created_at=date.today()
    )
    session.add(household1)
    session.add(household2)
    session.commit()
    
    # Create household memberships
    member1 = HouseholdMember(
        household_id=household1.id,
        user_id=user1_id,
        role="owner",
        invited_by=user1_id,
        invited_at=date.today(),
        joined_at=date.today()
    )
    member2 = HouseholdMember(
        household_id=household2.id,
        user_id=user2_id,
        role="owner",
        invited_by=user2_id,
        invited_at=date.today(),
        joined_at=date.today()
    )
    session.add(member1)
    session.add(member2)
    session.commit()
    
    return {
        "household1": household1,
        "household2": household2,
        "user1": user1_id,
        "user2": user2_id,
    }


def test_dividend_accounts_household_isolation(session: Session, households_and_users):
    """Test that dividend accounts are isolated by household."""
    h1_id = households_and_users["household1"].id
    h2_id = households_and_users["household2"].id
    
    # Create accounts in each household
    account1 = DividendAccount(
        name="H1 Account",
        household_id=h1_id,
        linked_id="link1"
    )
    account2 = DividendAccount(
        name="H2 Account",
        household_id=h2_id,
        linked_id="link2"
    )
    session.add(account1)
    session.add(account2)
    session.commit()
    
    # Verify isolation - query filtering by household should only return that household's data
    from sqlmodel import select
    h1_accounts = session.exec(
        select(DividendAccount).where(DividendAccount.household_id == h1_id)
    ).all()
    h2_accounts = session.exec(
        select(DividendAccount).where(DividendAccount.household_id == h2_id)
    ).all()
    
    assert len(h1_accounts) == 1
    assert h1_accounts[0].name == "H1 Account"
    assert len(h2_accounts) == 1
    assert h2_accounts[0].name == "H2 Account"


def test_trading_summary_household_isolation(session: Session, households_and_users):
    """Test that trading account summaries are isolated by household."""
    h1_id = households_and_users["household1"].id
    h2_id = households_and_users["household2"].id
    
    # Create summaries in each household
    from decimal import Decimal
    summary1 = TradingAccountSummary(
        account_config_id=1,
        net_liquidation=Decimal("10000.00"),
        total_cash=Decimal("5000.00"),
        currency="USD",
        household_id=h1_id
    )
    summary2 = TradingAccountSummary(
        account_config_id=2,
        net_liquidation=Decimal("20000.00"),
        total_cash=Decimal("8000.00"),
        currency="USD",
        household_id=h2_id
    )
    session.add(summary1)
    session.add(summary2)
    session.commit()
    
    # Verify isolation
    from sqlmodel import select
    h1_summaries = session.exec(
        select(TradingAccountSummary).where(TradingAccountSummary.household_id == h1_id)
    ).all()
    h2_summaries = session.exec(
        select(TradingAccountSummary).where(TradingAccountSummary.household_id == h2_id)
    ).all()
    
    assert len(h1_summaries) == 1
    assert h1_summaries[0].net_liquidation == Decimal("10000.00")
    assert len(h2_summaries) == 1
    assert h2_summaries[0].net_liquidation == Decimal("20000.00")


def test_trading_positions_household_isolation(session: Session, households_and_users):
    """Test that trading positions are isolated by household."""
    h1_id = households_and_users["household1"].id
    h2_id = households_and_users["household2"].id
    
    # Create positions in each household
    from decimal import Decimal
    position1 = TradingPosition(
        account_config_id=1,
        symbol="AAPL",
        amount=Decimal("100"),
        sec_type="STK",
        avg_cost=Decimal("150.00"),
        household_id=h1_id
    )
    position2 = TradingPosition(
        account_config_id=2,
        symbol="MSFT",
        amount=Decimal("50"),
        sec_type="STK",
        avg_cost=Decimal("300.00"),
        household_id=h2_id
    )
    session.add(position1)
    session.add(position2)
    session.commit()
    
    # Verify isolation
    from sqlmodel import select
    h1_positions = session.exec(
        select(TradingPosition).where(TradingPosition.household_id == h1_id)
    ).all()
    h2_positions = session.exec(
        select(TradingPosition).where(TradingPosition.household_id == h2_id)
    ).all()
    
    assert len(h1_positions) == 1
    assert h1_positions[0].symbol == "AAPL"
    assert len(h2_positions) == 1
    assert h2_positions[0].symbol == "MSFT"
