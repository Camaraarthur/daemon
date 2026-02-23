"""Tests for Phase 4b – FreeRouting DSN differential pair directive injection."""

import pytest
from layout.freerouting_dsn import (
    ALL_DSN_CLASSES,
    DsnDiffPairClass,
    _build_class_directive,
    _build_network_addendum,
    _find_network_block_end,
    patch_dsn_for_freerouting,
)


def test_all_dsn_classes_have_required_fields():
    for dp in ALL_DSN_CLASSES:
        assert dp.class_name
        assert dp.net_p
        assert dp.net_n
        assert dp.trace_width_mm > 0
        assert dp.diff_gap_mm > 0


def test_usb_class_tighter_gap_than_ethernet():
    usb = next(d for d in ALL_DSN_CLASSES if "USB" in d.class_name)
    eth = next(d for d in ALL_DSN_CLASSES if "ETH" in d.class_name)
    assert usb.diff_gap_mm <= eth.diff_gap_mm, (
        "USB 90Ω pair gap must be ≤ Ethernet 100Ω pair gap"
    )


def test_class_directive_contains_pair_stanza():
    dp = ALL_DSN_CLASSES[0]
    directive = _build_class_directive(dp)
    assert "(pair (nets" in directive


def test_class_directive_contains_both_nets():
    for dp in ALL_DSN_CLASSES:
        directive = _build_class_directive(dp)
        assert dp.net_p in directive
        assert dp.net_n in directive


def test_network_block_end_found():
    sample_dsn = """
(pcb test_board
  (network
    (net USB_D_P (pins U1-15))
    (net USB_D_N (pins U1-14))
  )
  (wiring)
)
"""
    idx = _find_network_block_end(sample_dsn)
    assert idx != -1
    assert sample_dsn[idx] == ")"


def test_network_block_end_not_found_on_missing_section():
    assert _find_network_block_end("(pcb test_board (wiring))") == -1


def test_patch_dsn_injects_and_backs_up(tmp_path):
    """End-to-end: patch a minimal DSN file and verify directives appear."""
    dsn_file = tmp_path / "test.dsn"
    dsn_file.write_text(
        "(pcb test_board\n"
        "  (network\n"
        "    (net USB_D_P (pins U1-15))\n"
        "    (net USB_D_N (pins U1-14))\n"
        "    (net ENET_TRD0_P (pins U2-10))\n"
        "    (net ENET_TRD0_N (pins U2-11))\n"
        "  )\n"
        ")\n",
        encoding="utf-8",
    )

    patch_dsn_for_freerouting(str(dsn_file))

    patched = dsn_file.read_text(encoding="utf-8")
    backup = dsn_file.with_suffix(".dsn.bak")

    assert backup.exists(), "Backup file should be created"
    assert "(pair (nets USB_D_P USB_D_N))" in patched
    assert "(pair (nets ENET_TRD0_P ENET_TRD0_N))" in patched
    assert "DIFF_USB_90" in patched
    assert "DIFF_ETH_100" in patched


def test_patch_dsn_raises_on_missing_file():
    with pytest.raises(SystemExit):
        patch_dsn_for_freerouting("/nonexistent/path/board.dsn")
