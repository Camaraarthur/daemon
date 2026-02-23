"""Tests for Phase 1 – DFT: IP5306 test-point and isolation-jumper definitions."""

import pytest
from dft.ip5306_testpoints import (
    IP5306_DFT_COMPONENTS,
    DFTComponent,
    validate_dft_coverage,
)


def test_all_components_have_required_fields():
    for comp in IP5306_DFT_COMPONENTS:
        assert comp.ref, f"Missing ref on component: {comp}"
        assert comp.kind in ("test_point", "isolation_jumper"), f"Unknown kind: {comp.kind}"
        assert comp.net, f"Missing net on {comp.ref}"
        assert comp.ic_pin, f"Missing ic_pin on {comp.ref}"
        assert comp.footprint, f"Missing footprint on {comp.ref}"
        assert comp.validation_purpose, f"Missing validation_purpose on {comp.ref}"


def test_coverage_passes_with_full_set():
    """validate_dft_coverage should not raise with the canonical component list."""
    validate_dft_coverage(IP5306_DFT_COMPONENTS)


def test_coverage_fails_with_missing_pin():
    """Removing a test-point should trigger a RuntimeError for the missing pin."""
    # Remove TP1 (Pin 1 / VIN)
    reduced = [c for c in IP5306_DFT_COMPONENTS if c.ref != "TP1"]
    with pytest.raises(RuntimeError, match="Pin 1"):
        validate_dft_coverage(reduced)


def test_exactly_two_isolation_jumpers():
    jumpers = [c for c in IP5306_DFT_COMPONENTS if c.kind == "isolation_jumper"]
    assert len(jumpers) == 2, f"Expected 2 isolation jumpers, got {len(jumpers)}"


def test_isolation_jumpers_have_two_iso_nets():
    for comp in IP5306_DFT_COMPONENTS:
        if comp.kind == "isolation_jumper":
            assert len(comp.iso_nets) == 2, (
                f"Isolation jumper {comp.ref} must declare exactly 2 iso_nets"
            )


def test_test_points_have_spice_stimulus():
    for comp in IP5306_DFT_COMPONENTS:
        if comp.kind == "test_point":
            assert comp.spice_stimulus, (
                f"Test point {comp.ref} is missing a SPICE stimulus description"
            )


def test_footprints_are_kicad_format():
    """Every footprint string must follow the 'Library:Footprint' format."""
    for comp in IP5306_DFT_COMPONENTS:
        assert ":" in comp.footprint, (
            f"{comp.ref} footprint '{comp.footprint}' is not in 'Library:Footprint' format"
        )
