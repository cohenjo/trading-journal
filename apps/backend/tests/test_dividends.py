from app.services.dividend_service import calculate_cagr

def test_calculate_cagr():
    # 100 to 200 in 1 year = 100%
    assert calculate_cagr(100, 200, 1) == 1.0
    
    # 100 to 121 in 2 years = 10%
    assert abs(calculate_cagr(100, 121, 2) - 0.1) < 0.0001
    
    # Zero handling
    assert calculate_cagr(0, 100, 1) == 0
    assert calculate_cagr(100, 0, 1) == -1.0
    
    # 100 to 50 in 1 year = -50%
    assert calculate_cagr(100, 50, 1) == -0.5
