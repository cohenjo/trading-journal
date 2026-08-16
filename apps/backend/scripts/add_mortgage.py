import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select
from app.dal.database import engine
from app.schema.finance_models import FinanceSnapshot
import uuid
from decimal import Decimal


def run():
    with Session(engine) as db:
        snapshot = db.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc())).first()
        if not snapshot:
            print("No snapshot found")
            return

        items = snapshot.data.get("items", [])
        for item in items:
            if item.get("name") == "Bank Leumi Mortgage":
                print("Mortgage already exists")
                return

        mortgage_item = {
            "id": str(uuid.uuid4()),
            "category": "Liabilities",
            "name": "Bank Leumi Mortgage",
            "value": 332062.05,
            "type": "Mortgage",
            "owner": "Household",
            "currency": "ILS",
            "details": {
                "sub_plans": [
                    {
                        "plan_id": "2085",
                        "name": "Variable Interest every 5 years, Linked",
                        "end_date": "01.10.2035",
                        "balance": 62132.21,
                    },
                    {"plan_id": "1078", "name": "Prime Interest", "end_date": "01.10.2035", "balance": 187972.68},
                    {
                        "plan_id": "2069",
                        "name": "Fixed Interest, Unlinked",
                        "end_date": "01.10.2027",
                        "balance": 22417.14,
                    },
                    {
                        "plan_id": "2069_2",
                        "name": "Fixed Interest, Unlinked (2030)",
                        "end_date": "01.10.2030",
                        "balance": 59540.02,
                    },
                ]
            },
        }

        items.append(mortgage_item)
        snapshot.data["items"] = items

        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(snapshot, "data")

        if snapshot.total_liabilities is not None:
            snapshot.total_liabilities += Decimal("332062.05")

        if snapshot.net_worth is not None:
            snapshot.net_worth -= Decimal("332062.05")

        db.commit()
        print("Mortgage added successfully to snapshot dated:", snapshot.date)


if __name__ == "__main__":
    run()
