"""
netlist/full_system.py
Phase 2 – Full System SKiDL Netlist: Daemon V0

Instantiates and wires every subsystem in the Daemon V0 architecture:

  Subsystem A – IP5328P Power Management
    · IP5328P (QFN-40): high-current boost converter + Li-ion charger + I2C telemetry
    · 4.7µH high-current boost inductor (Isat > 5A) on the SW node
    · DFT test points TP1–TP4 and 0Ω isolation jumpers J1/J2
      (net names and footprints match dft/ip5306_testpoints.py exactly)
    · LED status resistors on LED1/LED2/LED3 indicator pins
    · MFB pull-up resistor (multi-function button, active-low)

  Subsystem B – SL2.1A 4-Port USB 2.0 Hub
    · SL2.1A (QFN-28): full-speed / high-speed USB 2.0 hub controller
    · 12 MHz crystal + 22 pF load caps
    · 12 kΩ RBIAS resistor
    · Per-rail decoupling cap banks
    · CFG straps, RST_N pull-up, OC_N pull-ups (for SY6280 FLAG lines)
    · 4 downstream USB D+/D− pairs; port 4 left as a named net for the
      RTL8152B Ethernet module (defined in a future subsystem file)

  Subsystem C – Stinger Ports (3 × SY6280AAC power-distribution switch)
    · One SY6280AAC (SOT-23-5) per user-accessible USB-A port
    · 5V_SYS → SY6280 IN → USB_VBUS_x gating
    · EN pin driven by Radxa GPIO (active-high; default ON via 10 kΩ pull-up)
    · FLAG pin (open-drain, active-low) feeds SL2.1A OC_Nx; 10 kΩ pull-up
      to 3V3_SYS; automatic 150 Ω internal discharge on shutdown
    · USB-A connector per port; D+/D− from SL2.1A downstream pairs

  Subsystem D – 1.47″ SPI Display
    · 8-pin SIL connector for ST7789V2-based 172×320 display module
    · SCK / MOSI / CS from Radxa SPI0 bus
    · DC / RST driven by dedicated Radxa GPIOs
    · BL (backlight PWM) from Radxa PWM0 / GPIO12

  Subsystem E – Analog Joystick
    · 5-pin SIL connector (GND, VCC, VRX, VRY, SW)
    · VRX / VRY routed to ADC-capable Radxa header pins
    · SW (active-low push) to GPIO with 10 kΩ pull-up to 3V3_SYS

  Subsystem F – 40-Pin Radxa Expansion Header
    · 2×20 P2.54 mm connector; Raspberry Pi HAT / Radxa pinout
    · All 40 pins named: power rails, SPI0, I2C1, I2S/PCM, UART, PWM,
      GPIO for screen control, joystick ADC, Stinger EN/FLAG, and spare GPIOs

Power topology:
    Li-ion cell ──► IP5328P BAT ──► SW / inductor ──► VOUT
    VOUT ──[J2 0Ω]──► 5V_SYS ──► SL2.1A VCC, SY6280×3 IN, Radxa header 5V
    Radxa header 3.3V ──► 3V3_SYS ──► screen VCC, joystick VCC, pull-ups

Custom KiCad symbol library required (add to ./lib/Daemon_V0.kicad_sym):
    IP5328P, SL2.1A, SY6280AAC

Usage:
    python -m netlist.full_system
    # → writes daemon_v0_full_system.net
"""

from __future__ import annotations

import sys

try:
    import skidl
    from skidl import ERC, Net, Part, generate_netlist
    from skidl import TEMPLATE
except ModuleNotFoundError as exc:
    sys.exit(f"SKiDL not installed. Run: pip install skidl\n{exc}")


# ── Output ────────────────────────────────────────────────────────────────────

NETLIST_OUTPUT = "daemon_v0_full_system.net"

# ── Footprints ────────────────────────────────────────────────────────────────

# Power management
FP_IP5328P     = "Package_DFN_QFN:QFN-40-1EP_6x6mm_P0.5mm_EP4.2x4.2mm"
FP_INDUCTOR_5A = "Inductor_SMD:L_Bourns_SRR1260"  # same SMD package; Isat > 5A
FP_LDO_SOT223  = "Package_TO_SOT_SMD:SOT-223-3_TabPin2"

# USB hub
FP_SL2_1A       = "Package_DFN_QFN:QFN-28-1EP_5x5mm_P0.5mm_EP3.35x3.35mm"
FP_XTAL_12M     = "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm"
FP_USB_A        = "Connector_USB:USB_A_Plug_Horizontal"

# Stinger switches
FP_SY6280       = "Package_TO_SOT_SMD:SOT-23-5"

# Connectors
FP_RADXA_HDR    = "Connector_PinHeader_2.54mm:PinHeader_2x20_P2.54mm_Vertical"
FP_SCREEN_CONN  = "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical"
FP_JOY_CONN     = "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical"
FP_BAT_CONN     = "Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal"

# DFT
FP_TP_D15       = "TestPoint:TestPoint_Pad_D1.5mm"
FP_TP_D10       = "TestPoint:TestPoint_Pad_D1.0mm"

# Passives
FP_R0402        = "Resistor_SMD:R_0402_1005Metric"
FP_C0402        = "Capacitor_SMD:C_0402_1005Metric"
FP_C0805        = "Capacitor_SMD:C_0805_2012Metric"
# SM-AUD-01: ESD9B5.0ST5G bidirectional TVS (ON Semi, SC-70-3 package)
FP_TVS_SC70     = "Package_TO_SOT_SMD:SC-70-3"
# IND-SAF-01: Vishay VCAN26A2 bidirectional TVS (SMB / DO-214AA)
FP_TVS_SMB      = "Diode_SMD:D_SMB"
# IND-SAF-01: Littelfuse 60R series resettable PTC fuse (1206)
FP_PTC_1206     = "Fuse_SMD:Fuse_1206_3216Metric"
# PDN-JMP-04: 1225 wide-terminal reverse-geometry shunt (≥3.5A rated)
FP_JUMPER_1225  = "Resistor_SMD:R_1225_3264Metric"
# SM-PWR-02: heartbeat keepalive components
FP_TIMER_NE555  = "Package_DIP:DIP-8_W7.62mm"
FP_BJT_SOT23    = "Package_TO_SOT_SMD:SOT-23"
FP_C_ELEC_6MM   = "Capacitor_THT:CP_Radial_D6.3mm_P2.50mm"

# Protocol analyzers and bus interfaces (Subsystems H–J)
FP_CC1101        = "Package_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm"
FP_MCP2515       = "Package_SO:SOIC-18W_7.5x11.6mm_P1.27mm"
FP_MCP2551       = "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
FP_ISO1212       = "Package_SO:SOIC-16W_7.5x10.3mm_P1.27mm"
FP_CONN_1X02_254 = "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical"
FP_CONN_1X03_254 = "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical"
FP_CONN_1X04_254 = "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical"

# ── SM-LOG-03: SD_MODE pull-up formula (mirrors netlist/audio_subsystem.py) ──
# MAX98357A datasheet: R_LARGE (kΩ) = 222.2 × V_DDIO − 100
# Keep in sync with audio_subsystem.py; any VDDIO domain change must update
# both files and regenerate the netlist.
VDDIO_V: float = 3.3
SD_MODE_PULLUP_KOHM: int = round(222.2 * VDDIO_V - 100)   # → 633 kΩ
SD_MODE_PULLUP_VALUE: str = f"{SD_MODE_PULLUP_KOHM}k"      # → "633k"


# ── Subsystem A: IP5328P Power Management ────────────────────────────────────


