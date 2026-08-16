import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlmodel import Session, select
from app.dal.database import engine
from app.schema.finance_models import FinanceSnapshot
from sqlalchemy.orm.attributes import flag_modified


def run():
    with Session(engine) as db:
        snapshot = db.exec(select(FinanceSnapshot).order_by(FinanceSnapshot.date.desc())).first()
        if not snapshot:
            print("No snapshot")
            return

        items = snapshot.data.get("items", [])
        for item in items:
            if item.get("name") == "Bank Leumi Mortgage":
                if "details" not in item:
                    item["details"] = {}
                item["details"]["monthly_payment"] = 5623.41
                item["details"]["start_date"] = "2015-10-14"
                item["details"]["end_date"] = "2035-10-01"
                print("Found and updated mortgage details")

        snapshot.data["items"] = items
        flag_modified(snapshot, "data")
        db.commit()
        print("Saved")


if __name__ == "__main__":
    run()
