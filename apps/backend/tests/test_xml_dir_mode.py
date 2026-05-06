"""Tests for --xml-dir manual Flex XML backfill mode.

This test suite covers the new --xml-dir feature that allows backfilling from
manually-exported Activity Flex XML files dropped into a directory. This mode
sidesteps IBKR's live Flex API throttle issues for large historical backfills.

Test Coverage:
- XML filename parsing and date extraction
- Date range filtering and overlap logic
- Source routing (xml_dir vs synthetic vs live)
- CLI mutual exclusion enforcement
- Real fixture integration smoke test
- Edge cases: malformed filenames, empty directories, invalid dates
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
import subprocess
import sys

import pytest

from app.worker.handlers.options_sync import _xml_dir_files, _select_flex_source
from app.services.options.flex_parser import parse_flex_files


# --- Test Case 1: Basic date range filtering ---


def test_xml_dir_files_returns_files_in_window(tmp_path: Path) -> None:
    """Files whose date range overlaps the requested window are returned.

    Arrange: Create 3 XML files with different date ranges in tmp_path
    Act: Request a window that overlaps only one file
    Assert: Only the matching file is returned
    """
    # Arrange
    file_2021 = tmp_path / "U123_U123_20210101_20211231_AF_1496910_aaa.xml"
    file_2022 = tmp_path / "U123_U123_20220103_20221230_AF_1496910_bbb.xml"
    file_2023 = tmp_path / "U123_U123_20230102_20231229_AF_1496910_ccc.xml"

    file_2021.write_text("<dummy/>")
    file_2022.write_text("<dummy/>")
    file_2023.write_text("<dummy/>")

    # Act: Request Q2 2022 (inside file_2022 range)
    result = _xml_dir_files(tmp_path, from_date=date(2022, 4, 1), to_date=date(2022, 6, 30))

    # Assert
    assert len(result) == 1
    assert result[0].name == "U123_U123_20220103_20221230_AF_1496910_bbb.xml"


# --- Test Case 2: Cross-year window overlap ---


def test_xml_dir_files_returns_overlapping_files_for_cross_year_window(tmp_path: Path) -> None:
    """A window spanning multiple years returns all overlapping files.

    Arrange: Create 2 XML files (2022 + 2023)
    Act: Request a window spanning Dec 2022 → Feb 2023
    Assert: Both files are returned
    """
    # Arrange
    file_2022 = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"
    file_2023 = tmp_path / "U123_U123_20230102_20231229_AF_1496910_bbb.xml"

    file_2022.write_text("<dummy/>")
    file_2023.write_text("<dummy/>")

    # Act: Dec 1, 2022 → Feb 28, 2023 (overlaps both files)
    result = _xml_dir_files(tmp_path, from_date=date(2022, 12, 1), to_date=date(2023, 2, 28))

    # Assert
    assert len(result) == 2
    assert file_2022 in result
    assert file_2023 in result


# --- Test Case 3: Non-matching filenames are skipped ---


def test_xml_dir_files_skips_non_matching_filenames(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """Files that don't match the IBKR pattern are skipped with a warning.

    Arrange: Create a README.md, a random.xml, and a properly-named XML file
    Act: Request all files
    Assert: Only the IBKR-named file is returned; warning logged for others
    """
    # Arrange
    readme = tmp_path / "README.md"
    random_xml = tmp_path / "random.xml"
    valid_xml = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"

    readme.write_text("# Activity Flex Reports")
    random_xml.write_text("<random/>")
    valid_xml.write_text("<dummy/>")

    # Act
    import logging

    with caplog.at_level(logging.WARNING):
        result = _xml_dir_files(tmp_path, from_date=None, to_date=None)

    # Assert
    assert len(result) == 1
    assert result[0] == valid_xml

    # Check warning was logged for the non-matching XML file
    assert any("random.xml" in record.message for record in caplog.records)
    assert any("non-matching filename pattern" in record.message for record in caplog.records)


# --- Test Case 4: No overlap raises FileNotFoundError ---


def test_xml_dir_files_raises_when_no_overlap(tmp_path: Path) -> None:
    """When no files overlap the requested window, raise FileNotFoundError.

    Arrange: Create one file for 2022
    Act: Request 2024 window
    Assert: FileNotFoundError raised with descriptive message
    """
    # Arrange
    file_2022 = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"
    file_2022.write_text("<dummy/>")

    # Act & Assert
    with pytest.raises(FileNotFoundError) as exc_info:
        _xml_dir_files(tmp_path, from_date=date(2024, 1, 1), to_date=date(2024, 12, 31))

    # Assert error message includes directory and window
    error_msg = str(exc_info.value)
    assert str(tmp_path) in error_msg
    assert "2024-01-01" in error_msg
    assert "2024-12-31" in error_msg


# --- Test Case 5: Unbounded window (None/None) returns all files ---


def test_xml_dir_files_handles_unbounded_window(tmp_path: Path) -> None:
    """When from_date and to_date are None, all matching files are returned.

    Arrange: Create one file for 2022
    Act: Request from_date=None, to_date=None
    Assert: The file is returned
    """
    # Arrange
    file_2022 = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"
    file_2022.write_text("<dummy/>")

    # Act
    result = _xml_dir_files(tmp_path, from_date=None, to_date=None)

    # Assert
    assert len(result) == 1
    assert result[0] == file_2022


# --- Test Case 6: Returned list is sorted ---


def test_xml_dir_files_returns_sorted(tmp_path: Path) -> None:
    """Files are returned in sorted order by path string.

    Arrange: Create 3 files in non-alphabetical creation order
    Act: Request window covering all files
    Assert: Returned list is sorted alphabetically
    """
    # Arrange: Create in reverse order
    file_c = tmp_path / "U123_U123_20240101_20241231_AF_1496910_ccc.xml"
    file_a = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"
    file_b = tmp_path / "U123_U123_20230102_20231229_AF_1496910_bbb.xml"

    file_c.write_text("<dummy/>")
    file_a.write_text("<dummy/>")
    file_b.write_text("<dummy/>")

    # Act: Request all (2022-2024)
    result = _xml_dir_files(tmp_path, from_date=date(2022, 1, 1), to_date=date(2024, 12, 31))

    # Assert: Sorted alphabetically by filename
    assert len(result) == 3
    assert result[0] == file_a
    assert result[1] == file_b
    assert result[2] == file_c


# --- Test Case 7: _select_flex_source routes to xml_dir when set ---


def test_select_flex_source_routes_to_xml_dir_when_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When xml_dir is set, _select_flex_source calls _xml_dir_files (not live/synthetic).

    Arrange: Create a valid XML file in tmp_path; monkeypatch _xml_dir_files to track calls
    Act: Call _select_flex_source with xml_dir=tmp_path
    Assert: _xml_dir_files was called (not the live or synthetic path)
    """
    # Arrange
    file_2022 = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml"
    file_2022.write_text("<dummy/>")

    # Track whether _xml_dir_files was called
    xml_dir_files_called = False
    original_xml_dir_files = _xml_dir_files

    def mock_xml_dir_files(directory: Path, *, from_date: date | None, to_date: date | None) -> list[Path]:
        nonlocal xml_dir_files_called
        xml_dir_files_called = True
        return original_xml_dir_files(directory, from_date=from_date, to_date=to_date)

    monkeypatch.setattr("app.worker.handlers.options_sync._xml_dir_files", mock_xml_dir_files)

    # Test with IBKR_FLEX_TOKEN present (xml_dir should win)
    monkeypatch.setenv("IBKR_FLEX_TOKEN", "dummy-token-12345")

    # Act
    result = _select_flex_source(
        from_date=date(2022, 1, 1), to_date=date(2022, 12, 31), synthetic=None, xml_dir=tmp_path
    )

    # Assert
    assert xml_dir_files_called, "_xml_dir_files should have been called"
    assert len(result) == 1
    assert result[0] == file_2022

    # Test with IBKR_FLEX_TOKEN absent (xml_dir should still win)
    xml_dir_files_called = False
    monkeypatch.delenv("IBKR_FLEX_TOKEN", raising=False)

    result = _select_flex_source(
        from_date=date(2022, 1, 1), to_date=date(2022, 12, 31), synthetic=None, xml_dir=tmp_path
    )

    assert xml_dir_files_called, "_xml_dir_files should have been called even without token"
    assert len(result) == 1