def _build_power_system(
    gnd: Net,
    vcc_5v: Net,
    i2c0_sda: Net,   # Radxa pin 27 – IP5328P SDA telemetry
    i2c0_scl: Net,   # Radxa pin 28 – IP5328P SCL telemetry
) -> dict[str, Net]:
    """
    Instantiate the IP5328P boost converter / Li-ion charger subsystem.

    DFT nodes match dft/ip5306_testpoints.py exactly:
      TP1 → VIN     TP2 → BAT     TP3 → SW     TP4 → VOUT
      J1  → BAT_ISO (series on BAT line)
      J2  → VOUT_ISO (series on VOUT line; far side feeds 5V_SYS)

    Returns a dict of critical nets for use by the PySpice simulation phase.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)
    # PDN-JMP-04: 1225 wide-terminal package for primary-path isolation jumpers.
    # The 0402 package is rated 1.5A max; 1225 handles ≥3.5A without vaporising.
    HiCurrJumper = Part("Device", "R", dest=TEMPLATE, footprint=FP_JUMPER_1225)

    # ── IC ────────────────────────────────────────────────────────────────────
    ic = Part(
        "Daemon_V0", "IP5328P",
        footprint=FP_IP5328P,
        value="IP5328P",
    )

    # ── Boost inductor (SW node) ──────────────────────────────────────────────
    L1 = Part(
        "Device", "L",
        footprint=FP_INDUCTOR_5A,
        value="4u7",  # 4.7µH Isat > 5A
    )

    # ── Battery connector (JST-PH 2-pin, Li-ion cell) ─────────────────────────
    bat_conn = Part(
        "Connector_Generic", "Conn_01x02",
        footprint=FP_BAT_CONN,
    )

    # ── DFT: test points ──────────────────────────────────────────────────────
    TP1 = Part("Device", "TestPoint", footprint=FP_TP_D15, value="TP_VIN")
    TP2 = Part("Device", "TestPoint", footprint=FP_TP_D15, value="TP_BAT")
    TP3 = Part("Device", "TestPoint", footprint=FP_TP_D10, value="TP_SW")
    TP4 = Part("Device", "TestPoint", footprint=FP_TP_D15, value="TP_VOUT")

    # ── DFT: 0Ω isolation jumpers ────────────────────────────────────────────
    J1 = HiCurrJumper(value="0")   # BAT  → BAT_ISO  (PDN-JMP-04: 1225 wide-terminal)
    J2 = HiCurrJumper(value="0")   # VOUT → VOUT_ISO (far side = 5V_SYS)

    # ── Passives ──────────────────────────────────────────────────────────────
    # MFB: 100 kΩ pull-up to VIN keeps the multi-function button inactive
    mfb_pullup = Resistor(value="100k")
    # LED current-limit resistors (forward-voltage ~2V, 1mA target from 5V)
    r_led1, r_led2, r_led3 = Resistor(num_copies=3, value="3.3k")
    # Input decoupling: 10µF bulk + 100nF bypass on VIN
    cin_bulk = Capacitor_bulk(value="10u")
    cin_bypass = Capacitor(value="100n")
    # BAT decoupling
    cbat_bulk = Capacitor_bulk(value="10u")
    cbat_bypass = Capacitor(value="100n")
    # Output decoupling: 22µF bulk + 100nF bypass on VOUT (matches PySpice model)
    cout_bulk = Capacitor_bulk(value="22u")
    cout_bypass = Capacitor(value="100n")

    # ── Internal nets ─────────────────────────────────────────────────────────
    vin      = Net("VIN")        # 5V USB charge input
    bat      = Net("BAT")        # battery cell + terminal (raw)
    bat_iso  = Net("BAT_ISO")    # battery cell + terminal (isolated for ATE)
    sw       = Net("SW")         # 500 kHz DC-DC switch node
    vout     = Net("VOUT")       # raw boost output
    vout_iso = Net("VOUT_ISO")   # isolated boost output (far side of J2)
    mfb_net  = Net("MFB")
    led1_net = Net("LED1")
    led2_net = Net("LED2")
    led3_net = Net("LED3")

    # J2 far side feeds the system 5V bus
    vout_iso += vcc_5v

    # ── IC power ──────────────────────────────────────────────────────────────
    ic["VIN"]  += vin
    ic["BAT"]  += bat_iso         # BAT pin sits behind J1 isolation jumper
    ic["SW"]   += sw
    ic["VOUT"] += vout
    ic["MFB"]  += mfb_net
    ic["LED1"] += led1_net
    ic["LED2"] += led2_net
    ic["LED3"] += led3_net
    ic["SDA"]  += i2c0_sda        # IP5328P I2C telemetry → Radxa pin 27
    ic["SCL"]  += i2c0_scl        # IP5328P I2C telemetry → Radxa pin 28

    # ── Boost inductor: between SW node and VOUT ──────────────────────────────
    L1[1] += sw
    L1[2] += vout

    # ── Battery connector ─────────────────────────────────────────────────────
    bat_conn[1] += bat      # cell positive → BAT (before J1)
    bat_conn[2] += gnd      # cell negative

    # ── Isolation jumpers ────────────────────────────────────────────────────
    J1[1] += bat            # BAT (raw) → J1 → BAT_ISO → IC pin 6
    J1[2] += bat_iso
    J2[1] += vout           # VOUT (raw) → J2 → VOUT_ISO → 5V_SYS
    J2[2] += vout_iso

    # ── DFT test point connections ────────────────────────────────────────────
    TP1["P"] += vin
    TP2["P"] += bat         # probe raw BAT for charge-curve analysis
    TP3["P"] += sw
    TP4["P"] += vout

    # ── MFB pull-up ──────────────────────────────────────────────────────────
    mfb_pullup[1] += vin
    mfb_pullup[2] += mfb_net

    # ── LED resistors: IC pin → resistor → GND ───────────────────────────────
    r_led1[1] += led1_net;  r_led1[2] += gnd
    r_led2[1] += led2_net;  r_led2[2] += gnd
    r_led3[1] += led3_net;  r_led3[2] += gnd

    # ── VIN decoupling ────────────────────────────────────────────────────────
    cin_bulk[1]   += vin;  cin_bulk[2]   += gnd
    cin_bypass[1] += vin;  cin_bypass[2] += gnd

    # ── BAT decoupling ────────────────────────────────────────────────────────
    cbat_bulk[1]   += bat;  cbat_bulk[2]   += gnd
    cbat_bypass[1] += bat;  cbat_bypass[2] += gnd

    # ── VOUT decoupling ───────────────────────────────────────────────────────
    cout_bulk[1]   += vout;  cout_bulk[2]   += gnd
    cout_bypass[1] += vout;  cout_bypass[2] += gnd

    return {"VIN": vin, "BAT": bat, "SW": sw, "VOUT": vout, "VOUT_ISO": vout_iso}


# ── Subsystem B: SL2.1A 4-Port USB 2.0 Hub ───────────────────────────────────


def _build_usb_hub(
    gnd: Net,
    vcc_5v: Net,
    vcc_3v3: Net,
) -> dict[str, list[Net]]:
    """
    Instantiate the SL2.1A USB 2.0 hub controller.

    Upstream D+/D− connect to a dedicated USB-B upstream connector so the
    host Radxa SBC attaches via a standard USB cable (not the 40-pin header).

    Returns a dict with four downstream D+/D− net pairs for the Stinger
    ports and the RTL8152B Ethernet module:
        {"dn": [(DP1, DM1), (DP2, DM2), (DP3, DM3), (DP4, DM4)]}
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    # ── ICs ───────────────────────────────────────────────────────────────────
    hub = Part(
        "Daemon_V0", "SL2.1A",
        footprint=FP_SL2_1A,
        value="SL2.1A",
    )

    # 12 MHz crystal – SL2.1A requires external clock reference
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_12M,
        value="12MHz",
    )

    # Upstream USB-B connector (female; host cable plugs in here)
    usb_up_conn = Part(
        "Connector_USB", "USB_B",
        footprint="Connector_USB:USB_B_Molex_48037_Vertical",
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    # Crystal load capacitors (22 pF each)
    cxtal_a, cxtal_b = Capacitor(num_copies=2, value="22p")

    # RBIAS: 12 kΩ from RBIAS pin to GND – sets USB signalling bias current
    rbias_res = Resistor(value="12k")

    # RST_N pull-up: 10 kΩ to 3V3_SYS keeps hub out of reset at power-on
    rst_pullup = Resistor(value="10k")

    # CFG strap resistors: pulled to GND (CFG0) and 3V3 (CFG1, CFG2) for
    # default 4-port, self-powered, no-gang-power configuration
    cfg0_pulldown = Resistor(value="10k")
    cfg1_pullup   = Resistor(value="10k")
    cfg2_pullup   = Resistor(value="10k")

    # OC_N pull-ups: 10 kΩ to 3V3 for each SY6280 FLAG line
    oc_pullup_1, oc_pullup_2, oc_pullup_3 = Resistor(num_copies=3, value="10k")

    # Power decoupling
    vdd_bulk   = Capacitor_bulk(value="10u")
    vdd_byp_a, vdd_byp_b = Capacitor(num_copies=2, value="100n")

    # ── Nets ──────────────────────────────────────────────────────────────────
    # Upstream USB pair (to Radxa host via USB-B connector)
    usb_up_dp = Net("USB_UP_DP")
    usb_up_dm = Net("USB_UP_DM")

    # Downstream pairs for the three Stinger ports + one for RTL8152B
    usb_dn_dp = [Net(f"USB_DN_DP_{i}") for i in range(1, 5)]
    usb_dn_dm = [Net(f"USB_DN_DM_{i}") for i in range(1, 5)]

    # Control nets
    rst_n  = Net("HUB_RST_N")
    susp_n = Net("HUB_SUSP_N")

    # OC_N / FLAG lines for the three Stinger ports
    oc_n = [Net(f"STINGER_FLAG_{i}") for i in range(1, 4)]

    # CFG nets
    cfg0 = Net("HUB_CFG0")
    cfg1 = Net("HUB_CFG1")
    cfg2 = Net("HUB_CFG2")

    # ── Hub IC connections ────────────────────────────────────────────────────
    hub["VDD33"]  += vcc_3v3
    hub["GND"]    += gnd

    # Upstream port
    hub["DP_U"]   += usb_up_dp
    hub["DM_U"]   += usb_up_dm

    # Downstream ports
    for i, (dp, dm) in enumerate(zip(usb_dn_dp, usb_dn_dm), start=1):
        hub[f"DP{i}"] += dp
        hub[f"DM{i}"] += dm

    # Crystal
    hub["XI"]     += Net("HUB_XI")
    hub["XO"]     += Net("HUB_XO")

    # Bias and control
    hub["RBIAS"]  += Net("HUB_RBIAS")
    hub["RST_N"]  += rst_n
    hub["SUSP_N"] += susp_n

    # Overcurrent inputs (active-low, from SY6280 FLAG open-drain)
    hub["OC_N1"]  += oc_n[0]
    hub["OC_N2"]  += oc_n[1]
    hub["OC_N3"]  += oc_n[2]
    hub["OC_N4"]  += vcc_3v3      # port 4 (RTL8152B) – no power switch needed

    # CFG straps
    hub["CFG0"]   += cfg0
    hub["CFG1"]   += cfg1
    hub["CFG2"]   += cfg2

    # SUSP_N – tie high; host-driven suspend not used in this design
    susp_n += vcc_3v3

    # ── USB-B upstream connector ──────────────────────────────────────────────
    usb_up_conn["VBUS"] += vcc_5v     # host provides 5V via USB
    usb_up_conn["D-"]   += usb_up_dm
    usb_up_conn["D+"]   += usb_up_dp
    usb_up_conn["GND"]  += gnd
    usb_up_conn["Shield"] += gnd

    # ── Crystal + load capacitors ─────────────────────────────────────────────
    xtal[1]       += hub["XI"].net    # KiCad pin 1 = one terminal
    xtal[2]       += hub["XO"].net
    cxtal_a[1]    += hub["XI"].net;  cxtal_a[2] += gnd
    cxtal_b[1]    += hub["XO"].net;  cxtal_b[2] += gnd

    # ── RBIAS ────────────────────────────────────────────────────────────────
    rbias_res[1]  += hub["RBIAS"].net
    rbias_res[2]  += gnd

    # ── RST_N pull-up ─────────────────────────────────────────────────────────
    rst_pullup[1] += vcc_3v3
    rst_pullup[2] += rst_n

    # ── CFG straps ────────────────────────────────────────────────────────────
    cfg0_pulldown[1] += cfg0;  cfg0_pulldown[2] += gnd
    cfg1_pullup[1]   += vcc_3v3;  cfg1_pullup[2] += cfg1
    cfg2_pullup[1]   += vcc_3v3;  cfg2_pullup[2] += cfg2

    # ── OC_N pull-ups (FLAG lines are open-drain; need external pull-up) ──────
    oc_pullup_1[1] += vcc_3v3;  oc_pullup_1[2] += oc_n[0]
    oc_pullup_2[1] += vcc_3v3;  oc_pullup_2[2] += oc_n[1]
    oc_pullup_3[1] += vcc_3v3;  oc_pullup_3[2] += oc_n[2]

    # ── VDD33 decoupling ─────────────────────────────────────────────────────
    vdd_bulk[1]   += vcc_3v3;  vdd_bulk[2]   += gnd
    vdd_byp_a[1]  += vcc_3v3;  vdd_byp_a[2]  += gnd
    vdd_byp_b[1]  += vcc_3v3;  vdd_byp_b[2]  += gnd

    return {"dn": list(zip(usb_dn_dp, usb_dn_dm)), "oc_n": oc_n}


# ── Subsystem C: Stinger Port (one SY6280AAC + USB-A) ────────────────────────


def _build_stinger_port(
    port_num: int,
    gnd: Net,
    vcc_5v: Net,
    vcc_3v3: Net,
    dp_net: Net,
    dm_net: Net,
    en_net: Net,
    flag_net: Net,
) -> Net:
    """
    Instantiate one Stinger port: SY6280AAC power-distribution switch + USB-A.

    Power path:  5V_SYS → SY6280 IN → SY6280 OUT → USB_VBUS_<n>
    Data path:   dp_net / dm_net from SL2.1A downstream → USB-A connector

    The SY6280's automatic 150 Ω internal discharge path bleeds OUT
    capacitance on shutdown, preventing ghost-unplug events in downstream
    microcontrollers (proven by the PySpice τ assertion in Phase 3).

    EN  is driven HIGH by a Radxa GPIO to enable power (default ON via
        10 kΩ pull-up so the port stays live if the GPIO is tristated).
    FLAG is open-drain active-low; pulled to 3V3 via the hub OC pull-ups
        defined in _build_usb_hub.  Signals overcurrent / overtemperature.

    Returns the USB_VBUS_<n> net (the switched VBUS output).
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    n = port_num

    # ── SY6280AAC power-distribution switch ───────────────────────────────────
    sw = Part(
        "Daemon_V0", "SY6280AAC",
        footprint=FP_SY6280,
        value="SY6280AAC",
    )

    # ── USB Type-A downstream connector ──────────────────────────────────────
    usb_a = Part(
        "Connector_USB", "USB_A",
        footprint=FP_USB_A,
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    # EN pull-up: keeps port powered if Radxa GPIO is tristated at boot
    en_pullup = Resistor(value="10k")
    # Input and output decoupling (10µF bulk + 100nF bypass each side)
    cin_bulk    = Capacitor_bulk(value="10u")
    cin_bypass  = Capacitor(value="100n")
    cout_bulk   = Capacitor_bulk(value="10u")     # matches PySpice SY_COUT model
    cout_bypass = Capacitor(value="100n")
    # ISET: 17 kΩ sets SY6280 over-current threshold to 400mA
    # Formula: R_ISET = 6800 / I_OC → 6800 / 0.4 = 17000 Ω
    iset_res = Resistor(value="17k")

    # ── Nets ──────────────────────────────────────────────────────────────────
    vbus_out = Net(f"USB_VBUS_{n}")     # switched VBUS to the USB-A receptacle
    iset_net = Net(f"STINGER_ISET_{n}")  # ISET current-sense node

    # ── SY6280 connections ────────────────────────────────────────────────────
    sw["IN"]   += vcc_5v
    sw["GND"]  += gnd
    sw["EN"]   += en_net
    sw["FLAG"] += flag_net
    sw["OUT"]  += vbus_out
    sw["ISET"] += iset_net

    # ── ISET resistor: ISET pin → 17kΩ → GND (limits I_OC to 400mA) ─────────
    iset_res[1] += iset_net
    iset_res[2] += gnd

    # ── EN pull-up ────────────────────────────────────────────────────────────
    en_pullup[1] += vcc_3v3
    en_pullup[2] += en_net

    # ── USB-A connector ───────────────────────────────────────────────────────
    usb_a["VBUS"]   += vbus_out
    usb_a["D-"]     += dm_net
    usb_a["D+"]     += dp_net
    usb_a["GND"]    += gnd
    usb_a["Shield"] += gnd

    # ── Decoupling ────────────────────────────────────────────────────────────
    cin_bulk[1]    += vcc_5v;   cin_bulk[2]    += gnd
    cin_bypass[1]  += vcc_5v;   cin_bypass[2]  += gnd
    cout_bulk[1]   += vbus_out; cout_bulk[2]   += gnd
    cout_bypass[1] += vbus_out; cout_bypass[2] += gnd

    return vbus_out


# ── Subsystem D: 1.47″ SPI Display ───────────────────────────────────────────


def _build_spi_screen(
    gnd: Net,
    vcc_3v3: Net,
    spi_sck: Net,
    spi_mosi: Net,
    screen_cs: Net,
    screen_dc: Net,
    screen_rst: Net,
    screen_bl: Net,
) -> None:
    """
    Instantiate the 8-pin connector for the 1.47″ ST7789V2 SPI display module.

    Pin assignment (SIL-8, left to right on the module header):
      1: VCC   2: GND   3: SCL   4: SDA   5: RES   6: DC   7: CS   8: BLK

    SCL / SDA here are the SPI clock and MOSI lines (the ST7789 is
    write-only; no MISO is needed).  BLK accepts PWM from GPIO12 / PWM0
    for brightness control.
    """
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    conn = Part(
        "Connector_Generic", "Conn_01x08",
        footprint=FP_SCREEN_CONN,
    )
    bypass = Capacitor(value="100n")

    # ── Connector wiring ─────────────────────────────────────────────────────
    conn[1] += vcc_3v3    # VCC
    conn[2] += gnd        # GND
    conn[3] += spi_sck    # SCL (SPI clock)
    conn[4] += spi_mosi   # SDA (SPI MOSI – write-only display)
    conn[5] += screen_rst # RES (reset, active low)
    conn[6] += screen_dc  # DC  (data/command select)
    conn[7] += screen_cs  # CS  (chip select, active low)
    conn[8] += screen_bl  # BLK (backlight PWM)

    # ── Power bypass ─────────────────────────────────────────────────────────
    bypass[1] += vcc_3v3
    bypass[2] += gnd


# ── Subsystem E: Analog Joystick ──────────────────────────────────────────────


def _build_joystick(
    gnd: Net,
    vcc_3v3: Net,
    joy_vrx: Net,
    joy_vry: Net,
    joy_sw: Net,
    i2c1_sda: Net,
    i2c1_scl: Net,
) -> None:
    """
    Instantiate the 5-pin connector for the analog thumbstick module.

    Pin assignment (SIL-5):
      1: GND   2: VCC   3: VRX   4: VRY   5: SW

    VRX / VRY are mid-rail (~1.65 V at rest) analog voltages routed to
    ADC-capable pins on the Radxa header (pins 35 and 40 on Radxa boards
    that expose the SoC ADC on the 40-pin header; otherwise an external
    ADS1015 I2C ADC should be added to the I2C1 bus).

    SW is active-low; a 10 kΩ pull-up to 3V3_SYS is added on-board so the
    Radxa GPIO reads logic-1 at rest and logic-0 when the stick is pressed.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    conn      = Part("Connector_Generic", "Conn_01x05", footprint=FP_JOY_CONN)
    sw_pullup = Resistor(value="10k")
    vcc_bypass = Capacitor(value="100n")

    # ── TI ADS1015 I2C ADC ────────────────────────────────────────────────────
    adc = Part(
        "Analog_ADC", "ADS1015IDGS",
        footprint="Package_SO:VSSOP-10_3x3mm_P0.5mm",
        value="ADS1015",
    )
    adc_bypass = Capacitor(value="100n")

    # ── Connector wiring ─────────────────────────────────────────────────────
    conn[1] += gnd
    conn[2] += vcc_3v3
    conn[3] += joy_vrx
    conn[4] += joy_vry
    conn[5] += joy_sw

    # ── ADC wiring ───────────────────────────────────────────────────────────
    adc["VDD"] += vcc_3v3
    adc["GND"] += gnd
    adc["SDA"] += i2c1_sda
    adc["SCL"] += i2c1_scl
    adc["ADDR"] += gnd         # I2C Address = 0x48
    adc["AIN0"] += joy_vrx
    adc["AIN1"] += joy_vry
    adc["AIN2"] += gnd         # Unused
    adc["AIN3"] += gnd         # Unused
    adc["ALERT/RDY"] += Net("ADC_ALERT")

    adc_bypass[1] += vcc_3v3
    adc_bypass[2] += gnd

    # ── SW pull-up ───────────────────────────────────────────────────────────
    sw_pullup[1] += vcc_3v3
    sw_pullup[2] += joy_sw

    # ── VCC bypass ───────────────────────────────────────────────────────────
    vcc_bypass[1] += vcc_3v3
    vcc_bypass[2] += gnd


# ── Subsystem F: 40-Pin Radxa Expansion Header ────────────────────────────────


def _build_radxa_header(
    gnd:        Net,
    vcc_5v:     Net,
    vcc_3v3:    Net,
    # I2S / PCM (audio subsystem shared bus)
    i2s_bclk:   Net,
    i2s_lrclk:  Net,
    i2s_din:    Net,
    i2s_dout:   Net,
    # SPI0 bus (screen)
    spi_sck:    Net,
    spi_mosi:   Net,
    spi_miso:   Net,
    screen_cs:  Net,
    # Screen control GPIOs
    screen_dc:  Net,
    screen_rst: Net,
    screen_bl:  Net,
    # Joystick
    joy_vrx:    Net,
    joy_vry:    Net,
    joy_sw:     Net,
    # Stinger port enable / flag GPIOs
    stinger_en:   list[Net],   # len == 3
    stinger_flag: list[Net],   # len == 3
    # I2C0 bus (IP5328P telemetry – pins 27/28)
    i2c0_sda:   Net,
    i2c0_scl:   Net,
    # I2C1 bus (general peripherals)
    i2c1_sda:   Net,
    i2c1_scl:   Net,
    # SPI chip selects / interrupts for protocol analyzer subsystems (H–J)
    rf_cs_n:    Net,    # CC1101 SPI chip select     (pin 26)
    rf_gdo0:    Net,    # CC1101 GDO0 packet interrupt (pin 16)
    can_cs_n:   Net,    # MCP2515 SPI chip select    (pin 36)
) -> None:
    """
    Instantiate the 2×20 Radxa expansion header and name every pin.

    Physical layout (Raspberry Pi / Radxa compatible):
    ┌────┬─────────────────────────────────┬────┐
    │  1 │ 3.3V                 5V         │  2 │
    │  3 │ I2C1_SDA (GPIO2)    5V          │  4 │
    │  5 │ I2C1_SCL (GPIO3)    GND         │  6 │
    │  7 │ ADC_VRX  (GPIO4)    UART_TX     │  8 │
    │  9 │ GND                 UART_RX     │ 10 │
    │ 11 │ STINGER_FLAG_1      I2S_BCLK   │ 12 │
    │ 13 │ STINGER_FLAG_2      GND         │ 14 │
    │ 15 │ STINGER_FLAG_3      RF_GDO0     │ 16 │
    │ 17 │ 3.3V                SCREEN_DC   │ 18 │
    │ 19 │ SPI0_MOSI           GND         │ 20 │
    │ 21 │ SPI0_MISO           SCREEN_RST  │ 22 │
    │ 23 │ SPI0_SCLK           SCREEN_CS   │ 24 │
    │ 25 │ GND                 RF_CS_N     │ 26 │
    │ 27 │ I2C0_SDA            I2C0_SCL   │ 28 │
    │ 29 │ STINGER_EN_1        GND         │ 30 │
    │ 31 │ STINGER_EN_2        SCREEN_BL   │ 32 │
    │ 33 │ STINGER_EN_3        GND         │ 34 │
    │ 35 │ ADC_VRY / I2S_LRCLK CAN_CS_N  │ 36 │
    │ 37 │ JOY_SW   (GPIO26)   I2S_DIN    │ 38 │
    │ 39 │ GND                 I2S_DOUT   │ 40 │
    └────┴─────────────────────────────────┴────┘

    Notes:
    · Pins 35 / 40 double as I2S_LRCLK / I2S_DOUT when I2S audio is active.
      When using the joystick ADC on those pins, the audio subsystem must be
      disabled in firmware.  Route the joystick analog lines to an external
      ADS1015 on I2C1 if both subsystems must run concurrently.
    · Pins 11 / 13 / 15 carry the open-drain SY6280 FLAG signals.  The
      internal 10 kΩ OC_N pull-ups in _build_usb_hub provide the required
      logic-high when no fault is present.
    """
    # Spare GPIO nets (UART break out for user; I2C0 now passed from assembly)
    uart_tx   = Net("UART_TX")
    uart_rx   = Net("UART_RX")

    conn = Part(
        "Connector_Generic", "Conn_02x20_Odd_Even",
        footprint=FP_RADXA_HDR,
    )

    # ── Odd column (pins 1, 3, 5 … 39) ───────────────────────────────────────
    conn[1]  += vcc_3v3
    conn[3]  += i2c1_sda
    conn[5]  += i2c1_scl
    conn[7]  += Net("GPIO4")      # Free GPIO
    conn[9]  += gnd
    conn[11] += stinger_flag[0]   # STINGER_FLAG_1 (SY6280 port 1 FLAG)
    conn[13] += stinger_flag[1]   # STINGER_FLAG_2
    conn[15] += stinger_flag[2]   # STINGER_FLAG_3
    conn[17] += vcc_3v3
    conn[19] += spi_mosi          # SPI0_MOSI → screen SDA
    conn[21] += spi_miso          # SPI0_MISO (unused by screen; available)
    conn[23] += spi_sck           # SPI0_SCLK → screen SCL
    conn[25] += gnd
    conn[27] += i2c0_sda
    conn[29] += stinger_en[0]     # STINGER_EN_1 → SY6280 port 1 EN
    conn[31] += stinger_en[1]     # STINGER_EN_2
    conn[33] += stinger_en[2]     # STINGER_EN_3
    conn[35] += i2s_lrclk         # I2S3_LRCK_M0 exclusively
    conn[37] += joy_sw            # JOY_SW (GPIO26)
    conn[39] += gnd

    # ── Even column (pins 2, 4, 6 … 40) ──────────────────────────────────────
    conn[2]  += vcc_5v
    conn[4]  += vcc_5v
    conn[6]  += gnd
    conn[8]  += uart_tx
    conn[10] += uart_rx
    conn[12] += i2s_bclk          # PCM_CLK / I2S BCLK
    conn[14] += gnd
    conn[16] += rf_gdo0           # RF_GDO0 – CC1101 packet interrupt (Subsystem H)
    conn[18] += screen_dc         # SCREEN_DC (GPIO24)
    conn[20] += gnd
    conn[22] += screen_rst        # SCREEN_RST (GPIO25)
    conn[24] += screen_cs         # SPI0_CE0 → screen CS
    conn[26] += rf_cs_n           # RF_CS_N – CC1101 SPI chip select (Subsystem H)
    conn[28] += i2c0_scl
    conn[30] += gnd
    conn[32] += screen_bl         # SCREEN_BL (GPIO12 / PWM0)
    conn[34] += gnd
    conn[36] += can_cs_n          # CAN_CS_N – MCP2515 SPI chip select (Subsystem I)
    conn[38] += i2s_din           # PCM_DIN / I2S data in (microphone)
    conn[40] += i2s_dout          # PCM_DOUT / I2S data out (amplifier)


# ── Subsystem G: NE555 heartbeat / dummy-load (SM-PWR-02) ────────────────────


def _build_heartbeat_keepalive(gnd: Net, vcc_5v: Net) -> None:
    """
    SM-PWR-02 – Hardware keepalive to defeat the IP5306 32-second auto-shutdown.

    The IP5306 enters standby when the average load is <45mA for 32 seconds.
    This astable 555 circuit periodically asserts a 61mA dummy load for ~10ms
    every ~15 seconds, keeping the converter active without draining the battery.

    Timing (astable mode):
      R1  = 220kΩ, R2 = 150Ω, C_tmr = 100µF
      t_HIGH = 0.693 × (R1 + R2) × C  ≈ 15.24 s  (555 OUT high, PNP OFF = no load)
      t_LOW  = 0.693 × R2 × C         ≈  10.4 ms  (555 OUT low,  PNP ON  = 61mA)

    Dummy-load path (PNP BJT, BC857 SOT-23):
      5V_SYS → Emitter
             → Base: 10kΩ base resistor driven by 555 OUT (active-low, PNP)
             → Collector: 82Ω → GND   (5V / 82Ω ≈ 61mA > 50mA requirement)
    """
    Resistor       = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor      = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_elec = Part("Device", "C", dest=TEMPLATE, footprint=FP_C_ELEC_6MM)

    # ── NE555 timer IC ────────────────────────────────────────────────────────
    timer = Part(
        "Timer", "NE555",
        footprint=FP_TIMER_NE555,
        value="NE555",
    )

    # ── PNP BJT dummy-load switch (BC857 SOT-23) ──────────────────────────────
    pnp = Part(
        "Device", "Q_PNP_EBC",
        footprint=FP_BJT_SOT23,
        value="BC857",
    )

    # ── Timing resistors ──────────────────────────────────────────────────────
    r1_tmr = Resistor(value="220k")   # R1: sets discharge interval (~15.24 s)
    r2_tmr = Resistor(value="150")    # R2: sets pulse width (~10.4 ms)

    # ── Dummy-load resistors ──────────────────────────────────────────────────
    r_base  = Resistor(value="10k")   # base drive; limits I_B from 555 OUT
    r_dummy = Resistor(value="82")    # collector load: 5V / 82Ω ≈ 61mA

    # ── Timing capacitor ─────────────────────────────────────────────────────
    c_tmr = Capacitor_elec(value="100u")   # 100µF electrolytic timing cap
    c_byp = Capacitor(value="10n")         # control-voltage bypass (pin 5)

    # ── Internal nets ─────────────────────────────────────────────────────────
    tmr_out  = Net("HB_TMR_OUT")    # 555 output (pin 3)
    tmr_ctrl = Net("HB_TMR_CTRL")  # 555 control voltage (pin 5 bypass to GND)
    tmr_thr  = Net("HB_TMR_THR")   # threshold / trigger / discharge junction

    # ── 555 power ─────────────────────────────────────────────────────────────
    timer["VCC"]   += vcc_5v
    timer["GND"]   += gnd
    timer["RESET"] += vcc_5v   # active-low RESET tied high → free-running

    # ── Astable RC network ────────────────────────────────────────────────────
    # 5V_SYS → R1 → junction(THR/TRG/DIS) → R2 → C_tmr → GND
    r1_tmr[1] += vcc_5v
    r1_tmr[2] += tmr_thr
    r2_tmr[1] += tmr_thr
    r2_tmr[2] += tmr_thr   # DIS open-drain also pulls this node

    timer["THRES"] += tmr_thr
    timer["TRIG"]  += tmr_thr
    timer["DIS"]   += tmr_thr
    c_tmr[1] += tmr_thr
    c_tmr[2] += gnd

    # ── Control-voltage bypass ────────────────────────────────────────────────
    timer["CTRL"] += tmr_ctrl
    c_byp[1]      += tmr_ctrl
    c_byp[2]      += gnd

    # ── 555 output → PNP base ─────────────────────────────────────────────────
    timer["OUT"] += tmr_out
    r_base[1]    += tmr_out
    r_base[2]    += pnp["B"]

    # ── PNP BJT dummy-load path ───────────────────────────────────────────────
    pnp["E"]   += vcc_5v       # emitter sourced from 5V_SYS
    pnp["C"]   += r_dummy[1]   # collector drives dummy resistor
    r_dummy[2] += gnd          # 5V / 82Ω ≈ 61mA > 50mA IP5306 keepalive threshold


# ── Subsystem A2: LM1117-3.3 Clean 3.3V Rail (RF/CAN isolation) ──────────────


def _build_clean_3v3_rail(gnd: Net, vcc_5v: Net) -> Net:
    """
    LDO regulator: 5V_SYS → 3V3_CLEAN.

    Isolates CC1101 and MCP2515 from the Radxa SBC's noisy switching-regulator
    output (3V3_SYS).  LM1117-3.3 in SOT-223 package; Iout up to 800mA.
    """
    Capacitor      = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0805)

    ldo = Part(
        "Regulator_Linear", "LM1117-3.3",
        footprint=FP_LDO_SOT223,
        value="LM1117-3.3",
    )

    cin_bulk    = Capacitor_bulk(value="10u")
    cin_bypass  = Capacitor(value="100n")
    cout_bulk   = Capacitor_bulk(value="10u")
    cout_bypass = Capacitor(value="100n")

    vcc_clean = Net("3V3_CLEAN")

    ldo["IN"]  += vcc_5v
    ldo["OUT"] += vcc_clean
    ldo["GND"] += gnd

    cin_bulk[1]    += vcc_5v;    cin_bulk[2]    += gnd
    cin_bypass[1]  += vcc_5v;    cin_bypass[2]  += gnd
    cout_bulk[1]   += vcc_clean; cout_bulk[2]   += gnd
    cout_bypass[1] += vcc_clean; cout_bypass[2] += gnd

    return vcc_clean


