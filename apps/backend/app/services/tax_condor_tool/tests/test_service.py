import sys
import os

# Add the backend directory to sys.path to allow absolute imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../..")))

from app.services.tax_condor_tool.service import TaxCondorService
from app.services.tax_condor_tool.data.mock_provider import MockDataProvider
import json
import asyncio

async def test_recommendation():
    # Setup
    provider = MockDataProvider(spot=450.0, vol=0.20)
    service = TaxCondorService(provider)
    
    # Execute
    print("Generating recommendations for NDX...")
    recs = await service.get_recommendation("NDX", budget=2000.0)
    
    # Output
    if not recs:
        print("No recommendations found.")
        return

    print(f"Found {len(recs)} recommendations.")
    
    top_rec = recs[0]
    print("\n--- Top Recommendation ---")
    print(f"Score: {top_rec.score:.2f}")
    
    print("\nLEAP:")
    leap = top_rec.leap.leg
    print(f"  {leap.action.upper()} {leap.quantity} {leap.symbol} {leap.expiration} {leap.strike} {leap.option_type.upper()}")
    print(f"  Greeks: Delta={leap.greeks.delta:.2f}, Theta={leap.greeks.theta:.2f}")
    
    print("\nIron Condor:")
    ic = top_rec.iron_condor
    print(f"  Short Call: {ic.short_call.strike}")
    print(f"  Long Call:  {ic.long_call.strike}")
    print(f"  Short Put:  {ic.short_put.strike}")
    print(f"  Long Put:   {ic.long_put.strike}")
    print(f"  Net Credit: ${ic.net_credit:.2f}")
    print(f"  Margin:     ${ic.margin_requirement:.2f}")
    print(f"  IC Theta:   {ic.greeks.theta:.2f}")
    
    print("\nPortfolio PnL Simulation (LEAP + IC):")
    if top_rec.portfolio_pnl_simulations:
        for sim in top_rec.portfolio_pnl_simulations:
            print(f"  {sim.price_change_pct:>+3.0f}%: ${sim.estimated_pnl:.2f}")
    else:
        print("  Not available")

    print("\nAnalysis:")
    print(json.dumps(top_rec.analysis, indent=2))

if __name__ == "__main__":
    asyncio.run(test_recommendation())
