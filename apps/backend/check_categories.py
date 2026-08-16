import sys
import json
from sqlalchemy import create_engine, text

# Add backend to path
sys.path.append("/Users/jocohe/projects/trading-journal/apps/backend")
from app.core.config import settings

engine = create_engine(settings.SQLALCHEMY_DATABASE_URI)
with engine.connect() as conn:
    result = conn.execute(text("SELECT data FROM financesnapshot ORDER BY date DESC LIMIT 1"))
    row = result.fetchone()
    if row and row[0]:
        data = row[0]
        if isinstance(data, str):
            data = json.loads(data)
        items = data.get("items", [])
        for item in items:
            print(
                f"Name: {item.get('name')}, Category: {item.get('category')}, Type: {item.get('type')}, Value: {item.get('value')}"
            )
    else:
        print("No snapshot found")