# ── Subsystem H: CC1101 Sub-GHz RF Transceiver ───────────────────────────────


def _build_rf_transceiver(
    gnd: Net,
    vcc_clean: Net,
    spi_sck: Net,
    spi_mosi: Net,
    spi_miso: Net,
    rf_cs_n: Net,
    rf_gdo0: Net,
) -> None:
    """
    Subsystem H – CC1101 Sub-GHz RF Transceiver (IoT Protocol Analysis)

    Enables monitoring and authorized active interaction with 433/868/915 MHz
    ISM-band devices (ZigBee, Z-Wave, proprietary RF protocols) over SPI.

    SPI bus  : shared SPI0 (SCK/MOSI/MISO); CS on RF_CS_N (Radxa pin 26)
    GDO0     : configurable interrupt / packet-received indicator → Radxa pin 16
    Crystal  : 26 MHz reference oscillator (required by CC1101 internal PLL)
    RBIAS    : 10 kΩ to GND (sets RF bias current per CC1101 datasheet §10.4)
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    # ── CC1101 RF transceiver IC ──────────────────────────────────────────────
    ic = Part(
        "RF_Transceiver", "CC1101",
        footprint=FP_CC1101,
        value="CC1101",
    )

    # ── 26 MHz crystal (CC1101 PLL reference; reuse 3225-4Pin SMD footprint) ──
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_12M,    # Crystal_SMD_3225-4Pin – same package class
        value="26MHz",
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    cxtal_a, cxtal_b = Capacitor(num_copies=2, value="22p")   # crystal load caps
    rbias_res         = Resistor(value="10k")                  # RBIAS → GND
    # VDD decoupling: 100 nF on each VDD supply group
    cvdd_a, cvdd_b, cvdd_c = Capacitor(num_copies=3, value="100n")

    # ── Internal nets ─────────────────────────────────────────────────────────
    xi_net    = Net("RF_XI")
    xo_net    = Net("RF_XO")
    rbias_net = Net("RF_RBIAS")

    # ── IC connections ────────────────────────────────────────────────────────
    ic["VDD"]   += vcc_clean
    ic["GND"]   += gnd
    ic["SCLK"]  += spi_sck
    ic["SI"]    += spi_mosi
    ic["SO"]    += spi_miso
    ic["CSN"]   += rf_cs_n
    ic["GDO0"]  += rf_gdo0
    ic["GDO1"]  += Net("RF_GDO1")    # optional; configurable output / MISO alt
    ic["GDO2"]  += Net("RF_GDO2")    # optional; leave as named net
    ic["RF_P"]  += Net("RF_ANT_P")   # → RF matching network → antenna
    ic["RF_N"]  += Net("RF_ANT_N")   # differential RF port (negative)
    ic["XI"]    += xi_net
    ic["XO"]    += xo_net
    ic["RBIAS"] += rbias_net

    # ── RF Balun & Matching Network (915 MHz) ─────────────────────────────────
    Inductor = Part("Device", "L", dest=TEMPLATE, footprint="Inductor_SMD:L_0402_1005Metric")
    sma_conn = Part("Connector", "Conn_Coaxial", footprint="Connector_Coaxial:SMA_Molex_73251-1153_EdgeMount_Horizontal")

    l121 = Inductor(value="12n")   # Series Match P
    l131 = Inductor(value="12n")   # Series Match N
    l122 = Inductor(value="18n")   # Shunt to GND
    l123 = Inductor(value="12n")   # Series Filter
    c121 = Capacitor(value="1.0p") # Differential Shunt
    c122 = Capacitor(value="1.5p") # Balun Merge
    c124 = Capacitor(value="100p") # DC Block

    rf_p_match = Net("RF_P_MATCH")
    rf_n_match = Net("RF_N_MATCH")
    rf_balun   = Net("RF_BALUN")
    rf_out     = Net("RF_OUT")

    # Series elements
    l121[1] += ic["RF_P"].net; l121[2] += rf_p_match
    l131[1] += ic["RF_N"].net; l131[2] += rf_n_match

    # Differential shunt
    c121[1] += rf_p_match; c121[2] += rf_n_match

    # Merge / Shunt
    c122[1] += rf_n_match; c122[2] += rf_balun
    l122[1] += rf_n_match; l122[2] += gnd

    # Filter & Block
    l123[1] += rf_p_match; l123[2] += rf_balun
    c124[1] += rf_balun;   c124[2] += rf_out

    # Output to SMA
    sma_conn["In"] += rf_out
    sma_conn["Ext"] += gnd

    # ── Crystal reference oscillator ──────────────────────────────────────────
    xtal[1]    += xi_net
    xtal[2]    += xo_net
    cxtal_a[1] += xi_net;   cxtal_a[2] += gnd
    cxtal_b[1] += xo_net;   cxtal_b[2] += gnd

    # ── RBIAS: 10 kΩ sets internal RF bias current ────────────────────────────
    rbias_res[1] += rbias_net
    rbias_res[2] += gnd

    # ── VDD decoupling ────────────────────────────────────────────────────────
    cvdd_a[1] += vcc_clean;  cvdd_a[2] += gnd
    cvdd_b[1] += vcc_clean;  cvdd_b[2] += gnd
    cvdd_c[1] += vcc_clean;  cvdd_c[2] += gnd


# ── Subsystem I: MCP2515 + MCP2551 CAN Bus Interface ─────────────────────────


def _build_can_bus(
    gnd: Net,
    vcc_5v: Net,
    vcc_clean: Net,
    spi_sck: Net,
    spi_mosi: Net,
    spi_miso: Net,
    can_cs_n: Net,
    can_int_n: Net,
) -> None:
    """
    Subsystem I – MCP2515 + MCP2551 CAN Bus Interface (OBD-II Diagnostics)

    Enables authorized monitoring and injection on ISO 11898-1 CAN buses for
    automotive telemetry logging (OBD-II port) and industrial field-bus analysis.

    MCP2515  : SPI CAN 2.0B controller (3.3V, SOIC-18W), 8 MHz crystal.
    MCP2551  : High-speed CAN transceiver (4.5–5.5V supply required, SOIC-8).
    CAN_CS_N : SPI chip select (Radxa pin 36); unique from SCREEN_CS (pin 24).
    CAN_INT_N: active-low interrupt from MCP2515 → auxiliary GPIO header.
    CAN_H/CAN_L: routed to a 2-pin external screw terminal / OBD-II connector.

    The 120 Ω split termination resistor is DNP by default; populate only when
    this node is the physical end-point of the CAN cable.
    """
    Resistor  = Part("Device", "R", dest=TEMPLATE, footprint=FP_R0402)
    Capacitor = Part("Device", "C", dest=TEMPLATE, footprint=FP_C0402)

    # ── MCP2515 SPI CAN controller (3.3V) ─────────────────────────────────────
    ctrl = Part(
        "Interface_CAN_LIN", "MCP2515",
        footprint=FP_MCP2515,
        value="MCP2515",
    )

    # ── MCP2551 CAN transceiver (5V supply required) ──────────────────────────
    xcvr = Part(
        "Interface_CAN_LIN", "MCP2551",
        footprint=FP_MCP2551,
        value="MCP2551",
    )

    # ── 8 MHz crystal for MCP2515 CAN bit-clock reference ─────────────────────
    xtal = Part(
        "Device", "Crystal",
        footprint=FP_XTAL_12M,
        value="8MHz",
    )

    # ── External CAN bus connector (2-pin; OBD-II or screw terminal) ──────────
    can_conn = Part(
        "Connector_Generic", "Conn_01x02",
        footprint=FP_CONN_1X02_254,
    )

    # ── Passives ──────────────────────────────────────────────────────────────
    cxtal_a, cxtal_b = Capacitor(num_copies=2, value="22p")   # crystal load caps
    rst_pullup = Resistor(value="10k")     # MCP2515 ~{RESET} pull-up to 3V3
    cterm      = Resistor(value="120")     # CAN bus termination (DNP if not end node)
    cvdd_ctrl  = Capacitor(value="100n")   # MCP2515 VDD bypass
    cvdd_xcvr  = Capacitor(value="100n")   # MCP2551 VDD bypass

    # ── Internal nets ─────────────────────────────────────────────────────────
    txcan    = Net("CAN_TX")      # MCP2515 TXCAN → MCP2551 TXD
    rxcan    = Net("CAN_RX")      # MCP2551 RXD → MCP2515 RXCAN
    can_h    = Net("CAN_H")       # CAN bus high (external connector)
    can_l    = Net("CAN_L")       # CAN bus low  (external connector)
    can_rst  = Net("CAN_RESET_N") # MCP2515 active-low reset
    osc1_net = Net("CAN_OSC1")
    osc2_net = Net("CAN_OSC2")

    # ── MCP2515 connections ───────────────────────────────────────────────────
    ctrl["VDD"]      += vcc_clean
    ctrl["VSS"]      += gnd
    ctrl["SCK"]      += spi_sck
    ctrl["SI"]       += spi_mosi
    ctrl["SO"]       += spi_miso
    ctrl["~{CS}"]    += can_cs_n
    ctrl["~{INT}"]   += can_int_n
    ctrl["TXCAN"]    += txcan
    ctrl["RXCAN"]    += rxcan
    ctrl["~{RESET}"] += can_rst
    ctrl["OSC1"]     += osc1_net
    ctrl["OSC2"]     += osc2_net
    # TX strobe inputs unused: tie high (no pending transmit request)
    ctrl["TX0RTS"]   += vcc_clean
    ctrl["TX1RTS"]   += vcc_clean
    ctrl["TX2RTS"]   += vcc_clean
    # RX buffer-full flag outputs: tie to GND (not connected to host interrupts)
    ctrl["RX0BF"]    += gnd
    ctrl["RX1BF"]    += gnd
    ctrl["CLKOUT"]   += Net("CAN_CLKOUT")   # optional clock out; leave as net

    # ── 8 MHz crystal + load capacitors ───────────────────────────────────────
    xtal[1]    += osc1_net
    xtal[2]    += osc2_net
    cxtal_a[1] += osc1_net;  cxtal_a[2] += gnd
    cxtal_b[1] += osc2_net;  cxtal_b[2] += gnd

    # ── MCP2515 RESET pull-up ─────────────────────────────────────────────────
    rst_pullup[1] += vcc_clean
    rst_pullup[2] += can_rst

    # ── MCP2551 connections (requires 4.5–5.5V) ───────────────────────────────
    xcvr["VDD"]  += vcc_5v
    xcvr["VSS"]  += gnd
    xcvr["TXD"]  += txcan
    xcvr["RXD"]  += rxcan
    xcvr["CANH"] += can_h
    xcvr["CANL"] += can_l
    xcvr["RS"]   += gnd            # RS=GND: maximum slew rate (high-speed mode)
    xcvr["VREF"] += Net("CAN_VREF")  # 0.5×VDD reference output; leave as net

    # ── External CAN bus connector ─────────────────────────────────────────────
    can_conn[1] += can_h
    can_conn[2] += can_l

    # ── Bus termination (DNP; fit only at physical cable end-points) ──────────
    cterm[1] += can_h
    cterm[2] += can_l

    # ── VDD decoupling ────────────────────────────────────────────────────────
    cvdd_ctrl[1] += vcc_clean;  cvdd_ctrl[2] += gnd
    cvdd_xcvr[1] += vcc_5v;    cvdd_xcvr[2] += gnd


# ── Subsystem J: ISO1212 Industrial 24V Logic Isolation ──────────────────────


def _build_industrial_iso(
    gnd: Net,
    vcc_3v3: Net,
    iso_do1: Net,
    iso_do2: Net,
) -> None:
    """
    Subsystem J – ISO1212 Dual-Channel Industrial 24V Logic Isolator (PLC Integration)

    Provides galvanically isolated digital inputs compatible with IEC 61131-2
    Type 1/3 field signals (8–35V DC PLC outputs).  The ISO1212 converts
    high-voltage field logic to 3.3V CMOS for safe Radxa SBC GPIO input.

    Field side : external 8–35V PLC supply (ISO_VCC1) and isolated ground (ISO_GND1)
    Logic side : VCC2 = 3V3_SYS; OUT1 → ISO_DO1, OUT2 → ISO_DO2
    Outputs    : ISO_DO1 / ISO_DO2 routed to the 4-pin auxiliary GPIO header
    Isolation  : ≥2.5 kV (see ISO1212 datasheet for full isolation voltage rating)

    IND-SAF-01: Per-channel transient hardening chain (IEC 61131-2 compliant):
      Connector IN → [Littelfuse 60R PTC] → A → [Vishay VCAN26A2 TVS → ISO_GND1]
                                              → [562Ω 1% series] → B
                                                                  → [1kΩ 1% → ISO_GND1]
                                                                  → [10nF 100V X7R → ISO_GND1]
                                                                  → ISO1212 INx

    ISO_GND1 remains strictly isolated from PCB GND throughout the entire path.
    """
    Resistor       = Part("Device", "R",        dest=TEMPLATE, footprint=FP_R0402)
    PtcFuse        = Part("Device", "Polyfuse", dest=TEMPLATE, footprint=FP_PTC_1206)
    TvsDiode       = Part("Device", "D_TVS",    dest=TEMPLATE, footprint=FP_TVS_SMB)
    Capacitor      = Part("Device", "C",        dest=TEMPLATE, footprint=FP_C0402)
    Capacitor_bulk = Part("Device", "C",        dest=TEMPLATE, footprint=FP_C0805)

    # ── ISO1212 dual-channel isolated digital input IC ────────────────────────
    ic = Part(
        "Daemon_V0", "ISO1212",
        footprint=FP_ISO1212,
        value="ISO1212",
    )

    # ── Field-side 4-pin connector: GND1 / VCC1 / IN1_RAW / IN2_RAW ──────────
    field_conn = Part(
        "Connector_Generic", "Conn_01x04",
        footprint=FP_CONN_1X04_254,
    )

    # ── Per-channel protection passives ───────────────────────────────────────
    # Littelfuse 60R series resettable PTC: protects against sustained fault
    # currents from 24V PLC outputs (trips at ~60mA, resets on power removal)
    ptc1, ptc2 = PtcFuse(num_copies=2, value="60R")

    # Vishay VCAN26A2: bidirectional 26V TVS clamps transient overvoltages
    # (EN 61000-4-5 Level 3 surge) at the PTC output node to field ground
    tvs1, tvs2 = TvsDiode(num_copies=2, value="VCAN26A2")

    # 562Ω 1% series current-limiting resistors (E96 value)
    r_ser1, r_ser2 = Resistor(num_copies=2, value="562")

    # 1kΩ 1% threshold resistors: shunt to ISO_GND1 to set IEC 61131-2
    # switching threshold; also bleeds static charge on open inputs
    r_thr1, r_thr2 = Resistor(num_copies=2, value="1k")

    # 10nF 100V X7R filter capacitors: suppress HF transients at IC input pin
    cflt1, cflt2 = Capacitor(num_copies=2, value="10n")

    # ── Field-side supply decoupling (referenced to ISO_GND1, not PCB GND) ────
    cvcc1_bulk = Capacitor_bulk(value="10u")
    cvcc1_byp  = Capacitor(value="100n")
    # Logic-side decoupling
    cvcc2_byp  = Capacitor(value="100n")

    # ── Internal nets ─────────────────────────────────────────────────────────
    vcc1     = Net("ISO_VCC1")    # field supply input  (8–35V PLC supply)
    gnd1     = Net("ISO_GND1")    # field ground (isolated from PCB GND)
    in1_raw  = Net("ISO_IN1_RAW") # raw connector input ch1 (before PTC)
    in2_raw  = Net("ISO_IN2_RAW") # raw connector input ch2 (before PTC)
    in1_ptc  = Net("ISO_IN1_PTCA")  # ch1 node after PTC, before TVS / series R
    in2_ptc  = Net("ISO_IN2_PTCA")  # ch2 node after PTC
    in1      = Net("ISO_IN1")     # ch1 protected node → IC IN1
    in2      = Net("ISO_IN2")     # ch2 protected node → IC IN2

    # ── ISO1212 IC connections ────────────────────────────────────────────────
    ic["VCC1"] += vcc1
    ic["GND1"] += gnd1
    ic["IN1"]  += in1
    ic["IN2"]  += in2
    ic["VCC2"] += vcc_3v3
    ic["GND2"] += gnd
    ic["OUT1"] += iso_do1
    ic["OUT2"] += iso_do2

    # ── Field connector: pin 1=GND1, 2=VCC1, 3=IN1_RAW, 4=IN2_RAW ───────────
    field_conn[1] += gnd1
    field_conn[2] += vcc1
    field_conn[3] += in1_raw
    field_conn[4] += in2_raw

    # ── Channel 1 protection chain ────────────────────────────────────────────
    ptc1[1]   += in1_raw;  ptc1[2]   += in1_ptc    # series PTC fuse
    tvs1["A"] += gnd1;     tvs1["K"] += in1_ptc    # TVS clamp to field GND
    r_ser1[1] += in1_ptc;  r_ser1[2] += in1         # 562Ω current limit
    r_thr1[1] += in1;      r_thr1[2] += gnd1        # 1kΩ threshold shunt
    cflt1[1]  += in1;      cflt1[2]  += gnd1        # 10nF HF filter

    # ── Channel 2 protection chain (mirrors channel 1) ────────────────────────
    ptc2[1]   += in2_raw;  ptc2[2]   += in2_ptc
    tvs2["A"] += gnd1;     tvs2["K"] += in2_ptc
    r_ser2[1] += in2_ptc;  r_ser2[2] += in2
    r_thr2[1] += in2;      r_thr2[2] += gnd1
    cflt2[1]  += in2;      cflt2[2]  += gnd1

    # ── Field-side decoupling (referenced to ISO_GND1) ────────────────────────
    cvcc1_bulk[1] += vcc1;  cvcc1_bulk[2] += gnd1
    cvcc1_byp[1]  += vcc1;  cvcc1_byp[2]  += gnd1

    # ── Logic-side decoupling ─────────────────────────────────────────────────
    cvcc2_byp[1] += vcc_3v3;  cvcc2_byp[2] += gnd


# ── Top-level assembly ────────────────────────────────────────────────────────


def generate_daemon_v0_full_system() -> None:
    """
    Wire all Daemon V0 subsystems into a single SKiDL netlist.

    Execution order:
      1. Define all shared power and signal nets
      2. Build each subsystem (A → F), passing the relevant nets
      3. Run ERC and emit the KiCad netlist file
    """

    # ── Shared power rails ────────────────────────────────────────────────────
    gnd     = Net("GND")
    vcc_5v  = Net("5V_SYS")   # IP5306 VOUT_ISO; also feeds Radxa header 5V pins
    vcc_3v3 = Net("3V3_SYS")  # sourced from Radxa SBC 3.3V LDO (via header pin 1/17)

    # ── Shared I2S bus (bridged from audio_subsystem.py conventions) ──────────
    i2s_bclk  = Net("I2S_BCLK")
    i2s_lrclk = Net("I2S_LRCLK")
    i2s_din   = Net("I2S_DATA_IN")
    i2s_dout  = Net("I2S_DATA_OUT")

    # ── SPI0 bus ──────────────────────────────────────────────────────────────
    spi_sck  = Net("SPI0_SCK")
    spi_mosi = Net("SPI0_MOSI")
    spi_miso = Net("SPI0_MISO")

    # ── Screen control GPIOs ──────────────────────────────────────────────────
    screen_cs  = Net("SCREEN_CS")    # GPIO8  / SPI0_CE0
    screen_dc  = Net("SCREEN_DC")    # GPIO24
    screen_rst = Net("SCREEN_RST")   # GPIO25
    screen_bl  = Net("SCREEN_BL")    # GPIO12 / PWM0

    # ── Joystick signals ──────────────────────────────────────────────────────
    joy_vrx = Net("JOY_VRX")    # analog X → Radxa ADC / external ADS1015
    joy_vry = Net("JOY_VRY")    # analog Y → Radxa ADC / external ADS1015
    joy_sw  = Net("JOY_SW")     # digital button → GPIO26

    # ── Stinger port control (one GPIO per port) ──────────────────────────────
    stinger_en   = [Net(f"STINGER_EN_{i}")   for i in range(1, 4)]
    stinger_flag = [Net(f"STINGER_FLAG_{i}") for i in range(1, 4)]

    # ── I2C0 bus (Radxa pins 27/28 – IP5328P telemetry) ──────────────────────
    i2c0_sda = Net("I2C0_SDA")
    i2c0_scl = Net("I2C0_SCL")

    # ── I2C1 bus ──────────────────────────────────────────────────────────────
    i2c1_sda = Net("I2C1_SDA")
    i2c1_scl = Net("I2C1_SCL")

    # ── Protocol analyzer chip selects and interrupt signals ──────────────────
    rf_cs_n   = Net("RF_CS_N")    # CC1101 SPI chip select  (Radxa pin 26)
    rf_gdo0   = Net("RF_GDO0")    # CC1101 GDO0 interrupt   (Radxa pin 16)
    can_cs_n  = Net("CAN_CS_N")   # MCP2515 SPI chip select (Radxa pin 36)
    can_int_n = Net("CAN_INT_N")  # MCP2515 interrupt → auxiliary header
    iso_do1   = Net("ISO_DO1")    # ISO1212 channel 1 output → auxiliary header
    iso_do2   = Net("ISO_DO2")    # ISO1212 channel 2 output → auxiliary header

    # ──────────────────────────────────────────────────────────────────────────
    # A – IP5328P power management + I2C telemetry
    # ──────────────────────────────────────────────────────────────────────────
    _build_power_system(gnd, vcc_5v, i2c0_sda, i2c0_scl)

    # ── A2 – LM1117-3.3 clean 3.3V rail for RF/CAN subsystems ─────────────────
    vcc_clean = _build_clean_3v3_rail(gnd, vcc_5v)

    # ──────────────────────────────────────────────────────────────────────────
    # G – NE555 heartbeat / dummy-load (SM-PWR-02)
    # Defeats the IP5306 32-second auto-shutdown by pulsing >50mA every ~15s.
    # ──────────────────────────────────────────────────────────────────────────
    _build_heartbeat_keepalive(gnd, vcc_5v)

    # ──────────────────────────────────────────────────────────────────────────
    # B – SL2.1A USB hub
    # ──────────────────────────────────────────────────────────────────────────
    hub_nets = _build_usb_hub(gnd, vcc_5v, vcc_3v3)
    dn_pairs = hub_nets["dn"]       # [(DP1,DM1) … (DP4,DM4)]
    oc_n     = hub_nets["oc_n"]     # [OC_N1, OC_N2, OC_N3]

    # ──────────────────────────────────────────────────────────────────────────
    # C – Three Stinger ports (SY6280 + USB-A)
    #     Port 4 on the SL2.1A (dn_pairs[3]) is reserved for the RTL8152B
    #     Ethernet module; it is left as a named net for the next subsystem file.
    # ──────────────────────────────────────────────────────────────────────────
    for i in range(3):
        _build_stinger_port(
            port_num  = i + 1,
            gnd       = gnd,
            vcc_5v    = vcc_5v,
            vcc_3v3   = vcc_3v3,
            dp_net    = dn_pairs[i][0],
            dm_net    = dn_pairs[i][1],
            en_net    = stinger_en[i],
            flag_net  = stinger_flag[i],
        )
        # Wire the SY6280 FLAG back to the hub OC_N line so the SL2.1A can
        # report per-port overcurrent faults to the host over USB.
        stinger_flag[i] += oc_n[i]

    # ──────────────────────────────────────────────────────────────────────────
    # D – 1.47″ SPI display
    # ──────────────────────────────────────────────────────────────────────────
    _build_spi_screen(
        gnd       = gnd,
        vcc_3v3   = vcc_3v3,
        spi_sck   = spi_sck,
        spi_mosi  = spi_mosi,
        screen_cs = screen_cs,
        screen_dc = screen_dc,
        screen_rst= screen_rst,
        screen_bl = screen_bl,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # E – Analog joystick
    # ──────────────────────────────────────────────────────────────────────────
    _build_joystick(
        gnd     = gnd,
        vcc_3v3 = vcc_3v3,
        joy_vrx = joy_vrx,
        joy_vry = joy_vry,
        joy_sw  = joy_sw,
        i2c1_sda= i2c1_sda,
        i2c1_scl= i2c1_scl,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # H – CC1101 Sub-GHz RF transceiver (IoT protocol analysis)
    # ──────────────────────────────────────────────────────────────────────────
    _build_rf_transceiver(
        gnd       = gnd,
        vcc_clean = vcc_clean,
        spi_sck   = spi_sck,
        spi_mosi  = spi_mosi,
        spi_miso  = spi_miso,
        rf_cs_n   = rf_cs_n,
        rf_gdo0   = rf_gdo0,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # I – MCP2515 + MCP2551 CAN bus interface (OBD-II / industrial diagnostics)
    # ──────────────────────────────────────────────────────────────────────────
    _build_can_bus(
        gnd       = gnd,
        vcc_5v    = vcc_5v,
        vcc_clean = vcc_clean,
        spi_sck   = spi_sck,
        spi_mosi  = spi_mosi,
        spi_miso  = spi_miso,
        can_cs_n  = can_cs_n,
        can_int_n = can_int_n,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # J – ISO1212 industrial 24V logic isolation (PLC integration)
    # ──────────────────────────────────────────────────────────────────────────
    _build_industrial_iso(
        gnd     = gnd,
        vcc_3v3 = vcc_3v3,
        iso_do1 = iso_do1,
        iso_do2 = iso_do2,
    )

    # Auxiliary 4-pin GPIO header: exposes CAN_INT_N / ISO_DO1 / ISO_DO2 / GND.
    # These three signals cannot fit on the 40-pin Radxa header (all pins taken).
    aux_hdr = Part(
        "Connector_Generic", "Conn_01x04",
        footprint=FP_CONN_1X04_254,
    )
    aux_hdr[1] += can_int_n   # MCP2515 INT (open-drain, active-low)
    aux_hdr[2] += iso_do1     # ISO1212 OUT1 (3.3V CMOS logic)
    aux_hdr[3] += iso_do2     # ISO1212 OUT2 (3.3V CMOS logic)
    aux_hdr[4] += gnd

    # ──────────────────────────────────────────────────────────────────────────
    # F – 40-pin Radxa expansion header
    # ──────────────────────────────────────────────────────────────────────────
    _build_radxa_header(
        gnd          = gnd,
        vcc_5v       = vcc_5v,
        vcc_3v3      = vcc_3v3,
        i2s_bclk     = i2s_bclk,
        i2s_lrclk    = i2s_lrclk,
        i2s_din      = i2s_din,
        i2s_dout     = i2s_dout,
        spi_sck      = spi_sck,
        spi_mosi     = spi_mosi,
        spi_miso     = spi_miso,
        screen_cs    = screen_cs,
        screen_dc    = screen_dc,
        screen_rst   = screen_rst,
        screen_bl    = screen_bl,
        joy_vrx      = joy_vrx,
        joy_vry      = joy_vry,
        joy_sw       = joy_sw,
        stinger_en   = stinger_en,
        stinger_flag = stinger_flag,
        i2c0_sda     = i2c0_sda,
        i2c0_scl     = i2c0_scl,
        i2c1_sda     = i2c1_sda,
        i2c1_scl     = i2c1_scl,
        rf_cs_n      = rf_cs_n,
        rf_gdo0      = rf_gdo0,
        can_cs_n     = can_cs_n,
    )

    # ──────────────────────────────────────────────────────────────────────────
    # ERC + netlist generation
    # ──────────────────────────────────────────────────────────────────────────
    ERC()
    generate_netlist(file_=NETLIST_OUTPUT)
    print(f"Full-system netlist written → {NETLIST_OUTPUT}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_daemon_v0_full_system()
