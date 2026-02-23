"""
Tests for layout/configure_constraints.py and layout/freerouting_dsn.py

Validates the SI-USB-02 intra-pair skew enforcement additions without requiring
KiCad (pcbnew) or FreeRouting to be installed.  Covered assertions:

  · FR4 propagation constants are physically correct and consistent across modules
  · USB_SKEW_LIMIT_PS = 100ps and USB_MAX_DELTA_MM derived correctly
  · skew_ps_from_delta_mm() conversion formula is accurate
  · _parse_ses_resolution() handles um, mil, mm, and missing directives
  · _extract_net_length_mm() correctly sums Euclidean wire segments
  · validate_ses_intra_pair_skew() raises on skew > 100ps and passes within budget
  · _write_kicad_dru() generates a .kicad_dru file with diff_pair_skew constraint
  · USB net class carries skew_limit_ps = 100.0 in both layout modules
"""

import math
import pytest
from pathlib import Path

from layout.freerouting_dsn import (
    ALL_DSN_CLASSES,
    FR4_PROPAGATION_MM_PER_NS,
    FR4_PROPAGATION_MM_PER_PS,
    USB_SKEW_LIMIT_PS,
    USB_MAX_DELTA_MM,
    skew_ps_from_delta_mm,
    _parse_ses_resolution,
    _extract_net_length_mm,
    validate_ses_intra_pair_skew,
)
from layout.configure_constraints import (
    ALL_CLASSES,
    FR4_PROPAGATION_MM_PER_NS as CC_FR4_SPEED,
    _write_kicad_dru,
)


# ── FR4 propagation constants ─────────────────────────────────────────────────


def test_fr4_propagation_speed_is_physically_correct():
    """v = c/sqrt(εr_eff=4.1) ≈ 148.06 mm/ns on JLC04161H-3313 stackup."""
    expected = 299.792 / (4.1 ** 0.5)
    assert abs(FR4_PROPAGATION_MM_PER_NS - expected) < 0.01, (
        f"FR4 propagation speed = {FR4_PROPAGATION_MM_PER_NS:.4f} mm/ns, "
        f"expected ≈ {expected:.4f} (c/sqrt(4.1))"
    )


def test_fr4_propagation_speed_consistent_across_modules():
    """FR4_PROPAGATION_MM_PER_NS must be identical in both layout modules."""
    assert abs(FR4_PROPAGATION_MM_PER_NS - CC_FR4_SPEED) < 1e-9, (
        "FR4_PROPAGATION_MM_PER_NS differs between freerouting_dsn.py and "
        "configure_constraints.py — keep them in sync."
    )


def test_fr4_mm_per_ps_is_ns_divided_by_1000():
    assert abs(FR4_PROPAGATION_MM_PER_PS - FR4_PROPAGATION_MM_PER_NS * 1e-3) < 1e-12


def test_usb_skew_limit_is_100ps():
    """SI-USB-02 specifies a 100ps intra-pair skew budget."""
    assert USB_SKEW_LIMIT_PS == 100.0


def test_usb_max_delta_mm_derived_from_100ps():
    """USB_MAX_DELTA_MM must equal exactly 100ps × FR4_PROPAGATION_MM_PER_PS."""
    expected = 100.0 * FR4_PROPAGATION_MM_PER_PS
    assert abs(USB_MAX_DELTA_MM - expected) < 1e-9


# ── skew_ps_from_delta_mm ─────────────────────────────────────────────────────


def test_skew_ps_zero_delta_is_zero():
    assert skew_ps_from_delta_mm(0.0) == 0.0


def test_skew_ps_at_max_delta_equals_limit():
    """USB_MAX_DELTA_MM of physical delta must convert to exactly USB_SKEW_LIMIT_PS."""
    ps = skew_ps_from_delta_mm(USB_MAX_DELTA_MM)
    assert abs(ps - USB_SKEW_LIMIT_PS) < 1e-6


def test_skew_ps_14mm_is_under_100ps():
    assert skew_ps_from_delta_mm(14.0) < 100.0