# --- Test Case 8: CLI mutual exclusion enforcement ---


def test_backfill_options_xml_dir_synthetic_mutually_exclusive(tmp_path: Path) -> None:
    """--xml-dir and --synthetic are mutually exclusive (exit code != 0).

    Arrange: Create a dummy XML directory
    Act: Run backfill_options.py with both --xml-dir and --synthetic
    Assert: Exit code != 0 and stderr contains "mutually exclusive"
    """
    # Arrange
    xml_dir = tmp_path / "xml"
    xml_dir.mkdir()
    (xml_dir / "U123_U123_20220103_20221230_AF_1496910_aaa.xml").write_text("<dummy/>")

    # Act: Test --xml-dir + --synthetic
    script_path = Path(__file__).parent.parent / "scripts" / "backfill_options.py"
    result = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--start",
            "2022-01-01",
            "--end",
            "2022-12-31",
            "--xml-dir",
            str(xml_dir),
            "--synthetic",
        ],
        capture_output=True,
        text=True,
    )

    # Assert
    assert result.returncode != 0, "Should exit with error code when flags conflict"
    assert "mutually exclusive" in result.stderr, f"Expected 'mutually exclusive' in stderr, got: {result.stderr}"


def test_backfill_options_xml_dir_live_mutually_exclusive(tmp_path: Path) -> None:
    """--xml-dir and --live are mutually exclusive (exit code != 0).

    Arrange: Create a dummy XML directory
    Act: Run backfill_options.py with both --xml-dir and --live
    Assert: Exit code != 0 and stderr contains "mutually exclusive"
    """
    # Arrange
    xml_dir = tmp_path / "xml"
    xml_dir.mkdir()
    (xml_dir / "U123_U123_20220103_20221230_AF_1496910_aaa.xml").write_text("<dummy/>")

    # Act: Test --xml-dir + --live
    script_path = Path(__file__).parent.parent / "scripts" / "backfill_options.py"
    result = subprocess.run(
        [
            sys.executable,
            str(script_path),
            "--start",
            "2022-01-01",
            "--end",
            "2022-12-31",
            "--xml-dir",
            str(xml_dir),
            "--live",
        ],
        capture_output=True,
        text=True,
    )

    # Assert
    assert result.returncode != 0, "Should exit with error code when flags conflict"
    assert "mutually exclusive" in result.stderr, f"Expected 'mutually exclusive' in stderr, got: {result.stderr}"


