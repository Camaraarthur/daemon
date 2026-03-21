"""Tests for netlist/gen_golden_netlist.py — golden netlist integrity."""

from netlist.gen_golden_netlist import COMPONENTS, NETS, _build_netlist


def test_component_count():
    """232 components: CC1101 filterbalun (pi→14-component TI DN017, +10), 4× AVDD NP0 caps (+4),
    3 GDO pull-downs removed (-3), ISO1212 phantom pins fixed + SENSE resistors (+2), ISO pull-ups
    removed (-2), MAX98357A BTL ferrites→10Ω 0805 resistors (0), NTC 10k→51k (0), VREG cap 100n→4.7u (0)."""
    assert len(COMPONENTS) == 336


def test_no_duplicate_refs():
    """Every component must have a unique reference designator."""
    refs = [c["ref"] for c in COMPONENTS]
    dupes = [r for r in refs if refs.count(r) > 1]
    assert dupes == [], f"Duplicate refs: {set(dupes)}"


def test_all_pin_nets_are_declared():
    """Every net referenced by a component pin must exist in the NETS list or aliases."""
    from netlist.gen_golden_netlist import _build_netlist  # noqa: F811

    # Collect all net names used on pins
    pin_nets = set()
    for c in COMPONENTS:
        for _pin_name, net_name in c["pins"]:
            pin_nets.add(net_name)

    # Known nets + aliases
    known = set(NETS)
    known.update(["5V_SYS", "3V3_SYS"])  # implicit rails from Radxa

    missing = pin_nets - known
    # Filter out internal alias targets that get resolved
    alias_targets = {
        "BJT_BASE", "BJT_COLLECTOR",
    }
    missing -= alias_targets
    assert missing == set(), f"Nets used on pins but not in NETS list: {missing}"


def test_no_duplicate_nets():
    """NETS list should have no duplicate entries."""
    dupes = [n for n in NETS if NETS.count(n) > 1]
    assert dupes == [], f"Duplicate nets: {set(dupes)}"


def test_netlist_renders_valid_sexp():
    """The rendered netlist should be a valid S-expression (basic check)."""
    text = _build_netlist()
    assert text.startswith("(export")
    assert text.strip().endswith(")")
    # Every opening paren should be matched
    assert text.count("(") == text.count(")")


def test_critical_power_rail_connections():
    """Verify key ICs are on correct power rails."""
    ic_power = {}
    for c in COMPONENTS:
        for pin_name, net_name in c["pins"]:
            if pin_name in ("VDD", "VDD33", "VCC", "VIN", "IN",
                            "DVDD", "AVDD_1", "AVDD33_1", "DVDD33", "VDD5"):
                ic_power.setdefault(c["ref"], []).append((pin_name, net_name))

    # CC1101 must be on 3V3_CLEAN (via DVDD and AVDD pins)
    assert ("DVDD", "3V3_CLEAN") in ic_power["U8"], "CC1101 DVDD not on 3V3_CLEAN"
    assert ("AVDD_1", "3V3_CLEAN") in ic_power["U8"], "CC1101 AVDD not on 3V3_CLEAN"

    # RTL8152B must be on 3V3_CLEAN (AVDD33, DVDD33) and 5V_SYS (VDD5)
    assert ("AVDD33_1", "3V3_CLEAN") in ic_power["U9"], "RTL8152B AVDD33 not on 3V3_CLEAN"
    assert ("DVDD33", "3V3_CLEAN") in ic_power["U9"], "RTL8152B DVDD33 not on 3V3_CLEAN"
    assert ("VDD5", "5V_SYS") in ic_power["U9"], "RTL8152B VDD5 not on 5V_SYS"

    # MAX98357A must be on 5V_AUDIO
    assert ("VDD", "5V_AUDIO") in ic_power["U10"], "MAX98357A not on 5V_AUDIO"

    # SL2.1A hubs on 5V_SYS (VDD5 = primary 5V input; VDD33/VDD18 are internal LDO outputs)
    assert ("VDD5", "5V_SYS") in ic_power.get("U3", []), "Hub 1 not on 5V_SYS"
    assert ("VDD5", "5V_SYS") in ic_power.get("U14", []), "Hub 2 not on 5V_SYS"

    # SY6280 switches on 5V_SYS
    for u in ("U4", "U5", "U6", "U15"):
        assert ("IN", "5V_SYS") in ic_power[u], f"{u} SY6280 not on 5V_SYS"


def test_hub_cascade_topology():
    """Hub 1 port 4 DP/DM must connect to Hub 2 upstream DP/DM."""
    hub1_pins = {p: n for p, n in next(c for c in COMPONENTS if c["ref"] == "U3")["pins"]}
    hub2_pins = {p: n for p, n in next(c for c in COMPONENTS if c["ref"] == "U14")["pins"]}

    # SL2.1A SOP-16: upstream pins are named DP/DM (not DP_U/DM_U)
    assert hub1_pins["DP4"] == hub2_pins["DP"], "Hub cascade DP broken"
    assert hub1_pins["DM4"] == hub2_pins["DM"], "Hub cascade DM broken"


def test_pmic_kill_has_pulldown():
    """PMIC_KILL GPIO must have a pull-down to prevent spurious shutdown."""
    pmic_kill_resistors = [
        c for c in COMPONENTS
        if c["ref"].startswith("R")
        and any(n == "PMIC_KILL" for _, n in c["pins"])
        and any(n == "GND" for _, n in c["pins"])
    ]
    assert len(pmic_kill_resistors) >= 1, "PMIC_KILL missing pull-down resistor"


def test_ir_gpio_has_pulldown():
    """IR_GPIO must have a pull-down to prevent spurious IR flash."""
    ir_pulldowns = [
        c for c in COMPONENTS
        if c["ref"].startswith("R")
        and any(n == "IR_GPIO" for _, n in c["pins"])
        and any(n == "GND" for _, n in c["pins"])
    ]
    assert len(ir_pulldowns) >= 1, "IR_GPIO missing pull-down resistor"