def test_skew_ps_15mm_exceeds_100ps():
    assert skew_ps_from_delta_mm(15.0) > 100.0


def test_skew_ps_3_4_5_triangle_segment():
    """3-4-5 right triangle → hypotenuse 5mm, skew = 5 / FR4_PROPAGATION_MM_PER_PS."""
    expected_ps = 5.0 / FR4_PROPAGATION_MM_PER_PS
    assert abs(skew_ps_from_delta_mm(5.0) - expected_ps) < 1e-9


# ── Net class skew_limit_ps fields ───────────────────────────────────────────


def test_usb_dsn_class_has_100ps_skew_limit():
    usb = next(d for d in ALL_DSN_CLASSES if "USB" in d.class_name)
    assert usb.skew_limit_ps == 100.0, (
        "USB_DSN.skew_limit_ps must be 100.0 (SI-USB-02)"
    )


def test_eth_dsn_class_has_no_skew_constraint():
    eth = next(d for d in ALL_DSN_CLASSES if "ETH" in d.class_name)
    assert eth.skew_limit_ps == 0.0


def test_configure_constraints_usb_class_has_100ps_skew_limit():
    usb = next(c for c in ALL_CLASSES if "USB" in c.name)
    assert usb.skew_limit_ps == 100.0


# ── _parse_ses_resolution ─────────────────────────────────────────────────────


def test_parse_ses_resolution_um_10():
    """(resolution um 10) → 1 unit = 0.1µm = 1e-4 mm."""
    result = _parse_ses_resolution("(session board (resolution um 10))")
    assert abs(result - 1e-4) < 1e-15


def test_parse_ses_resolution_mm_1():
    """(resolution mm 1) → 1 unit = 1mm."""
    result = _parse_ses_resolution("(session board (resolution mm 1))")
    assert abs(result - 1.0) < 1e-12


def test_parse_ses_resolution_mil_10():
    """(resolution mil 10) → 1 unit = 0.1mil = 0.00254mm."""
    result = _parse_ses_resolution("(session board (resolution mil 10))")
    assert abs(result - 0.00254) < 1e-12


def test_parse_ses_resolution_fallback_when_missing():
    """No resolution directive → default 1e-4 mm/unit."""
    assert _parse_ses_resolution("(session board)") == 1e-4


# ── _extract_net_length_mm ────────────────────────────────────────────────────


def test_extract_single_horizontal_segment():
    """(0,0)→(100,0) with mm_per_unit=1.0 → 100.0mm."""
    ses = "(routes (net USB_D_P (wire (path F.Cu 150 0 0 100 0))))"
    assert abs(_extract_net_length_mm(ses, "USB_D_P", 1.0) - 100.0) < 1e-9


def test_extract_two_consecutive_segments():
    """(0,0)→(50,0)→(100,0) → two 50mm segments → 100mm total."""
    ses = "(routes (net USB_D_P (wire (path F.Cu 150 0 0 50 0 100 0))))"
    assert abs(_extract_net_length_mm(ses, "USB_D_P", 1.0) - 100.0) < 1e-9


def test_extract_diagonal_3_4_5():
    """(0,0)→(30,40) → hypotenuse = 50mm."""
    ses = "(routes (net NET_A (wire (path F.Cu 150 0 0 30 40))))"
    assert abs(_extract_net_length_mm(ses, "NET_A", 1.0) - 50.0) < 1e-9


def test_extract_missing_net_returns_zero():
    ses = "(routes (net USB_D_P (wire (path F.Cu 150 0 0 100 0))))"
    assert _extract_net_length_mm(ses, "MISSING", 1.0) == 0.0


def test_extract_applies_mm_per_unit_scaling():
    """Coordinates in µm (mm_per_unit=0.001): 100,000 units → 100mm."""
    ses = "(routes (net USB_D_P (wire (path F.Cu 150 0 0 100000 0))))"
    assert abs(_extract_net_length_mm(ses, "USB_D_P", 0.001) - 100.0) < 1e-6


# ── validate_ses_intra_pair_skew ──────────────────────────────────────────────


