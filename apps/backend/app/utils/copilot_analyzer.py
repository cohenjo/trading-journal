import asyncio
import os
import json
from copilot import CopilotClient
from copilot.tools import define_tool
from copilot.generated.session_events import SessionEventType
from pydantic import BaseModel, Field
import pdfplumber
from typing import Dict, Any

class ReadPdfParams(BaseModel):
    file_path: str = Field(description="The path to the PDF file to read")

@define_tool(description="Extracts content from a PDF file as text, attempting to preserve table structures.")
async def read_pdf_report(params: ReadPdfParams) -> str:
    """
    Reads a PDF file using pdfplumber to better preserve layout and tables.
    """
    try:
        text_content = []
        with pdfplumber.open(params.file_path) as pdf:
            for i, page in enumerate(pdf.pages):
                text_content.append(f"--- Page {i+1} ---")
                
                page_text = page.extract_text() or ""
                if page_text:
                    text_content.append(page_text)
                
                tables = page.extract_tables()
                if tables:
                    text_content.append(f"--- Extracted Tables from Page {i+1} ---")
                    for table_idx, table in enumerate(tables):
                        text_content.append(f"Table {table_idx+1}:")
                        for row in table:
                            clean_row = [str(cell).strip() if cell else "" for cell in row]
                            text_content.append(" | ".join(clean_row))
                        text_content.append("")
                        
        return "\n".join(text_content)
    except Exception as e:
        return f"Error reading PDF: {str(e)}"

async def analyze_report(file_path: str) -> Dict[str, Any]:
    """
    Analyzes an insurance report using the Copilot SDK and returns the structured data.
    """
    client = CopilotClient()
    
    try:
        await client.start()

        session = await client.create_session({
            "model": "gpt-4o", 
            "streaming": True,
            "infinite_sessions": {"enabled": False},
            "system_message": {
                "content": """You are an expert financial analyst specialized in Israeli insurance quarterly reports.
                Your goal is to extract specific financial details from Hebrew or English reports.
                
                The input will be text extracted from a PDF. Analyze it carefully.

                When analyzing a report, you MUST extract the following fields strictly:
                - Report Date (The as-of date of the report, formatted strictly as YYYY-MM-DD. If only a month and year are given, use the 1st of the month, e.g. 'March 2025' -> '2025-03-01')
                - Name (Name of the insured person)
                - ID (Identification number)
                - Total Amount (Total value of the policy/fund as a number)
                - Monthly Deposits (The average monthly deposit. Look for an explicit 'Monthly Deposit' field. If not available, calculate it by dividing the YTD total period deposits by the number of months in the period. Example: If Q3 YTD deposits are 46,258 over 9 months, write 5139. MUST be a number)
                - Earnings (Net earnings/losses in the period as a number)
                - Fees (Total management fees as a number)
                - Insurance Fees (Cost of insurance coverage as a number)
                - Pension Fund Name (Name of the exact pension fund, e.g. "Clal Pension")

                If a field is not found or not applicable, mark it as null.
                If amount values have commas, remove them. Ensure numbers are float or integer in the JSON output, not strings!
                Return the result strictly as a raw JSON object string ONLY. Do not use Markdown formatting or code blocks around the JSON object.
                """
            },
            "tools": [read_pdf_report],
        })

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")

        prompt = f"Please analyze the insurance report at '{file_path}' and extract the required fields as JSON."
        
        result_content = ""
        
        def handle_event(event):
            nonlocal result_content
            try:
                evt_type = str(getattr(event, 'type', ''))
                if 'ASSISTANT_MESSAGE_DELTA' in evt_type:
                    evt_data = getattr(event, 'data', None)
                    if evt_data:
                        delta = getattr(evt_data, 'delta_content', '')
                        if delta:
                            result_content += delta
            except Exception:
                pass

        session.on(handle_event)
        
        try:
            await session.send_and_wait({"prompt": prompt})
        except Exception as e:
            msg = f"Copilot SDK Internal Error during send_and_wait: {e}"
            print(msg)
            raise ValueError(msg)
            
        if not result_content.strip():
            raise ValueError("Copilot returned empty content. Context length may have been exceeded or tool failed.")
        
        # Strip potential markdown formatting
        if result_content.startswith('```json'):
            result_content = result_content[7:]
        if result_content.startswith('```'):
            result_content = result_content[3:]
        if result_content.endswith('```'):
            result_content = result_content[:-3]
            
        result_content = result_content.strip()
        
        try:
            return json.loads(result_content)
        except json.JSONDecodeError as e:
            print(f"Failed to parse JSON: {result_content}")
            raise ValueError(f"Could not parse JSON response from Copilot: {e}")

    finally:
        try:
             await client.stop()
        except:
             pass
