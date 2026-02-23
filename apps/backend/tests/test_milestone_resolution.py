
from app.services.plan_service import PlanService
from datetime import datetime

class TestMilestoneResolution:
    
    def test_milestone_age_resolution(self):
        # Scenario: Retirement at age 60. Born 1990. Current Year 2026 (Age 36).
        # Expected Retirement Year: 1990 + 60 = 2050.
        
        milestones = [
            {
                "id": "ms_retire",
                "name": "Retirement",
                "type": "Retirement",
                "details": { "age": 60 }
            }
        ]
        
        items = [
            {
                "id": "salary",
                "name": "Salary",
                "category": "Income",
                "value": 100,
                "start_condition": "Now",
                "end_condition": "Milestone",
                "end_reference": "ms_retire"
            }
        ]
        
        settings = { "primaryUser": { "birthYear": 1990 }, "current_age": 36 }
        
        # Run Calculation
        projection = PlanService.calculate_projection(
            {"items": items, "milestones": milestones}, 
            None, 
            settings
        )
        
        # Check that Salary is Active in 2049, Gone in 2051
        year_2049 = next((p for p in projection if p['year'] == 2049), None)
        year_2051 = next((p for p in projection if p['year'] == 2051), None)
        
        assert year_2049['income'] == 100.0
        assert year_2051['income'] == 0.0

    def test_unconfigured_milestone_fallback(self):
        # Scenario: Milestone passed but has NO details. Should default to 'Now'.
        milestones = [{"id": "ms_empty", "name": "Empty", "type": "Custom"}]
        items = [{
            "id": "salary",
            "name": "Salary",
            "category": "Income",
            "value": 100,
            "start_condition": "Now",
            "end_condition": "Milestone",
            "end_reference": "ms_empty"
        }]
        
        current_year = datetime.now().year
        projection = PlanService.calculate_projection(
            {"items": items, "milestones": milestones}, None, {}
        )
        
        # Should be active ONLY in current year (inclusive) or up to current year?
        # Logic says: if year <= end_y. End_y = Current Year.
        # So Active in Current Year. Gone in Next Year.
        
        p_curr = next((p for p in projection if p['year'] == current_year), None)
        p_next = next((p for p in projection if p['year'] == current_year + 1), None)
        
        assert p_curr['income'] == 100.0
        assert p_next['income'] == 0.0

    def test_pension_fallback_resolution(self):
        # Scenario: Salary links to 'pension_ms_OLD_ID' (Broken).
        # Pension Account exists with 'starting_age': 65.
        # Birth Year 1990. Target Year 1990 + 65 = 2055.
        
        items = [{
            "id": "salary",
            "name": "Salary",
            "category": "Income",
            "value": 100,
            "start_condition": "Now",
            "end_condition": "Milestone",
            "end_reference": "pension_ms_OLD_ID" # Link matches prefix but ID missing
        }]
        
        # Mock Finance Snapshot with Account
        # PlanService expects 'items' list with 'category' in ['Savings', 'Investments']
        snapshot_dict = {
            "data": {
                "items": [{
                    "id": "acc_new_id",
                    "name": "Pension Fund",
                    "category": "Investments", # Must be Investments/Savings
                    "type": "Pension", 
                    "value": 1000,
                    "details": { # Snapshot Details
                        "starting_age": 65,
                        "owner": "You"
                    }
                }]
            }
        }
        
        settings = { "primaryUser": { "birthYear": 1990 } }

        projection = PlanService.calculate_projection(
            {"items": items, "milestones": []}, 
            snapshot_dict, 
            settings
        )
        
        # Should persist until 2055.
        year_2054 = next((p for p in projection if p['year'] == 2054), None)
        year_2056 = next((p for p in projection if p['year'] == 2056), None)
        
        assert year_2054['income'] == 100.0
        assert year_2056['income'] == 0.0