def _write_ses(tmp_path: Path, len_p_mm: float, len_n_mm: float) -> str:
    """Write a minimal SES with mm-unit resolution and return the file path."""
    ses = tmp_path / "board.ses"
    ses.write_text(
        "(session board.ses\n"
        "  (resolution mm 1)\n"
        "  (routes\n"
        f"    (net USB_D_P (wire (path F.Cu 150 0 0 {len_p_mm} 0)))\n"
        f"    (net USB_D_N (wire (path F.Cu 150 0 0 {len_n_mm} 0)))\n"
        "  )\n"
        ")\n",
        encoding="utf-8",
    )
    return str(ses)


def test_validate_ses_passes_within_skew_budget(tmp_path):
    """Δ = 14mm → ≈ 94.6ps < 100ps → must not raise."""
    validate_ses_intra_pair_skew(_write_ses(tmp_path, 100.0, 114.0))


def test_validate_ses_raises_on_violation(tmp_path):
    """Δ = 15mm → ≈ 101.3ps > 100ps → AssertionError with SI-USB-02 in message."""
    with pytest.raises(AssertionError, match="SI-USB-02"):
        validate_ses_intra_pair_skew(_write_ses(tmp_path, 100.0, 115.0))


def test_validate_ses_raises_on_missing_file():
    with pytest.raises(FileNotFoundError):
        validate_ses_intra_pair_skew("/nonexistent/board.ses")


def test_validate_ses_raises_on_unrouted_net(tmp_path):
    """USB_D_N absent from SES (open route) → RuntimeError."""
    ses = tmp_path / "board.ses"
    ses.write_text(
        "(session board.ses\n"
        "  (resolution mm 1)\n"
        "  (routes\n"
        "    (net USB_D_P (wire (path F.Cu 150 0 0 100 0)))\n"
        "  )\n"
        ")\n",
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError):
        validate_ses_intra_pair_skew(str(ses))


def test_validate_ses_zero_delta_passes(tmp_path):
    """Perfectly matched traces (Δ=0) must pass unconditionally."""
    validate_ses_intra_pair_skew(_write_ses(tmp_path, 100.0, 100.0))


# ── _write_kicad_dru ─────────────────────────────────────────────────────────


def test_kicad_dru_created_alongside_board(tmp_path):
    board_path = str(tmp_path / "daemon_v0.kicad_pcb")
    _write_kicad_dru(board_path, ALL_CLASSES)
    dru = tmp_path / "daemon_v0.kicad_dru"
    assert dru.exists(), ".kicad_dru must be written next to the .kicad_pcb"


def test_kicad_dru_contains_diff_pair_skew_constraint(tmp_path):
    board_path = str(tmp_path / "board.kicad_pcb")
    _write_kicad_dru(board_path, ALL_CLASSES)
    content = (tmp_path / "board.kicad_dru").read_text()
    assert "diff_pair_skew" in content, "DRU must contain diff_pair_skew constraint"


def test_kicad_dru_references_usb_net_class(tmp_path):
    board_path = str(tmp_path / "board.kicad_pcb")
    _write_kicad_dru(board_path, ALL_CLASSES)
    content = (tmp_path / "board.kicad_dru").read_text()
    assert "DIFF_USB_90" in content


def test_kicad_dru_references_si_usb_02(tmp_path):
    board_path = str(tmp_path / "board.kicad_pcb")
    _write_kicad_dru(board_path, ALL_CLASSES)
    content = (tmp_path / "board.kicad_dru").read_text()
    assert "SI_USB_02" in content, "DRU must reference the audit test identifier SI_USB_02"


def test_kicad_dru_max_delta_is_physically_correct(tmp_path):
    """The Δ_max value in the DRU must equal USB_MAX_DELTA_MM (≈ 14.81mm)."""
    board_path = str(tmp_path / "board.kicad_pcb")
    _write_kicad_dru(board_path, ALL_CLASSES)
    content = (tmp_path / "board.kicad_dru").read_text()
    expected = f"{USB_MAX_DELTA_MM:.2f}mm"
    assert expected in content, (
        f"DRU must contain the computed Δ_max = {expected} (100ps × v_FR4)"
    )