# --- Test Case 9: Real fixture smoke test ---


def test_backfill_options_xml_dir_real_fixture_smoke() -> None:
    """Parse a real Activity Flex XML file from reports/activity/ to prove integration.

    Arrange: Use one of the committed XML files at /Users/jocohe/projects/trading-journal/reports/activity/
    Act: Parse via parse_flex_files (the production parser)
    Assert: trades, cash_transactions, and (account_information or open_positions) are populated

    Note: This tests the integration between the new --xml-dir mode and the existing parser.
    The parser already handles Activity Flex XML (with <Trades> elements); this proves it works.
    """
    # Arrange: Use real 2022 file (from repo root)
    # __file__ is apps/backend/tests/test_xml_dir_mode.py
    # Go up 3 levels to reach repo root
    project_root = Path(__file__).resolve().parent.parent.parent.parent
    real_xml_path = (
        project_root
        / "reports"
        / "activity"
        / "U2515365_U2515365_20220103_20221230_AF_1496910_ce0b54d8b0db812b5dc98314703e2aaf.xml"
    )

    if not real_xml_path.exists():
        pytest.skip(f"Real fixture not found at {real_xml_path}")

    # Act
    result = parse_flex_files([real_xml_path], "U2515365")

    # Assert: The parser populated key data structures
    assert result.trades, "trades should be non-empty for Activity Flex (Trades section)"
    assert result.cash_transactions, "cash_transactions should be non-empty for Activity Flex"
    assert result.account_information or result.open_positions, (
        "account_information or open_positions should be populated"
    )


# --- Test Case 10: Edge cases in filename parsing ---


def test_xml_dir_filename_regex_handles_edge_cases(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    """The date-extraction regex gracefully handles malformed filenames.

    Arrange: Create files with edge cases: .xml.bak, missing _AF_, malformed dates, long account IDs
    Act: Request all files
    Assert: Malformed files are skipped without crashing; warnings logged
    """
    # Arrange: Edge case filenames
    backup_file = tmp_path / "U123_U123_20220103_20221230_AF_1496910_aaa.xml.bak"
    missing_af = tmp_path / "U123_U123_20220103_20221230_1496910_bbb.xml"
    malformed_date = tmp_path / "U123_U123_2022XXXX_20221230_AF_1496910_ccc.xml"
    long_account = tmp_path / "U123456789012345_U123456789012345_20220103_20221230_AF_1496910_ddd.xml"
    valid_file = tmp_path / "U123_U123_20220103_20221230_AF_1496910_eee.xml"

    backup_file.write_text("<dummy/>")
    missing_af.write_text("<dummy/>")
    malformed_date.write_text("<dummy/>")
    long_account.write_text("<dummy/>")
    valid_file.write_text("<dummy/>")

    # Act
    import logging

    with caplog.at_level(logging.WARNING):
        result = _xml_dir_files(tmp_path, from_date=None, to_date=None)

    # Assert: Only valid_file and long_account are returned (long account ID is valid!)
    assert len(result) == 2
    assert valid_file in result
    assert long_account in result

    # Check warnings were logged for malformed files
    warning_messages = [record.message for record in caplog.records if record.levelname == "WARNING"]

    # backup_file (.xml.bak) should be skipped (doesn't match *.xml glob)
    # missing_af should warn (no _AF_ token)
    assert any("missing_af" in msg or "1496910_bbb.xml" in msg for msg in warning_messages), (
        f"Expected warning for missing_af file, got warnings: {warning_messages}"
    )

    # malformed_date should warn (invalid date parse)
    assert any(
        "malformed_date" in msg or "2022XXXX" in msg or "invalid date" in msg.lower() for msg in warning_messages
    ), f"Expected warning for malformed_date file, got warnings: {warning_messages}"
