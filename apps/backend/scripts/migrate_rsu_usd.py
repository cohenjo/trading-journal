
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8001/api/finances"

def migrate_rsu_currency():
    # 1. Get the latest snapshot
    print("Fetching latest snapshot...")
    try:
        req = urllib.request.Request(f"{BASE_URL}/latest")
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                print(f"Failed to retrieve snapshot: Status {response.status}")
                return
            snapshot = json.loads(response.read().decode())
    except urllib.error.URLError as e:
        print(f"Failed to retrieve snapshot: {e}")
        return

    data = snapshot.get("data", {})
    items = data.get("items", [])
    updated = False
    
    print(f"Scanning {len(items)} items for RSU accounts...")

    for item in items:
        # Check if item is RSU (by type or account_settings.type)
        is_rsu = False
        if item.get("type") == "RSU":
            is_rsu = True
        elif item.get("sub_category") == "RSU":
            is_rsu = True
        elif item.get("category") == "Account" and item.get("account_settings", {}).get("type") == "RSU":
            is_rsu = True
            
        if is_rsu:
            current_currency = item.get("currency")
            if current_currency != "USD":
                print(f"Migrating RSU item '{item.get('name')}' from {current_currency} to USD")
                item["currency"] = "USD"
                updated = True

    if updated:
        # Prepare payload for update
        payload = {
            "date": snapshot["date"],
            "net_worth": snapshot["net_worth"],
            "total_assets": snapshot["total_assets"],
            "total_liabilities": snapshot["total_liabilities"],
            "total_savings": data.get("total_savings", 0),
            "total_investments": data.get("total_investments", 0),
            "items": items
        }
        
        print("Sending updated snapshot...")
        try:
            json_data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(f"{BASE_URL}/", data=json_data, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req) as response:
                if response.status == 200:
                    print("Migration successful! RSU accounts updated to USD.")
                    # print response body
                    print(response.read().decode())
                else:
                    print(f"Failed to update snapshot: Status {response.status}")
                    print(response.read().decode())
        except urllib.error.URLError as e:
            print(f"Failed to update snapshot: {e}")
            if hasattr(e, 'read'):
                print(e.read().decode())
    else:
        print("No RSU accounts needed migration.")

if __name__ == "__main__":
    migrate_rsu_currency()
