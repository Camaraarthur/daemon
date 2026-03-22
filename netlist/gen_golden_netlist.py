"""
netlist/gen_golden_netlist.py
Phase 4 -- Golden Netlist Generator (CI artifact; no KiCad runtime required)

Generates a KiCad-format .net file (S-expression, compatible with KiCad 5/6/7)
without requiring KiCad symbol libraries or a live SKiDL environment.

This script is the CI fallback for machines where the full SKiDL + KiCad
toolchain is not installed.  The component list and net connectivity are
derived directly from the architecture defined in full_system.py; the output
is a deterministic, diff-able artifact suitable for:

  - Regression detection (git diff daemon_v0_full_system.net)
  - Import into KiCad PCB editor once symbol libraries are available
  - BOM extraction by downstream tooling

Usage:
    python -m netlist.gen_golden_netlist
    # -> writes daemon_v0_full_system.net to the repo root
"""

from __future__ import annotations

import datetime
import sys
import textwrap
from pathlib import Path

OUTPUT_FILE = Path(__file__).parent.parent / "daemon_v0_full_system.net"

# -- Footprints (mirrored from full_system.py / audio_subsystem.py) ----------

FP_IP5328P     = "Package_DFN_QFN:QFN-40-1EP_6x6mm_P0.5mm_EP4.6x4.6mm"
FP_INDUCTOR_5A = "Inductor_SMD:L_Bourns_SRR1260"
FP_LDO_SOT23_5 = "Package_TO_SOT_SMD:SOT-23-5"
FP_SL2_1A      = "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm"
FP_XTAL_3225   = "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm"
FP_USB_A_FEMALE = "Connector_USB:USB_A_Molex_67643_Horizontal"
FP_USB_A_MALE  = "Connector_USB:USB_A_CNCTech_1001-011-01101_Horizontal"
FP_USB_C_PLUG  = "Daemon_V0:USB_C_Plug_GCT_USB4155"
FP_SY6280      = "Package_TO_SOT_SMD:SOT-23-5"
FP_USBLC6      = "Package_TO_SOT_SMD:SOT-23-6"
FP_RADXA_HDR   = "Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical"
FP_SCREEN_CONN = "Daemon_V0:MillMax_1x08_P2.54mm_Vertical"  # Holes only — press Mill-Max 0305 receptacles in from bottom
FP_NAV_SW      = "Daemon_V0:SW_Alps_SKRHABE010"
FP_BAT_CONN    = "Connector_JST:JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal"
FP_TP_D15      = "TestPoint:TestPoint_Pad_D1.5mm"
FP_TP_D10      = "TestPoint:TestPoint_Pad_D1.0mm"
FP_R0402       = "Resistor_SMD:R_0402_1005Metric"
FP_R0805       = "Resistor_SMD:R_0805_2012Metric"
FP_C0402       = "Capacitor_SMD:C_0402_1005Metric"
FP_C0805       = "Capacitor_SMD:C_0805_2012Metric"
FP_TVS_SC70    = "Package_TO_SOT_SMD:SOT-323_SC-70"
FP_TVS_SMB     = "Diode_SMD:D_SMB"
FP_PTC_1206    = "Fuse:Fuse_1206_3216Metric"
FP_SW_PUSH     = "Button_Switch_SMD:SW_Push_1P1T-MP_NO_Horizontal_Alps_SKRTLAE010"
FP_JUMPER_1225 = "Resistor_SMD:R_1210_3225Metric"
FP_TIMER_NE555 = "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
FP_BJT_SOT23   = "Package_TO_SOT_SMD:SOT-23"
FP_C_TMR_TANT  = "Capacitor_Tantalum_SMD:CP_EIA-7343-31_Kemet-D"
FP_CC1101      = "Package_DFN_QFN:QFN-20-1EP_4x4mm_P0.5mm_EP2.6x2.6mm"
FP_ISO1212     = "Package_SO:SSOP-16_3.9x4.9mm_P0.635mm"  # TI ISO1212 DBQ = SSOP-16 (NOT SOIC-16W)
FP_CONN_1X03   = "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical"
FP_CONN_2X05   = "Connector_PinSocket_2.54mm:PinSocket_2x05_P2.54mm_Vertical"
FP_CONN_1X05_F = "Connector_PinSocket_2.54mm:PinSocket_1x05_P2.54mm_Vertical"
FP_USB_C_RCPT  = "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12"
FP_RTL8152B    = "Package_DFN_QFN:QFN-24-1EP_4x4mm_P0.5mm_EP2.6x2.6mm"
FP_MAGJACK     = "Daemon_V0:RJ45_Hanrun_HR911105A_Horizontal"
FP_WS2812B     = "LED_SMD:LED_WS2812B-2020_PLCC4_2.0x2.0mm"
FP_IR_LED      = "LED_SMD:LED_0603_1608Metric_Pad1.05x0.95mm_HandSolder"
FP_NFET_SOT23  = "Package_TO_SOT_SMD:SOT-23"
FP_PMOS_SOT23  = "Package_TO_SOT_SMD:SOT-23"
FP_TERMINAL_3P = "TerminalBlock_Phoenix:TerminalBlock_Phoenix_PT-1,5-3-3.5-H_1x03_P3.50mm_Horizontal"  # Real footprint + 3D model
FP_CHIP_ANT    = "Daemon_V0:Antenna_Chip_Johanson_0915AT43A0026"
FP_TANT_CASEB  = "Capacitor_Tantalum_SMD:CP_EIA-3528-21_Kemet-B"
FP_NTC_0402    = "Resistor_SMD:R_0402_1005Metric"
FP_L_0402      = "Inductor_SMD:L_0402_1005Metric"
# Audio subsystem footprints
FP_QFN16       = "Package_DFN_QFN:QFN-16-1EP_3x3mm_P0.5mm_EP1.75x1.75mm"
FP_INMP441     = "Daemon_V0:InvenSense_INMP441_BottomPort"
FP_TRRS        = "Daemon_V0:Jack_3.5mm_SJ2-2531X-SMT"
FP_JST_SH2     = "Connector_JST:JST_SH_SM02B-SRSS-TB_1x02-1MP_P1.00mm_Horizontal"
FP_FERRITE_0603 = "Inductor_SMD:L_0603_1608Metric"
FP_LED_0402    = "LED_SMD:LED_0402_1005Metric"
FP_SCHOTTKY_SMA    = "Diode_SMD:D_SMA"  # SS34: 3A 40V Schottky, SMA package
FP_R_2512          = "Resistor_SMD:R_2512_6332Metric"  # 1W rated
FP_PCF8574     = "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm"
FP_VSSOP10     = "Package_SO:VSSOP-10_3x3mm_P0.5mm"
# New V0 additions
FP_NAU88C22    = "Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm"
FP_ADS1115     = "Package_SO:MSOP-10_3x3mm_P0.5mm"
FP_SP3485      = "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
FP_TSOP38238   = "OptoDevice:Vishay_MINICAST-3Pin"
FP_CONN_1X04_F = "Connector_PinSocket_2.54mm:PinSocket_1x04_P2.54mm_Vertical"  # Female
FP_CONN_1X03_F = "Connector_PinSocket_2.54mm:PinSocket_1x03_P2.54mm_Vertical"  # Female
# Security & protection
FP_ATECC608B   = "Package_DFN_QFN:DFN-8-1EP_2x3mm_P0.5mm_EP0.61x2.2mm"
FP_TS3USB221   = "Package_SO:VSSOP-10_3x3mm_P0.5mm"  # USB 2.0 DPDT data switch
FP_SOT236      = "Package_TO_SOT_SMD:SOT-23-6"
FP_PTC_0805    = "Fuse:Fuse_0805_2012Metric"
FP_ESD_SOD523  = "Diode_SMD:D_SOD-523"
FP_RELAY_G6K   = "Relay_SMD:Relay_DPDT_Omron_G6K-2F-Y"
FP_SOD123      = "Diode_SMD:D_SOD-123"
FP_HEX_INV     = "Package_SO:TSSOP-14_4.4x5mm_P0.65mm"  # 74LVC04A hex inverter


# -- Net definitions ---------------------------------------------------------

NETS: list[str] = [
    # Power rails
    "GND",
    "5V_SYS",
    "3V3_SYS",
    "3V3_CLEAN",
    # Power management (A) - IP5328P (full QFN-40 mapping)
    "VIN", "BAT", "BAT_ISO", "PMIC_KEY", "IP5328P_NTC",
    "LX", "IP5328P_VSYS", "IP5328P_BST",
    "IP5328P_VBUS", "IP5328P_VBUSG", "IP5328P_VING",
    "IP5328P_RSET", "IP5328P_VREG", "IP5328P_VSET", "IP5328P_LIGHT",
    "IP5328P_VOUT1G", "IP5328P_VOUT2G",
    # I2C buses
    "I2C1_SDA", "I2C1_SCL",
    "I2C1_PMIC_SDA", "I2C1_PMIC_SCL",
    # SPI3 bus (display)
    "SPI3_CLK", "SPI3_MOSI",
    # RF SoftSPI bus (CC1101)
    "RF_CLK", "RF_MOSI", "RF_MISO",
    "RF_CS_N", "RF_GDO0", "RF_GDO2",  # GDO1 = SO pin (shared with RF_MISO)
    "RF_XI", "RF_XO", "RF_RBIAS", "RF_DCOUPL",
    "RF_ANT_P", "RF_ANT_N", "RF_ANT",
    # CC1101 filterbalun internal nodes (TI DN017 / SWRA168A 3-stage diff→SE→T-filter)
    "RF_BAL_P", "RF_BAL_N", "RF_SE_50", "RF_FILT_MID", "RF_ANT_PRE", "RF_NOTCH",
    # Screen control
    "SPI3_CS", "SCREEN_DC", "SCREEN_RST", "SCREEN_BL",
    # Nav switch (Alps SKRHABE010)
    "NAV_UP", "NAV_DOWN", "NAV_LEFT", "NAV_RIGHT", "NAV_CENTER",
    # Stinger ports (5x; port 5 = female USB-C receptacle on Hub2 port 3)
    "STINGER_EN_1", "STINGER_EN_2", "STINGER_EN_3", "STINGER_EN_4", "STINGER_EN_5",
    # Note: SY6280AAC SOT-23-5 has no FLAG pin; SL2.1A has no OC_N pins.
    "STINGER_ISET_1", "STINGER_ISET_2", "STINGER_ISET_3", "STINGER_ISET_4", "STINGER_ISET_5",
    "USB_VBUS_1", "USB_VBUS_2", "USB_VBUS_3", "USB_VBUS_4", "USB_VBUS_5",
    "STINGER5_CC1", "STINGER5_CC2",
    # Hub 1 USB data pairs (upstream + 4 downstream)
    "USB_UP_DP", "USB_UP_DM",
    "HUB1_DN_DP_1", "HUB1_DN_DM_1",
    "HUB1_DN_DP_2", "HUB1_DN_DM_2",
    "HUB1_DN_DP_3", "HUB1_DN_DM_3",
    "HUB1_DN_DP_4", "HUB1_DN_DM_4",  # port 4 = cascade to Hub 2
    # Hub 1 internal nets (SL2.1A SOP-16: VDD5=5V input, VDD33/VDD18=internal LDO outputs)
    "HUB1_XI", "HUB1_XO",
    "HUB1_VDD33", "HUB1_VDD18",
    # Hub 2 USB data pairs (4 downstream; upstream = HUB1_DN_DP/DM_4)
    "HUB2_DN_DP_1", "HUB2_DN_DM_1",
    "HUB2_DN_DP_2", "HUB2_DN_DM_2",
    "HUB2_DN_DP_3", "HUB2_DN_DM_3",
    "HUB2_DN_DP_4", "HUB2_DN_DM_4",
    # Hub 2 internal nets (SL2.1A SOP-16: VDD5=5V input, VDD33/VDD18=internal LDO outputs)
    "HUB2_XI", "HUB2_XO",
    "HUB2_VDD33", "HUB2_VDD18",
    # Ethernet (B2)
    "ETH_MDI_TXP", "ETH_MDI_TXN", "ETH_MDI_RXP", "ETH_MDI_RXN",
    "ETH_XI", "ETH_XO",
    "RTL_U2VDD10", "RTL_AVDD10", "RTL_DVDD10", "RTL_DVDD10_UPS",
    "RTL_RSET", "RTL_LANWAKEB",
    # I2S / audio
    "I2S_BCLK", "I2S_LRCLK", "I2S_DATA_IN", "I2S_DATA_OUT",
    # Audio subsystem (K)
    "5V_AUDIO",
    "AMP_OUT_P", "AMP_OUT_N",
    "AMP_OUT_P_FILT", "AMP_OUT_N_FILT",
    "AMP_SD", "TRRS_DETECT_RAW", "SPK_P", "SPK_N", "MIC_VDD", "MIC_LED_A",
    # WS2812B + IR blaster
    "MCU_LED_DIN",  # 3.3V Radxa GPIO → 74AHCT1G125 level shifter input
    "LED_DIN",      # 5V output of level shifter → first WS2812B DIN
    "WS2812B_DOUT_1", "WS2812B_DOUT_2", "WS2812B_DOUT_3",
    "IR_GPIO", "IR_LED_P", "IR_LED_N",
    # Power indicator LED
    "PWR_LED_A",
    # AUX GPIO expansion
    "AUX_GPIO_1", "AUX_GPIO_2", "AUX_GPIO_3",  # AUX_GPIO_4 removed (sacrificed for STINGER_EN_3)
    # PCF8574 interrupt line (open-drain, pulled to 3V3_SYS; connect to GPIO for IRQ-driven nav)
    "PCF8574_INT",
    # Power UX (A6)
    "PMIC_KILL",
    # ISO1212 (J)
    "ISO_VCC1", "ISO_GND1",
    "ISO_IN1_RAW", "ISO_IN2_RAW",
    "ISO_IN1_PTCA", "ISO_IN2_PTCA",
    "ISO_IN1", "ISO_IN2",
    "ISO_SENSE1", "ISO_SENSE2",  # SENSE pins: R_SENSE connects SENSE→FGND for threshold setting
    "ISO_SUB1", "ISO_SUB2",      # SUB pins: floating copper islands (isolation barrier)
    "ISO_DO1", "ISO_DO2",
    # Heartbeat timer (G)
    "HB_TMR_OUT", "HB_TMR_THR", "HB_TMR_CTRL", "HB_TMR_NODE_A",
    # Goobay bridge CC nets
    "GOOBAY_CC1", "GOOBAY_CC2",
    # USB-C plug CC net (stinger port 1 / Radxa power key)
    # Rp pull-up (DFP host mode) — Daemon is the power source; Radxa boots only when bridge inserted
    "STINGER1_CC",
    # Radxa GPIO 5V rail (pins 2,4) — intentionally NOT connected to 5V_SYS.
    # Radxa outputs its own 5V here once running; we isolate it from Daemon's rail.
    "RADXA_GPIO_5V",
    # NAU88C22 audio codec (L)
    "CODEC_LHPOUT", "CODEC_RHPOUT", "CODEC_LSPKOUT", "CODEC_RSPKOUT",
    "CODEC_LMICP", "CODEC_LMICN", "CODEC_RMICP", "CODEC_RMICN",
    "CODEC_LAUX", "CODEC_RAUX",
    "CODEC_AVDD", "CODEC_DVDD", "CODEC_VREF",
    "CODEC_MICBIAS",
    "TRRS_RING2",  # TRRS Ring2 = headset mic / line-in → codec input
    # ADS1115 ADC (M)
    "ADC_AIN0", "ADC_AIN1", "ADC_AIN2", "ADC_AIN3", "ADC_ADDR", "ADC_ALRT",
    # SP3485 RS-485 (N)
    "RS485_A", "RS485_B", "RS485_DE",
    # IR Receiver
    "IR_RX", "IR_VS_FILT",
    # Codec ADC output (separate from I2S_DATA_IN to prevent bus fight)
    "CODEC_ADCOUT",
    # PMIC charge indicator
    "PMIC_LIGHT_LED",
    # Protection nets
    "GOOBAY_VBUS_FUSED",  # PTC-fused Goobay VBUS before IP5328P
    "USB_VBUS_1_FUSED", "USB_VBUS_4_FUSED", "USB_VBUS_5_FUSED",  # PTC-fused charging VBUSes
    "BAT_PROTECTED",  # After reverse-polarity Schottky, before PTC
    # ADC protected inputs
    "ADC_AIN0_P", "ADC_AIN1_P", "ADC_AIN2_P", "ADC_AIN3_P",
    # GPIO protected
    "AUX_GPIO_1_P", "AUX_GPIO_2_P", "AUX_GPIO_3_P", "IR_GPIO_P",
    # Audio protected
    "SPK_P_FUSED", "SPK_N_FUSED", "TRRS_RING2_P",
    # Ethernet protected
    "ETH_MDI_TXP_P", "ETH_MDI_TXN_P", "ETH_MDI_RXP_P", "ETH_MDI_RXN_P",
    # USB data switch nets (connector side, after TS3USB221)
    "HUB1_DN_DP_1_SW", "HUB1_DN_DM_1_SW",
    "HUB1_DN_DP_2_SW", "HUB1_DN_DM_2_SW",
    "HUB1_DN_DP_3_SW", "HUB1_DN_DM_3_SW",
    "HUB2_DN_DP_1_SW", "HUB2_DN_DM_1_SW",
    "HUB2_DN_DP_3_SW", "HUB2_DN_DM_3_SW",
    # Security
    "ATECC_SDA", "ATECC_SCL",
    # USB data switch inverted enable signals
    "STINGER_OE_1", "STINGER_OE_2", "STINGER_OE_3", "STINGER_OE_4", "STINGER_OE_5",
    # J4 fused power outputs
    "3V3_J4_OUT", "5V_J4_OUT",
    # WAGO switchable bypass
    "WAGO_COM1", "WAGO_COM2",  # Relay common pins (from WAGO pins 3/4)
    "WAGO_MODE",               # GPIO: LOW=industrial, HIGH=RS-485
    "RLY_COIL_N",              # Relay coil negative (BSS138 drain)
]

# -- Component definitions ---------------------------------------------------
# Each entry: (ref, value, footprint, libsource_lib, libsource_part, pins)
# pins: list of (pin_name, net_name)
#
# Reference designators are assigned sequentially; the actual SKiDL-generated
# refs may differ but the netlist connectivity is equivalent.

# Refs that are hardcoded (not auto-incremented) in _build_components().
# _next_ref() must skip these to avoid duplicate ref designators.
_HARDCODED_REFS = {
    "U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9", "U10",
    "U11", "U13", "U14", "U15", "U21", "U22",
    "L1", "Q1",
    "J1", "J2", "J3", "J4", "J5", "J6",  # J5 reserved (PWR_MGMT removed)
    "BAT1",
    "TP1", "TP2", "TP3", "TP4",
}

_ref_counter = {}
def _next_ref(prefix: str) -> str:
    """Auto-increment reference designator, skipping hardcoded refs."""
    _ref_counter[prefix] = _ref_counter.get(prefix, 0) + 1
    while f"{prefix}{_ref_counter[prefix]}" in _HARDCODED_REFS:
        _ref_counter[prefix] += 1
    return f"{prefix}{_ref_counter[prefix]}"


def _build_components() -> list[dict]:
    """Build the complete component list matching full_system.py architecture."""
    global _ref_counter
    _ref_counter = {}
    comps: list[dict] = []

    def add(ref, value, fp, lib, part, pins):
        comps.append(dict(ref=ref, value=value, fp=fp, lib=lib, part=part, pins=pins))

    # ======================================================================
    # A: IP5328P Power Management (full QFN-40+EPAD mapping per datasheet)
    # Pin mapping from IP5328P V1.0 datasheet (Injoinic):
    #   Pins 1-7:   USB data/CC (DPA2, CC1, CC2, DMC, DPC, DMB, DPB)
    #   Pins 8,9,22,23: VSYS (system rail)
    #   Pin 10:     NTC
    #   Pins 11-13: L1/L2/L3 (LED or I2C1 SCK/SDA/WAKE)
    #   Pins 14-18: LX (switch node, 5 pins)
    #   Pin 19:     BST (bootstrap)
    #   Pin 20:     LIGHT (charge indicator)
    #   Pin 21:     RSET (battery resistance comp)
    #   Pins 24,25: VSP/VSN (current sense)
    #   Pin 26:     KEY (button)
    #   Pin 27:     VREG (internal 3.1V LDO)
    #   Pin 28:     BAT (battery)
    #   Pin 29:     AGND (analog ground)
    #   Pin 30:     VIN (micro-USB input detect)
    #   Pin 31:     VING (VIN PMOS gate)
    #   Pin 32:     VBUS (USB-C input detect)
    #   Pin 33:     VBUSG (VBUS PMOS gate)
    #   Pins 34-37: VOUT2/VOUT2G/VOUT1G/VOUT1 (USB-A output switches)
    #   Pins 38-40: DMA1/DPA1/DMA2 (USB-A port data)
    #   Pin 41:     EPAD (thermal ground)
    # ======================================================================
    add("U1", "IP5328P", FP_IP5328P, "Daemon_V0", "IP5328P",
        [# USB-C charging input (Goobay bridge VBUS → IP5328P for charging)
         ("CC1","GOOBAY_CC1"),("CC2","GOOBAY_CC2"),
         ("VBUS","IP5328P_VBUS"),("VBUSG","IP5328P_VBUSG"),
         # USB-C data pins — NC (hub handles USB data, not PMIC)
         ("DMC","GND"),("DPC","GND"),
         # Micro-USB input — unused (no micro-USB on Daemon)
         ("VIN","VIN"),("VING","IP5328P_VING"),
         ("DMB","GND"),("DPB","GND"),
         # VSYS — boosted system rail (4 pins)
         ("VSYS_1","IP5328P_VSYS"),("VSYS_2","IP5328P_VSYS"),
         ("VSYS_3","IP5328P_VSYS"),("VSYS_4","IP5328P_VSYS"),
         # Current sense: VSP on VSYS side, VSN on 5V_SYS side of shunt
         ("VSP","IP5328P_VSYS"),("VSN","5V_SYS"),
         # Battery
         ("BAT","BAT_ISO"),("NTC","IP5328P_NTC"),
         # Boost converter — LX (switch node, 5 pins) + bootstrap
         ("LX_1","LX"),("LX_2","LX"),("LX_3","LX"),
         ("LX_4","LX"),("LX_5","LX"),
         ("BST","IP5328P_BST"),
         # Control
         ("KEY","PMIC_KEY"),
         ("RSET","IP5328P_RSET"),
         ("LIGHT","IP5328P_LIGHT"),
         # I2C1 mode: L1=SCK, L2=SDA, L3=VSET/MCU_WAKE
         ("L1","I2C1_PMIC_SCL"),("L2","I2C1_PMIC_SDA"),
         ("L3","IP5328P_VSET"),
         # Internal 3.1V LDO output
         ("VREG","IP5328P_VREG"),
         # USB-A output switches — unused (Daemon uses SY6280 switches)
         # VOUT1/VOUT2 tied to VSYS (no load detect needed)
         ("VOUT1","IP5328P_VSYS"),("VOUT2","IP5328P_VSYS"),
         # VOUT1G/VOUT2G are active gate driver outputs — do NOT hard-short to GND.
         # Float with external 100k pull-down (weak hold-off, driver can still swing).
         ("VOUT1G","IP5328P_VOUT1G"),("VOUT2G","IP5328P_VOUT2G"),
         # USB-A port data — unused, tie to GND to prevent floating
         ("DPA1","GND"),("DMA1","GND"),("DPA2","GND"),("DMA2","GND"),
         # Ground
         ("AGND","GND"),("EPAD","GND")])

    # Boost inductor: BAT_ISO ←→ LX (single-inductor buck-boost topology)
    add("L1", "2u2", FP_INDUCTOR_5A, "Device", "L",
        [("1","LX"),("2","BAT_ISO")])

    # Bootstrap capacitor: BST to LX (100nF, high-side gate driver)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C",
        [("1","IP5328P_BST"),("2","LX")])

    # Battery connector (JST-PH 2-pin)
    add("BAT1", "Li-ion", FP_BAT_CONN, "Connector_Generic", "Conn_01x02",
        [("1","BAT"),("2","GND")])

    # DFT test points
    add("TP1", "TP_VIN",  FP_TP_D15, "Connector", "TestPoint", [("1","VIN")])
    add("TP2", "TP_BAT",  FP_TP_D15, "Connector", "TestPoint", [("1","BAT")])
    add("TP3", "TP_LX",   FP_TP_D10, "Connector", "TestPoint", [("1","LX")])
    add("TP4", "TP_VSYS", FP_TP_D15, "Connector", "TestPoint", [("1","IP5328P_VSYS")])

    # Battery PTC resettable fuse (was 0Ω jumper — no short-circuit protection).
    # 1210 PTC, 2A hold / 4A trip. Protects against cell short-circuit through
    # the boost inductor or failed IP5328P. Bare Li-ion cells may lack internal protection.
    # Battery path: BAT1 → BAT → SS34 (reverse protection) → BAT_PROTECTED → PTC → BAT_ISO
    add("J1", "PTC_2A", FP_JUMPER_1225, "Device", "Polyfuse",
        [("1","BAT_PROTECTED"),("2","BAT_ISO")])
    # Current sense / isolation jumper (VSYS→5V_SYS) — 10mΩ shunt
    # Also serves as VSP/VSN measurement path for IP5328P battery gauge
    add("J2", "10m", FP_JUMPER_1225, "Device", "R",
        [("1","IP5328P_VSYS"),("2","5V_SYS")])

    # VIN decoupling and overvoltage protection
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","VIN"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","VIN"),("2","GND")])
    # VIN pull-down (100k) — keep VIN low when no external power on this path
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R", [("1","VIN"),("2","GND")])
    # SMBJ5.0A TVS on VIN: clamps at 6.4V (below IP5328P VIN abs max ~6V).
    # Protects against 12V/20V USB-PD chargers or dumb wall warts on any chargeable port.
    # The SS34 Schottky diodes route external VBUS to VIN; without this clamp, >5.5V kills the PMIC.
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","VIN")])

    # BAT decoupling
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","BAT"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","BAT"),("2","GND")])

    # VSYS decoupling (boost output rail, before 10mΩ sense to 5V_SYS)
    add(_next_ref("C"), "22u", FP_C0805, "Device", "C", [("1","IP5328P_VSYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","IP5328P_VSYS"),("2","GND")])

    # IP5328P_VBUS decoupling (USB-C charging input)
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","IP5328P_VBUS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","IP5328P_VBUS"),("2","GND")])

    # VBUSG gate cap (100nF to GND)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","IP5328P_VBUSG"),("2","GND")])
    # VING gate cap (100nF to GND — VIN path unused but prevent floating)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","IP5328P_VING"),("2","GND")])

    # VREG internal 3.3V LDO decoupling (IP5328P datasheet: 4.7µF; 100nF insufficient for LDO stability)
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","IP5328P_VREG"),("2","GND")])

    # RSET resistor (10k to GND — battery internal resistance compensation)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","IP5328P_RSET"),("2","GND")])

    # VSET: NC = 4.2V standard Li-ion charge target (IP5328P datasheet p18).
    # 100k was undocumented; valid values are NC/120k/68k/10k only.
    # L3/VSET left floating (no resistor) → 4.2V cutoff.

    # LIGHT pull-down (100k to GND — charge indicator output, prevent float)
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","IP5328P_LIGHT"),("2","GND")])

    # VOUT1G/VOUT2G: active gate driver outputs — 100k pull-down (weak hold-off,
    # doesn't fight driver; no external FET connected so gate drives nothing)
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","IP5328P_VOUT1G"),("2","GND")])
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","IP5328P_VOUT2G"),("2","GND")])

    # 100uF tantalum power tank on 5V_SYS (Case-D for low ESR at 4A transients)
    # Specify 10V-rated tantalum (2x derating at 5V for reliability)
    add(_next_ref("C"), "100u", FP_C_TMR_TANT, "Device", "C_Polarized",
        [("1","5V_SYS"),("2","GND")])
    # SMBJ5.0A TVS on 5V_SYS: last-resort clamp against SY6280 body diode backfeed.
    # If a >5V source appears on any USB VBUS, the SY6280 body diode conducts to 5V_SYS.
    # This TVS clamps 5V_SYS at 6.4V, protecting downstream ICs (AP2112K max 6V, SL2.1A max 6V).
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","5V_SYS")])

    # NTC bypass resistor on IP5328P NTC pin
    # IP5328P sources 20µA into NTC pin; 10kΩ→0.2V triggers false overtemperature (HT threshold 0.43V).
    # 51kΩ: 20µA × 51kΩ = 1.02V → normal operating range; no real NTC fitted (no battery with NTC wire).
    add(_next_ref("R"), "51k", FP_NTC_0402, "Device", "R",
        [("1","IP5328P_NTC"),("2","GND")])

    # I2C1 bus pull-up resistors (4.7k to 3V3_SYS)
    # Required: I2C is open-drain — without pull-ups the bus floats
    # Both PCF8574 (0x20) and IP5328P (0x75) share this bus
    add(_next_ref("R"), "4.7k", FP_R0402, "Device", "R",
        [("1","3V3_SYS"),("2","I2C1_SDA")])
    add(_next_ref("R"), "4.7k", FP_R0402, "Device", "R",
        [("1","3V3_SYS"),("2","I2C1_SCL")])

    # I2C protection resistors (470 ohm series — isolate IP5328P segment)
    add(_next_ref("R"), "470", FP_R0402, "Device", "R",
        [("1","I2C1_SDA"),("2","I2C1_PMIC_SDA")])
    add(_next_ref("R"), "470", FP_R0402, "Device", "R",
        [("1","I2C1_SCL"),("2","I2C1_PMIC_SCL")])

    # ======================================================================
    # A2: AP2112K-3.3 Clean 3.3V Rail
    # ======================================================================
    # AP2112K SOT-23-5: Pin1=VIN, Pin2=GND, Pin3=EN, Pin4=NC, Pin5=VOUT
    add("U2", "AP2112K-3.3", FP_LDO_SOT23_5, "Regulator_Linear", "AP2112K-3.3",
        [("VIN","5V_SYS"),("VOUT","3V3_CLEAN"),("GND","GND"),("EN","5V_SYS"),("NC","NC")])
    # LDO input decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","5V_SYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])
    # LDO output decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])

    # ======================================================================
    # A6: Advanced Power UX
    # ======================================================================
    # BSS84 PMOS wake-blocker
    add(_next_ref("Q"), "BSS84", FP_PMOS_SOT23, "Device", "Q_PMOS_GSD",
        [("G","5V_SYS"),("S","PMIC_KEY"),("D","NAV_CENTER")])
    # 5V_SYS rail bleed resistor (10k): when PMIC shuts down, discharges 5V_SYS
    # rail so BSS84 gate goes low → PMOS conducts → nav switch can wake PMIC
    # ~2s discharge with typical rail capacitance
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","5V_SYS"),("2","GND")])
    # 2N7002 NMOS software kill
    add(_next_ref("Q"), "2N7002", FP_NFET_SOT23, "Device", "Q_NMOS_GDS",
        [("G","PMIC_KILL"),("D","PMIC_KEY"),("S","GND")])
    # PMIC_KILL pull-down (10k) — must reliably hold gate low during
    # Radxa boot (~2s GPIO float). 100k was insufficient; 10k holds
    # gate below Vth even with leakage.
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","PMIC_KILL"),("2","GND")])
    # Physical power button
    add(_next_ref("SW"), "SW_PWR", FP_SW_PUSH, "Switch", "SW_Push",
        [("1","PMIC_KEY"),("2","GND")])
    # J5 (PWR_MGMT header) removed — PMIC_KILL now routed via J3 pin 37
    # Software reboot: `sudo reboot` (warm SoC reset, no PMIC needed)
    # Software shutdown: drive J3.37 HIGH → Q3 pulls PMIC_KEY → IP5328P off

    # ======================================================================
    # B: Cascaded SL2.1A USB 2.0 Hubs
    # ======================================================================

    # --- Hub 1 (primary) ---
    # SL2.1A SOP-16: VDD5=5V input; VDD33/VDD18=internal LDO outputs (bypass only).
    # No RBIAS, RST_N, SUSP_N, OC_N, or CFG pins on this IC.
    # Upstream pins are named DP/DM (not DP_U/DM_U).
    add("U3", "SL2.1A", FP_SL2_1A, "Daemon_V0", "SL2.1A",
        [("VDD5","5V_SYS"),("GND","GND"),
         ("VDD33","HUB1_VDD33"),("VDD18","HUB1_VDD18"),
         ("DP","USB_UP_DP"),("DM","USB_UP_DM"),
         ("DP1","HUB1_DN_DP_1"),("DM1","HUB1_DN_DM_1"),
         ("DP2","HUB1_DN_DP_2"),("DM2","HUB1_DN_DM_2"),
         ("DP3","HUB1_DN_DP_3"),("DM3","HUB1_DN_DM_3"),
         ("DP4","HUB1_DN_DP_4"),("DM4","HUB1_DN_DM_4"),
         ("XIN","HUB1_XI"),("XOUT","HUB1_XO")])

    # Hub 1 crystal (12MHz)
    add(_next_ref("Y"), "12MHz", FP_XTAL_3225, "Device", "Crystal",
        [("1","HUB1_XI"),("2","HUB1_XO"),("3","GND"),("4","GND")])
    # Hub 1 crystal load caps
    add(_next_ref("C"), "22p", FP_C0402, "Device", "C", [("1","HUB1_XI"),("2","GND")])
    add(_next_ref("C"), "22p", FP_C0402, "Device", "C", [("1","HUB1_XO"),("2","GND")])
    # Hub 1 VDD5 input decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","5V_SYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])
    # Hub 1 internal LDO output bypass (VDD33 and VDD18 are outputs of SL2.1A)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","HUB1_VDD33"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","HUB1_VDD18"),("2","GND")])

    # --- Hub 2 (cascade; upstream = Hub 1 port 4) ---
    # SL2.1A SOP-16: same minimal pin set as Hub 1.
    add("U14", "SL2.1A", FP_SL2_1A, "Daemon_V0", "SL2.1A",
        [("VDD5","5V_SYS"),("GND","GND"),
         ("VDD33","HUB2_VDD33"),("VDD18","HUB2_VDD18"),
         ("DP","HUB1_DN_DP_4"),("DM","HUB1_DN_DM_4"),
         ("DP1","HUB2_DN_DP_1"),("DM1","HUB2_DN_DM_1"),
         ("DP2","HUB2_DN_DP_2"),("DM2","HUB2_DN_DM_2"),
         ("DP3","HUB2_DN_DP_3"),("DM3","HUB2_DN_DM_3"),
         ("DP4","HUB2_DN_DP_4"),("DM4","HUB2_DN_DM_4"),
         ("XIN","HUB2_XI"),("XOUT","HUB2_XO")])

    # Hub 2 crystal (12MHz)
    add(_next_ref("Y"), "12MHz", FP_XTAL_3225, "Device", "Crystal",
        [("1","HUB2_XI"),("2","HUB2_XO"),("3","GND"),("4","GND")])
    # Hub 2 crystal load caps
    add(_next_ref("C"), "22p", FP_C0402, "Device", "C", [("1","HUB2_XI"),("2","GND")])
    add(_next_ref("C"), "22p", FP_C0402, "Device", "C", [("1","HUB2_XO"),("2","GND")])
    # Hub 2 VDD5 input decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","5V_SYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])
    # Hub 2 internal LDO output bypass
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","HUB2_VDD33"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","HUB2_VDD18"),("2","GND")])
    # Hub 2 unused port termination (port 4 only; port 3 now used for stinger 5)
    add(_next_ref("R"), "15k", FP_R0402, "Device", "R", [("1","HUB2_DN_DP_4"),("2","GND")])
    add(_next_ref("R"), "15k", FP_R0402, "Device", "R", [("1","HUB2_DN_DM_4"),("2","GND")])


    # ======================================================================
    # C: Stinger Ports (4x SY6280AAC + USBLC6-2SC6 ESD)
    # ======================================================================
    stinger_configs = [
        # Port 1: USB-C plug → Radxa OTG (POWER KEY)
        # DFP host: Rp pull-up (12k → 1.5A per USB-C Table 4-25) + higher ISET (3.3k → 2.06A)
        # D+/D- → Hub1 port 1 downstream: Radxa appears as USB device to laptop via Goobay.
        # Removing this plug from the Radxa cuts all power to the SBC — physical key.
        # Stinger GPIOs (STINGER_EN_1-5 via J3) control power switches — no USB host needed.
        ("U4",  1, FP_USB_C_PLUG,   "Connector", "USB_C_Plug_USB2.0",
         "HUB1_DN_DP_1", "HUB1_DN_DM_1", True,  "Rp", "3.3k"),
        ("U5",  2, FP_USB_A_FEMALE, "Connector", "USB_A",
         "HUB1_DN_DP_2", "HUB1_DN_DM_2", False, None, "13k"),
        ("U6",  3, FP_USB_A_FEMALE, "Connector", "USB_A",
         "HUB1_DN_DP_3", "HUB1_DN_DM_3", False, None, "13k"),
        ("U15", 4, FP_USB_A_MALE,   "Connector", "USB_A",
         "HUB2_DN_DP_1", "HUB2_DN_DM_1", False, None, "13k"),
    ]

    for sy_ref, port, conn_fp, conn_lib, conn_part, dp_net, dm_net, has_cc, cc_mode, iset_r in stinger_configs:
        vbus_net = f"USB_VBUS_{port}"
        iset_net = f"STINGER_ISET_{port}"
        en_net   = f"STINGER_EN_{port}"

        # SY6280 power switch — Ilim = 6800/Rset
        # Port 1: SY6280AAAC (2A rated) with 3.3k → 2.06A for Radxa 1.5A peak
        # Ports 2-4: SY6280AAC (1A rated) with 13k → 0.52A (USB 2.0 500mA)
        sy_part = "SY6280AAAC" if iset_r == "3.3k" else "SY6280AAC"
        add(sy_ref, sy_part, FP_SY6280, "Daemon_V0", sy_part,
            [("IN","5V_SYS"),("OUT",vbus_net),("EN",en_net),
             ("GND","GND"),("ISET",iset_net)])

        # USB connector — D+/D- go through TS3USB221 data switch (section S).
        # Connector uses _SW nets (switched side), hub uses direct nets.
        conn_ref = _next_ref("J")
        dp_sw = dp_net + "_SW"
        dm_sw = dm_net + "_SW"
        conn_pins = [("VBUS",vbus_net),("D+",dp_sw),("D-",dm_sw),("GND","GND")]
        if has_cc:
            cc_net = f"STINGER{port}_CC"
            conn_pins.append(("CC", cc_net))
        add(conn_ref, conn_part, conn_fp, conn_lib, conn_part, conn_pins)

        if has_cc:
            cc_net = f"STINGER{port}_CC"
            if cc_mode == "Rp":
                # DFP host — Rp pull-up. Use 5V_SYS (not 3V3_SYS) so CC is valid
                # during boot before Radxa provides 3.3V. At 5V: 12k gives 417µA ≈ 3A
                # advertisement (USB-C Table 4-25). SY6280 limits actual current to 2A.
                add(_next_ref("R"), "12k", FP_R0402, "Device", "R",
                    [("1","5V_SYS"),("2",cc_net)])
            else:
                # UFP device — Rd 5.1k to GND
                add(_next_ref("R"), "5.1k", FP_R0402, "Device", "R",
                    [("1",cc_net),("2","GND")])
            # ESD protection on CC line
            add(_next_ref("D"), "ESD5Z3.3", "Diode_SMD:D_SOD-523", "Device", "D_TVS",
                [("A","GND"),("K",cc_net)])

        # USBLC6-2SC6 ESD protection on connector side (after data switch)
        add(_next_ref("U"), "USBLC6-2SC6", FP_USBLC6, "Power_Protection", "USBLC6-2SC6",
            [("1",dm_sw),("2","GND"),("3",dm_sw),
             ("4",dp_sw),("5",vbus_net),("6",dp_sw)])

        # EN pull-up: Port 1 uses 5V_SYS so Radxa can boot (3V3_SYS doesn't exist
        # until Radxa is running — chicken-and-egg). Other ports use 3V3_SYS.
        en_rail = "5V_SYS" if port == 1 else "3V3_SYS"
        add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
            [("1",en_rail),("2",en_net)])

        # Input decoupling (5V_SYS side)
        add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","5V_SYS"),("2","GND")])
        add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])
        # Output decoupling (VBUS side)
        add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1",vbus_net),("2","GND")])
        add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1",vbus_net),("2","GND")])

        # ISET resistor (value per port)
        add(_next_ref("R"), iset_r, FP_R0402, "Device", "R",
            [("1",iset_net),("2","GND")])


    # ======================================================================
    # C2: Stinger Port 5 — Female USB-C Receptacle (Hub 2 port 3)
    # ======================================================================
    # SY6280AAC power switch (same current limit as other ports: 13k → 0.52A)
    add("U22", "SY6280AAC", FP_SY6280, "Daemon_V0", "SY6280AAC",
        [("IN","5V_SYS"),("OUT","USB_VBUS_5"),("EN","STINGER_EN_5"),
         ("GND","GND"),("ISET","STINGER_ISET_5")])
    # USB-C female receptacle — host port (provides 5V to connected devices)
    add(_next_ref("J"), "USB_C_Receptacle", FP_USB_C_RCPT, "Connector", "USB_C_Receptacle_USB2.0",
        [("VBUS","USB_VBUS_5"),("D+","HUB2_DN_DP_3_SW"),("D-","HUB2_DN_DM_3_SW"),
         ("GND","GND"),("CC1","STINGER5_CC1"),("CC2","STINGER5_CC2")])
    # CC1/CC2 pull-UPS (56k Rp to 3V3_SYS — DFP host advertising 5V/900mA)
    # USB PD spec: Rp=56k→3.3V = 900mA source; Rd=5.1k→GND = sink/device. This is a HOST port.
    add(_next_ref("R"), "56k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","STINGER5_CC1")])
    add(_next_ref("R"), "56k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","STINGER5_CC2")])
    # ESD protection on port 5 CC lines
    add(_next_ref("D"), "ESD5Z3.3", "Diode_SMD:D_SOD-523", "Device", "D_TVS",
        [("A","GND"),("K","STINGER5_CC1")])
    add(_next_ref("D"), "ESD5Z3.3", "Diode_SMD:D_SOD-523", "Device", "D_TVS",
        [("A","GND"),("K","STINGER5_CC2")])
    # USBLC6-2SC6 ESD protection (ST: pins 1,3=I/O1; pins 4,6=I/O2)
    add(_next_ref("U"), "USBLC6-2SC6", FP_USBLC6, "Power_Protection", "USBLC6-2SC6",
        [("1","HUB2_DN_DM_3_SW"),("2","GND"),("3","HUB2_DN_DM_3_SW"),
         ("4","HUB2_DN_DP_3_SW"),("5","USB_VBUS_5"),("6","HUB2_DN_DP_3_SW")])
    # EN pull-up (10k to 3V3; Radxa GPIO can pull low to disable)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","STINGER_EN_5")])
    # Input decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","5V_SYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])
    # Output (VBUS) decoupling
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","USB_VBUS_5"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","USB_VBUS_5"),("2","GND")])
    # ISET resistor (13k → 0.52A)
    add(_next_ref("R"), "13k", FP_R0402, "Device", "R", [("1","STINGER_ISET_5"),("2","GND")])

    # NOTE: Port 5 CC has Rp 56k only (host/DFP). Rd 5.1k was removed because
    # simultaneous Rp+Rd creates a 0.275V voltage divider, not valid DRP.
    # Proper DRP requires a FUSB302 or similar toggling IC.
    # Charging through port 5 still works: the SS34 Schottky diode routes external VBUS
    # to IP5328P VIN regardless of CC state — it's a pure electrical path.

    # ======================================================================
    # C3: Battery Charging Path — Schottky diodes from chargeable ports to IP5328P VIN
    # ======================================================================
    # When external power appears on any chargeable port's VBUS, the BAT54 Schottky
    # (Vf~0.3V) conducts to IP5328P VIN → charges battery. SY6280 independently
    # controls whether the HAT provides power on that port (host mode).
    # Chargeable ports: USB-C male (key, port 1), USB-A male (port 4), USB-C female (port 5)
    # SS34: 3A 40V Schottky (SMA) — IP5328P can draw up to 2A on VIN for charging.
    # BAT54 (200mA) was severely undersized. SS34 Vf~0.45V at 2A.
    # Charging path: connector VBUS → PTC fuse → SS34 → VIN → IP5328P
    # PTC limits sustained overvoltage current so SMBJ5.0A TVS on VIN survives.
    add(_next_ref("D"), "SS34", FP_SCHOTTKY_SMA, "Device", "D_Schottky",
        [("A","USB_VBUS_1_FUSED"),("K","VIN")])   # Through PTC → charge from computer
    add(_next_ref("D"), "SS34", FP_SCHOTTKY_SMA, "Device", "D_Schottky",
        [("A","USB_VBUS_4_FUSED"),("K","VIN")])   # Through PTC → charge from battery pack
    add(_next_ref("D"), "SS34", FP_SCHOTTKY_SMA, "Device", "D_Schottky",
        [("A","USB_VBUS_5_FUSED"),("K","VIN")])   # Through PTC → main charging port

    # ======================================================================
    # G: NE555 Heartbeat (SOIC-8)
    # ======================================================================
    add("U7", "NE555DR", FP_TIMER_NE555, "Timer", "NE555D",
        [("VCC","5V_SYS"),("GND","GND"),("Q","HB_TMR_OUT"),
         ("THR","HB_TMR_THR"),("TR","HB_TMR_THR"),
         ("DIS","HB_TMR_NODE_A"),
         ("CV","HB_TMR_CTRL"),("R","5V_SYS")])
    # NE555 VCC local bypass cap (mandatory for timing stability)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])

    # PNP BJT dummy-load switch (BC857)
    # NE555 Q=HIGH → PNP OFF (base high). Q=LOW → PNP ON (base pulled low via 10k).
    add("Q1", "BC857", FP_BJT_SOT23, "Device", "Q_PNP_EBC",
        [("E","5V_SYS"),("B","BJT_BASE"),("C","BJT_COLLECTOR")])

    # NE555 astable timing:
    #   t_high = 0.693*(R1+R2)*C  (PNP OFF, dummy load off)
    #   t_low  = 0.693*R2*C       (PNP ON, dummy load draws current)
    # R1=47k, R2=150Ω, C=100µF:
    #   t_high = 0.693*47150*0.0001 = 3.27s
    #   t_low  = 0.693*150*0.0001  = 10.4ms
    # IP5328P no-load timeout is ~32s. At 3.3s period = ~10 pulses per timeout. Safe.
    add(_next_ref("R"), "47k", FP_R0402, "Device", "R",
        [("1","5V_SYS"),("2","HB_TMR_NODE_A")])
    add(_next_ref("R"), "150", FP_R0402, "Device", "R",
        [("1","HB_TMR_NODE_A"),("2","HB_TMR_THR")])
    # Base resistor: 10k (NE555 Q → PNP base)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","HB_TMR_OUT"),("2","BJT_BASE")])
    # Dummy load: 82Ω → I=61mA per pulse (above IP5328P 50mA threshold).
    # Peak P=0.3W but only 10ms every 3.3s (0.3% duty), so average P=0.9mW.
    # Even 0805 (0.125W continuous) handles this easily — thermal pulse is ~6°C rise.
    add(_next_ref("R"), "82", FP_R0805, "Device", "R",
        [("1","BJT_COLLECTOR"),("2","GND")])

    # Timing capacitor: 100uF tantalum
    add(_next_ref("C"), "100u", FP_C_TMR_TANT, "Device", "C_Polarized",
        [("1","HB_TMR_THR"),("2","GND")])
    # Control voltage bypass: 10nF
    add(_next_ref("C"), "10n", FP_C0402, "Device", "C",
        [("1","HB_TMR_CTRL"),("2","GND")])

    # ======================================================================
    # H: CC1101 RF Transceiver
    # ======================================================================
    add("U8", "CC1101", FP_CC1101, "Daemon_V0", "CC1101",
        [# Power: DVDD (digital) + AVDD (analog, 4 pins)
         ("DVDD","3V3_CLEAN"),
         ("AVDD_1","3V3_CLEAN"),("AVDD_2","3V3_CLEAN"),
         ("AVDD_3","3V3_CLEAN"),("AVDD_4","3V3_CLEAN"),
         # Digital core decoupling (internal 1.8V, bypass to GND)
         ("DCOUPL","RF_DCOUPL"),
         # Ground
         ("GND_1","GND"),("GND_2","GND"),("DGUARD","GND"),("EPAD","GND"),
         # SPI interface
         ("SCLK","RF_CLK"),("SI","RF_MOSI"),("SO","RF_MISO"),
         ("CSN","RF_CS_N"),
         # General-purpose digital outputs (GDO1 = SO/pin 2; shares MISO, not separate)
         ("GDO0","RF_GDO0"),("GDO2","RF_GDO2"),
         # Crystal
         ("XI","RF_XI"),("XO","RF_XO"),
         # Bias resistor
         ("RBIAS","RF_RBIAS"),
         # RF differential output
         ("RF_P","RF_ANT_P"),("RF_N","RF_ANT_N")])

    # 27 MHz crystal (TI SWRS061I Table 21: 27 MHz recommended for 915 MHz / EN 300 220)
    add(_next_ref("Y"), "27MHz", FP_XTAL_3225, "Device", "Crystal",
        [("1","RF_XI"),("2","RF_XO"),("3","GND"),("4","GND")])
    # Crystal load caps — 27 pF per TI reference design (Table 21: C81, C101 = 27 pF ±5% NP0)
    add(_next_ref("C"), "27p", FP_C0402, "Device", "C", [("1","RF_XI"),("2","GND")])
    add(_next_ref("C"), "27p", FP_C0402, "Device", "C", [("1","RF_XO"),("2","GND")])
    # RBIAS 56k (CC1101 datasheet SWRS061I Table 27: 56.2k ±1%)
    add(_next_ref("R"), "56k", FP_R0402, "Device", "R", [("1","RF_RBIAS"),("2","GND")])
    # GDO pins — TI does not recommend external pull-downs; CC1101 GDOs have configurable
    # internal pull-downs. Leave unloaded; firmware configures GDO0 as sync-word interrupt.
    # RF_CS_N pull-up (10k to 3V3_CLEAN — keep CC1101 deselected during boot)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_CLEAN"),("2","RF_CS_N")])
    # DCOUPL internal 1.8V decoupling (100nF to GND per datasheet)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","RF_DCOUPL"),("2","GND")])
    # DVDD / bulk decoupling (100nF + 100nF)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    # AVDD per-pin NP0 decoupling (TI SWRS061I §8.4: 100pF NP0 on each AVDD pin)
    add(_next_ref("C"), "100p", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])  # AVDD_1
    add(_next_ref("C"), "100p", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])  # AVDD_2
    add(_next_ref("C"), "100p", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])  # AVDD_3
    add(_next_ref("C"), "100p", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])  # AVDD_4

    # TI DN017 / SWRA168A filterbalun (replaces single-ended pi-network)
    # Stage 1: Differential LPF (diff → RF_BAL_P/N)
    #   L121/L131: 12nH series on each diff line
    #   C121/C131: 1.0pF/1.5pF shunt caps (asymmetric — compensates CC1101 RF_N internal load)
    add(_next_ref("L"), "12n",  FP_L_0402, "Device", "L", [("1","RF_ANT_P"),("2","RF_BAL_P")])   # L121
    add(_next_ref("L"), "12n",  FP_L_0402, "Device", "L", [("1","RF_ANT_N"),("2","RF_BAL_N")])   # L131
    add(_next_ref("C"), "1p0",  FP_C0402, "Device", "C", [("1","RF_BAL_P"),("2","GND")])         # C121
    add(_next_ref("C"), "1p5",  FP_C0402, "Device", "C", [("1","RF_BAL_N"),("2","GND")])         # C131
    # Stage 2: Balun (diff → single-ended RF_SE_50)
    #   L122/L132: 18nH, both diff lines merge to SE node
    #   C122: 1.5pF series across L122 (resonance tuning)
    add(_next_ref("L"), "18n",  FP_L_0402, "Device", "L", [("1","RF_BAL_P"),("2","RF_SE_50")])   # L122
    add(_next_ref("L"), "18n",  FP_L_0402, "Device", "L", [("1","RF_BAL_N"),("2","RF_SE_50")])   # L132
    add(_next_ref("C"), "1p5",  FP_C0402, "Device", "C", [("1","RF_BAL_P"),("2","RF_SE_50")])    # C122
    # Stage 3: Single-ended T-filter + DC block + antenna matching
    #   L123: 12nH series (RF_SE_50 → RF_FILT_MID)
    #   C123: 3.3pF shunt (RF_FILT_MID → GND)
    #   L124: 12nH series (RF_FILT_MID → RF_ANT_PRE)
    #   C124: 100pF DC block (RF_ANT_PRE → RF_ANT)
    #   C125: 12pF antenna matching shunt (RF_ANT → GND)
    #   C126+L125: 47pF+3.3nH notch at 2nd harmonic ~1830 MHz (RF_ANT → RF_NOTCH → GND)
    add(_next_ref("L"), "12n",  FP_L_0402, "Device", "L", [("1","RF_SE_50"),("2","RF_FILT_MID")])   # L123
    add(_next_ref("C"), "3p3",  FP_C0402, "Device", "C", [("1","RF_FILT_MID"),("2","GND")])         # C123
    add(_next_ref("L"), "12n",  FP_L_0402, "Device", "L", [("1","RF_FILT_MID"),("2","RF_ANT_PRE")]) # L124
    add(_next_ref("C"), "100p", FP_C0402, "Device", "C", [("1","RF_ANT_PRE"),("2","RF_ANT")])       # C124 DC block
    add(_next_ref("C"), "12p",  FP_C0402, "Device", "C", [("1","RF_ANT"),("2","GND")])              # C125 antenna shunt
    add(_next_ref("C"), "47p",  FP_C0402, "Device", "C", [("1","RF_ANT"),("2","RF_NOTCH")])         # C126 notch
    add(_next_ref("L"), "3n3",  FP_L_0402, "Device", "L", [("1","RF_NOTCH"),("2","GND")])           # L125 notch

    add(_next_ref("ANT"), "0915AT43A0026", FP_CHIP_ANT, "Device", "Antenna_Chip",
        [("1","RF_ANT"),("2","GND")])

    # ======================================================================
    # J: ISO1212 Industrial Isolation
    # ======================================================================
    # ISO1212 DBQ SSOP-16 pin map (TI SLLA588):
    #   Pin 1:  VCC1    Pin 9:  FGND2
    #   Pin 2:  OUT1    Pin 10: SENSE2
    #   Pin 3:  OUT2    Pin 11: IN2
    #   Pin 4:  EN      Pin 12: FGND1
    #   Pin 5:  GND1    Pin 13: SENSE1
    #   Pin 6:  SUB1    Pin 14: IN1
    #   Pin 7:  NC      Pin 15: NC
    #   Pin 8:  SUB2    Pin 16: NC
    # All 16 physical pads declared for KiCad footprint mapping.
    add("U11", "ISO1212", FP_ISO1212, "Daemon_V0", "ISO1212",
        [("VCC1","3V3_SYS"),("GND1","GND"),
         ("IN1","ISO_IN1"),("IN2","ISO_IN2"),
         ("SENSE1","ISO_SENSE1"),("SENSE2","ISO_SENSE2"),
         ("FGND1","ISO_GND1"),("FGND2","ISO_GND1"),
         ("SUB1","ISO_SUB1"),("SUB2","ISO_SUB2"),
         ("EN","3V3_SYS"),           # Enable tied high (always-on)
         ("OUT1","ISO_DO1"),("OUT2","ISO_DO2"),
         ("NC_7","NC"),("NC_15","NC"),("NC_16","NC")])

    # WAGO field connector — pins 3/4 go to relay COMs (not directly to protection chain)
    # WAGO 2060-403 (3-position). ISO_VCC1 powered internally from 3V3_SYS — not exposed.
    add(_next_ref("J"), "Phoenix-PT-1.5-3", FP_TERMINAL_3P, "Connector_Generic", "Conn_01x03",
        [("1","ISO_GND1"),("2","WAGO_COM1"),("3","WAGO_COM2")])

    # G6K-2F-Y DPDT signal relay — switches WAGO pins 3/4 between:
    #   NC (default/boot): → protection chain → ISO1212 (industrial 24V mode)
    #   NO (GPIO HIGH):    → SP3485 A/B (RS-485/Modbus/DMX mode)
    # Break-before-make: 24V NEVER reaches SP3485 even during transition.
    # Relay pin map (G6K-2F-Y): 1=Coil+, 16=Coil-, 12=COM1, 11=NC1, 9=NO1,
    #                            4=COM2, 5=NC2, 8=NO2
    add("K1", "G6K-2F-Y", FP_RELAY_G6K, "Relay", "Relay_DPDT",
        [("Coil_1","3V3_SYS"),("Coil_2","RLY_COIL_N"),
         ("COM1","WAGO_COM1"),("NC1","ISO_IN1_RAW"),("NO1","RS485_A"),
         ("COM2","WAGO_COM2"),("NC2","ISO_IN2_RAW"),("NO2","RS485_B")])
    # BSS138 N-MOSFET relay driver (gate from GPIO, drain to coil negative)
    add(_next_ref("Q"), "BSS138", FP_NFET_SOT23, "Device", "Q_NPN_GSD",
        [("G","WAGO_MODE"),("S","GND"),("D","RLY_COIL_N")])
    # Flyback diode across coil (cathode to 3V3, anode to coil negative)
    add(_next_ref("D"), "1N4148W", FP_SOD123, "Device", "D",
        [("A","RLY_COIL_N"),("K","3V3_SYS")])
    # Gate pull-down: default LOW = relay de-energized = industrial mode (safe)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","WAGO_MODE"),("2","GND")])

    # Channel 1 protection chain
    add(_next_ref("F"), "60R", FP_PTC_1206, "Device", "Polyfuse",
        [("1","ISO_IN1_RAW"),("2","ISO_IN1_PTCA")])
    # Input series R: at 24V, I=24/(60+562)=38.6mA, P=0.84W → 2512 (1W rated)
    add(_next_ref("R"), "562", FP_R_2512, "Device", "R",
        [("1","ISO_IN1_PTCA"),("2","ISO_IN1")])
    add(_next_ref("C"), "10n", FP_C0402, "Device", "C",
        [("1","ISO_IN1"),("2","ISO_GND1")])
    # R_SENSE ch1 (controller-side threshold, low current → 0402 fine)
    add(_next_ref("R"), "562", FP_R0402, "Device", "R",
        [("1","ISO_SENSE1"),("2","ISO_GND1")])

    # Channel 2 protection chain
    add(_next_ref("F"), "60R", FP_PTC_1206, "Device", "Polyfuse",
        [("1","ISO_IN2_RAW"),("2","ISO_IN2_PTCA")])
    # Input series R ch2: same → 2512
    add(_next_ref("R"), "562", FP_R_2512, "Device", "R",
        [("1","ISO_IN2_PTCA"),("2","ISO_IN2")])
    add(_next_ref("C"), "10n", FP_C0402, "Device", "C",
        [("1","ISO_IN2"),("2","ISO_GND1")])
    # R_SENSE ch2
    add(_next_ref("R"), "562", FP_R0402, "Device", "R",
        [("1","ISO_SENSE2"),("2","ISO_GND1")])

    # VCAN26A2-03G dual TVS (SOT-323, 3 pins: A1=ch1, Cathode=GND, A2=ch2)
    # Protects both ISO input channels in one device
    add(_next_ref("D"), "VCAN26A2", FP_TVS_SC70, "Device", "D_TVS_x2_AAC",
        [("A1","ISO_IN1_PTCA"),("K","ISO_GND1"),("A2","ISO_IN2_PTCA")])

    # Field-side decoupling (referenced to ISO_GND1)
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","ISO_VCC1"),("2","ISO_GND1")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","ISO_VCC1"),("2","ISO_GND1")])
    # Logic-side decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # ======================================================================
    # A5: Goobay 74446 USB-C Bridge
    # ======================================================================
    # VBUS → IP5328P_VBUS for charging (NOT directly to 5V_SYS!)
    # CC1/CC2 → IP5328P internal CC detection (DRP with Try.SRC)
    # D+/D- → Hub 1 upstream: laptop/host PC connects here, sees Radxa+stingers+ETH as hub
    add(_next_ref("J"), "Goobay-74446", FP_USB_C_RCPT, "Connector", "USB_C_Receptacle",
        [("VBUS","GOOBAY_VBUS_FUSED"),("GND","GND"),  # VBUS goes through PTC before reaching PMIC
         ("D+","USB_UP_DP"),("D-","USB_UP_DM"),
         ("CC1","GOOBAY_CC1"),("CC2","GOOBAY_CC2")])
    # CC1/CC2: IP5328P has internal 5.1K Rd pull-downs + Rp for DRP.
    # No external CC resistors needed — IP5328P handles UFP/DFP detection.
    # ESD protection on CC lines (direct path to IP5328P — vulnerable to ESD)
    add(_next_ref("D"), "ESD5Z3.3", "Diode_SMD:D_SOD-523", "Device", "D_TVS",
        [("A","GND"),("K","GOOBAY_CC1")])
    add(_next_ref("D"), "ESD5Z3.3", "Diode_SMD:D_SOD-523", "Device", "D_TVS",
        [("A","GND"),("K","GOOBAY_CC2")])

    # Upstream USB ESD protection (Goobay bridge → Hub 1 upstream)
    # VBUS clamp = IP5328P_VBUS (Goobay bridge cable VBUS)
    # USBLC6-2SC6 ESD protection (ST: pins 1,3=I/O1; pins 4,6=I/O2)
    add(_next_ref("U"), "USBLC6-2SC6", FP_USBLC6, "Power_Protection", "USBLC6-2SC6",
        [("1","USB_UP_DM"),("2","GND"),("3","USB_UP_DM"),
         ("4","USB_UP_DP"),("5","IP5328P_VBUS"),("6","USB_UP_DP")])

    # ======================================================================
    # B2: RTL8152B USB-Ethernet (QFN-24+EPAD per Realtek datasheet)
    # Pin mapping: RTL8152B-VB-CG QFN-24 (4x4mm, 0.5mm pitch)
    #   Pin 1:  AVDD33    Pin 13: DVDD33
    #   Pin 2:  MDI0P     Pin 14: GPIO
    #   Pin 3:  MDIN0     Pin 15: LEDCSB
    #   Pin 4:  MDI1P     Pin 16: DVDD10
    #   Pin 5:  MDIN1     Pin 17: SPISCK
    #   Pin 6:  U2GND     Pin 18: XTALDET/SPISDI
    #   Pin 7:  U2DM      Pin 19: LANWAKEB
    #   Pin 8:  U2DP      Pin 20: SPISDO
    #   Pin 9:  U2VDD10   Pin 21: CKXTAL1
    #   Pin 10: AVDD33    Pin 22: CKXTAL2
    #   Pin 11: VDD5      Pin 23: AVDD10
    #   Pin 12: DVDD10_UPS Pin 24: RSET
    #   Pin 25: EPAD (GND)
    # ======================================================================
    add("U9", "RTL8152B", FP_RTL8152B, "Daemon_V0", "RTL8152B",
        [# Power (external supply)
         ("AVDD33_1","3V3_CLEAN"),("AVDD33_2","3V3_CLEAN"),
         ("DVDD33","3V3_CLEAN"),("VDD5","5V_SYS"),
         # Power (internal LDO outputs — bypass caps only)
         ("U2VDD10","RTL_U2VDD10"),("DVDD10_UPS","RTL_DVDD10_UPS"),
         ("DVDD10","RTL_DVDD10"),("AVDD10","RTL_AVDD10"),
         # Ground
         ("U2GND","GND"),("EPAD","GND"),
         # USB 2.0 interface
         ("U2DP","HUB2_DN_DP_2"),("U2DM","HUB2_DN_DM_2"),
         # Ethernet PHY (MDI pairs)
         ("MDI0P","ETH_MDI_TXP"),("MDIN0","ETH_MDI_TXN"),
         ("MDI1P","ETH_MDI_RXP"),("MDIN1","ETH_MDI_RXN"),
         # Crystal
         ("CKXTAL1","ETH_XI"),("CKXTAL2","ETH_XO"),
         # Strapping pins
         ("XTALDET","3V3_CLEAN"),  # High = external 25MHz crystal
         # PSELF does not exist on QFN-24 VB variant (bus-powered only)
         # Reference resistor
         ("RSET","RTL_RSET"),
         # LANWAKEB pulled high = wake-on-LAN disabled (no spurious wake events)
         ("LANWAKEB","RTL_LANWAKEB"),
         # Unused SPI EEPROM interface — tie inputs low to prevent floating
         ("SPISCK","GND"),       # Pin 17: SPI clock input — must not float
         ("SPISDO","GND"),       # Pin 20: SPI data output — safe to ground (tristate when CS inactive)
         # Unused outputs — tie to GND (they'll be driven but no load)
         ("GPIO","GND"),         # Pin 14: GPIO output
         ("LEDCSB","GND"),       # Pin 15: LED control strobe output
        ])

    # RTL8152B RSET reference resistor (12.1k to GND per datasheet)
    add(_next_ref("R"), "12.1k", FP_R0402, "Device", "R",
        [("1","RTL_RSET"),("2","GND")])

    # Internal LDO bypass caps (4.7µF + 100nF each; 100nF alone insufficient for LDO stability.
    # Orange Pi R1 ref design uses 4.7µF C0603 on each 1.0V rail.)
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","RTL_U2VDD10"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","RTL_U2VDD10"),("2","GND")])
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","RTL_DVDD10_UPS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","RTL_DVDD10_UPS"),("2","GND")])
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","RTL_DVDD10"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","RTL_DVDD10"),("2","GND")])
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","RTL_AVDD10"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","RTL_AVDD10"),("2","GND")])

    # 25 MHz crystal
    add(_next_ref("Y"), "25MHz", FP_XTAL_3225, "Device", "Crystal",
        [("1","ETH_XI"),("2","ETH_XO"),("3","GND"),("4","GND")])
    # Crystal load caps (RTL8152B Table 19: 27pF for 16-20pF load crystal; confirmed by Orange Pi R1)
    add(_next_ref("C"), "27p", FP_C0402, "Device", "C", [("1","ETH_XI"),("2","GND")])
    add(_next_ref("C"), "27p", FP_C0402, "Device", "C", [("1","ETH_XO"),("2","GND")])
    # RTL8152B LANWAKEB pull-up (10k to 3V3_CLEAN — disables wake-on-LAN)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","3V3_CLEAN"),("2","RTL_LANWAKEB")])

    # HanRun HR911105A MagJack (pins 4,5=center tap 3V3, pin 8=GND, 9-12=LEDs NC, SH=shield)
    add(_next_ref("J"), "HR911105A", FP_MAGJACK, "Connector", "RJ45_Hanrun_HR911105A_Horizontal",
        [("1","ETH_MDI_TXP"),("2","ETH_MDI_TXN"),("3","ETH_MDI_RXP"),
         ("4","3V3_CLEAN"),("5","3V3_CLEAN"),("6","ETH_MDI_RXN"),
         ("8","GND"),("SH","GND")])

    # RTL8152B external supply decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","3V3_CLEAN"),("2","GND")])
    # VDD5 decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])

    # ======================================================================
    # D: SPI Display (8-pin connector)
    # ======================================================================
    add("J6", "ST7789V2", FP_SCREEN_CONN, "Connector_Generic", "Conn_01x08",
        [("1","GND"),("2","3V3_SYS"),("3","SPI3_CLK"),("4","SPI3_MOSI"),
         ("5","SCREEN_RST"),("6","SCREEN_DC"),("7","SPI3_CS"),("8","SCREEN_BL")])
    # Display bypass cap
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])
    # SPI3_CS pull-up (10k to 3V3_SYS — keep display deselected during boot)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","SPI3_CS")])

    # ======================================================================
    # E: Alps SKRHABE010 5-Way Nav Switch (ECO #2026-03-NAV)
    # ======================================================================
    add(_next_ref("SW"), "SKRHABE010", FP_NAV_SW, "Daemon_V0", "SKRHABE010",
        [("A","NAV_UP"),("B","NAV_LEFT"),("C","NAV_DOWN"),
         ("D","NAV_RIGHT"),("Center","NAV_CENTER"),("Common","GND")])

    # Nav switch pull-up resistors (10k to 3V3_SYS, one per direction + center)
    # These pull to 3V3_SYS; PCF8574 reads them via I2C (see E1 section below)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","NAV_UP")])
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","NAV_DOWN")])
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","NAV_LEFT")])
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","NAV_RIGHT")])
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","NAV_CENTER")])

    # ======================================================================
    # E1: PCF8574 I2C GPIO Expander (nav switch interface)
    # ======================================================================
    # Moves nav switch off Radxa GPIOs → frees pins 8,10,11,33 for AUX_GPIO.
    # NAV_CENTER also on BSS84 drain for hardware wake-up (works when PCF8574
    # is unpowered during shutdown — pins go high-Z, switch still pulls
    # PMIC_KEY to GND through conducting BSS84).
    # Address 0x20 (A0=A1=A2=GND), shares I2C1 bus with IP5328P (0x75).
    add("U21", "PCF8574", FP_PCF8574, "Interface_Expansion", "PCF8574",
        [("VCC","3V3_SYS"),("VSS","GND"),
         ("SDA","I2C1_SDA"),("SCL","I2C1_SCL"),
         ("A0","GND"),("A1","GND"),("A2","GND"),
         ("P0","NAV_UP"),("P1","NAV_DOWN"),("P2","NAV_LEFT"),("P3","NAV_RIGHT"),
         ("P4","NAV_CENTER"),
         ("P5","STINGER_EN_5"),  # GPIO-controlled USB-C female port 5 enable
         ("P6","RF_GDO0"),      # CC1101 interrupt (sync word / RX ready)
         ("P7","IR_RX"),         # IR receiver (TSOP38238) demodulated output
         ("INT","PCF8574_INT")])
    # PCF8574 bypass cap
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])
    # PCF8574 INT pull-up (10k to 3V3_SYS) — open-drain; keeps INT high (inactive) when no nav
    # event. Wire PCF8574_INT to a Radxa GPIO to enable interrupt-driven nav detection.
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","PCF8574_INT")])

    # ======================================================================
    # E2: WS2812B x4 LEDs
    # ======================================================================
    # 74AHCT1G125 single-gate 3.3V→5V level shifter for WS2812B data line.
    # WS2812B VIH_min = 0.65×VDD = 3.25V at 5V supply; Radxa GPIO max = 3.3V → 50mV margin.
    # 74AHCT1G125: VCC=5V, VIH(in)=2.0V (HCT threshold) → safely driven by 3.3V GPIO.
    add(_next_ref("U"), "74AHCT1G125", FP_LDO_SOT23_5, "Logic_Buffer", "74AHCT1G125",
        [("A","MCU_LED_DIN"),("nOE","GND"),("Y","LED_DIN"),
         ("VCC","5V_SYS"),("GND","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])

    for i in range(1, 5):
        din = "LED_DIN" if i == 1 else f"WS2812B_DOUT_{i-1}"
        dout_pins = []
        if i < 4:
            dout_pins = [("DOUT", f"WS2812B_DOUT_{i}")]
        add(_next_ref("LED"), "WS2812B-2020", FP_WS2812B, "LED", "WS2812B-2020",
            [("VDD","5V_SYS"),("VSS","GND"),("DIN",din)] + dout_pins)
        add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_SYS"),("2","GND")])

    # ======================================================================
    # E3: IR Blaster
    # ======================================================================
    add(_next_ref("LED"), "VSMB294008", FP_IR_LED, "Device", "LED",
        [("A","IR_LED_P"),("K","IR_LED_N")])
    add(_next_ref("Q"), "AO3400A", FP_NFET_SOT23, "Device", "Q_NMOS_GDS",
        [("G","IR_GPIO"),("D","IR_LED_N"),("S","GND")])
    # IR LED current limit: need to stay within resistor rating for worst-case DC stuck-on.
    # 100Ω → I=38mA, P=0.14W → use 1206 (0.25W, ample margin). 38mA is still good for IR blast.
    add(_next_ref("R"), "100", "Resistor_SMD:R_1206_3216Metric", "Device", "R",
        [("1","5V_SYS"),("2","IR_LED_P")])
    # IR_GPIO pull-down (100k) — prevent spurious IR flash during Radxa boot
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","IR_GPIO"),("2","GND")])

    # ======================================================================
    # F: 40-Pin Radxa Expansion Header (PinSocket)
    # ======================================================================
    add("J3", "Radxa-40Pin", FP_RADXA_HDR, "Connector_Generic", "Conn_02x20_Odd_Even",
        [("1","3V3_SYS"),        ("2","RADXA_GPIO_5V"),
         ("3","I2C1_SDA"),       ("4","RADXA_GPIO_5V"),
         ("5","I2C1_SCL"),  ("6","GND"),
         ("7","SCREEN_BL"), ("8","AUX_GPIO_1"),   # was NAV_UP (→ PCF8574)
         ("9","GND"),       ("10","AUX_GPIO_2"),   # was NAV_DOWN (→ PCF8574)
         ("11","AUX_GPIO_3"),("12","RF_MOSI"),      # GPIO3_A2/I2S3_MCLK — soft SPI (not BCLK!)
         ("13","I2S_BCLK"),  ("14","GND"),         # GPIO3_A3/I2S3_SCLK_M0 — HW I2S bit clock
         ("15","RF_MISO"),  ("16","RF_CLK"),
         ("17","3V3_SYS"),  ("18","RF_CS_N"),
         ("19","SPI3_MOSI"),("20","GND"),
         ("21","STINGER_EN_4"),("22","SCREEN_RST"),
         ("23","SPI3_CLK"), ("24","SPI3_CS"),
         ("25","GND"),      ("26","GND"),              # Pin 26 = NC on Radxa Zero 3W
         ("27","PCF8574_INT"),("28","ISO_DO1"),  # Pin 27=PCF8574 IRQ, Pin 28=ISO1212 output 1
         ("29","STINGER_EN_1"),("30","GND"),
         ("31","STINGER_EN_2"),("32","SCREEN_DC"),
         ("33","STINGER_EN_3"),("34","WAGO_MODE"),     # GPIO: LOW=industrial, HIGH=RS-485 relay
         ("35","I2S_LRCLK"),("36","MCU_LED_DIN"),  # 3.3V → level shifter input
         ("37","PMIC_KILL"),("38","I2S_DATA_IN"),   # was NAV_CENTER (→ PCF8574+BSS84)
         ("39","GND"),      ("40","I2S_DATA_OUT")])

    # ======================================================================
    # Auxiliary I/O header (2x5 female socket — universal breakout)
    # ======================================================================
    # All pins are general-purpose from the user's perspective.
    # Internal connections (SP3485, IR MOSFET, ISO1212) are abstracted by software.
    # The daemon agent decides what each pin does at runtime.
    add("J4", "DAEMON-IO", FP_CONN_2X05, "Connector_Generic", "Conn_02x05_Odd_Even",
        [("1","3V3_J4_OUT"),   ("2","5V_J4_OUT"),    # PTC-fused power out
         ("3","AUX_GPIO_1_P"), ("4","AUX_GPIO_2_P"), # Protected GPIO
         ("5","AUX_GPIO_3_P"), ("6","IR_GPIO_P"),    # Protected GPIO
         ("7","RS485_A"),      ("8","RS485_B"),       # SM712 TVS protected
         ("9","GND"),          ("10","GND")])

    # ======================================================================
    # 3V3_SYS bulk decoupling at header (sourced from Radxa pin 1/17, no on-board regulator)
    add(_next_ref("C"), "10u",  FP_C0805, "Device", "C", [("1","3V3_SYS"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # K: Audio Subsystem (MAX98357A + INMP441 + TRRS + Speaker)
    # ECO #2026-03-MERGE: merged from audio_subsystem.py into unified netlist
    # ======================================================================
    # 5V_AUDIO supply filter: BLM18AG601SN1 rated 300mA but MAX98357A draws 640mA avg.
    # Replace with 1Ω 0805 series resistor — low enough to not drop significant voltage
    # (1Ω × 0.64A = 0.64V drop... too much). Use 0.22Ω 1206 instead (0.14V drop, P=0.09W).
    # Actually: just use a 1206 ferrite rated >1A (BLM31PG601SN1L = 1.5A, 0.08Ω)
    add(_next_ref("FB"), "BLM31PG601SN1L", "Inductor_SMD:L_1206_3216Metric", "Device", "FerriteBead",
        [("1","5V_SYS"),("2","5V_AUDIO")])
    # 5V_AUDIO bulk decoupling (10u, 0805)
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","5V_AUDIO"),("2","GND")])

    # MAX98357A QFN-16+EPAD pin map (all physical pads declared for KiCad):
    #   1:VDD  2:GND  3:~SD  4:GAIN  5:GND  6:DIN  7:BCLK  8:LRCLK
    #   9:GND 10:GND 11:GND 12:GND 13:OUTN 14:GND 15:OUTP 16:GND  EPAD:GND
    add("U10", "MAX98357A", FP_QFN16, "Audio", "MAX98357A",
        [("VDD","5V_AUDIO"),
         ("GND_2","GND"),("GND_5","GND"),("GND_9","GND"),("GND_10","GND"),
         ("GND_11","GND"),("GND_12","GND"),("GND_14","GND"),("GND_16","GND"),
         ("EPAD","GND"),
         ("BCLK","I2S_BCLK"),("LRCLK","I2S_LRCLK"),("DIN","I2S_DATA_OUT"),
         ("OUTP","AMP_OUT_P"),("OUTN","AMP_OUT_N"),
         ("~{SD_MODE}","AMP_SD"),
         ("GAIN_SLOT","NC"),   # Float = +15dB gain, mono mix (L+R)/2 — best for single speaker
         ("EPAD","GND")])

    # Dual INMP441 microphones — bottom-port (sound hole through PCB)
    # Both powered from MIC_VDD (switched via mic LED → always-on together)
    # Mic 1: L/R=GND (left channel), Mic 2: L/R=VDD (right channel)
    # Radxa mixes both channels in software for improved SNR
    add("U13", "INMP441", FP_INMP441, "Daemon_V0", "INMP441",
        [("VDD","MIC_VDD"),("GND","GND"),
         ("SCK","I2S_BCLK"),("WS","I2S_LRCLK"),("SD","I2S_DATA_IN"),
         ("L/R","GND")])  # Left channel

    add(_next_ref("U"), "INMP441", FP_INMP441, "Daemon_V0", "INMP441",
        [("VDD","MIC_VDD"),("GND","GND"),
         ("SCK","I2S_BCLK"),("WS","I2S_LRCLK"),("SD","I2S_DATA_IN"),
         ("L/R","MIC_VDD")])

    # I2S_DATA_IN bus discharge resistor (INMP441 datasheet: 100k to GND required
    # when multiple mics share SD line — prevents floating during tristate intervals)
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","I2S_DATA_IN"),("2","GND")])

    # TRRS jack — NC switch topology:
    #   TipSwitch (NC input)   ← AMP_OUT_P_FILT (from ferrite bead)
    #   Tip (wiper/output)     → SPK_P (to speaker connector)
    #   Ring1Switch (NC input) ← AMP_OUT_N_FILT
    #   Ring1 (wiper/output)   → SPK_N (to speaker connector)
    # When plug absent: NC closed → amp drives speaker.
    # When plug inserted: NC opens → speaker disconnected.
    # SJ2-2531X-SMT TRRS jack with NC switches
    # KiCad symbol pin names: Sleeve, Detect, Tip, TipSwitch, Ring1, Ring1Switch
    # NC switches: closed when no plug → amp drives speaker; open when inserted
    add(_next_ref("J"), "SJ2-2531X", FP_TRRS, "Connector", "AudioJack4_Switch",
        [("Sleeve","GND"),("Detect","TRRS_DETECT_RAW"),
         ("Tip","SPK_P_FUSED"),("TipSwitch","AMP_OUT_P_FILT"),
         ("Ring1","SPK_N_FUSED"),("Ring1Switch","AMP_OUT_N_FILT"),
         ("Ring2","TRRS_RING2")])  # Ring2 = headset mic / line-in → NAU88C22 codec

    # Speaker connector (JST-SH 2-pin) — wired to wiper side of NC switch
    add(_next_ref("J"), "Speaker", FP_JST_SH2, "Connector_Generic", "Conn_01x02",
        [("1","SPK_P"),("2","SPK_N")])

    # SD_MODE pull-up to 3V3_SYS. MAX98357A has internal 100k pull-down on SD_MODE.
    # SJ2-2531X detect pin: NC to Sleeve(GND) when no plug; floats when plug inserted.
    # With 47k pull-up, 10k detect-to-SD, internal 100k pull-down:
    #   No plug (speaker): V = 3.3 × (10k||100k)/(47k+10k||100k) = 0.535V → left channel ✓
    #   Plug in (headphones): V = 3.3 × 100k/(47k+100k) = 2.24V → right channel
    # Both states: amp ON. NC switches mechanically disconnect speaker when plug inserted.
    # Power waste with headphones is ~5mA — acceptable for V0.
    add(_next_ref("R"), "47k", FP_R0402, "Device", "R",
        [("1","3V3_SYS"),("2","AMP_SD")])

    # TVS diodes on BTL outputs
    add(_next_ref("U"), "ESD9B5.0ST5G", FP_TVS_SC70, "Daemon_V0", "ESD9B5.0ST5G",
        [("A","AMP_OUT_P"),("K","GND")])
    add(_next_ref("U"), "ESD9B5.0ST5G", FP_TVS_SC70, "Daemon_V0", "ESD9B5.0ST5G",
        [("A","AMP_OUT_N"),("K","GND")])

    # BTL output series resistors (replaces ferrite beads — MAX98357A is filterless Class D;
    # speaker coil IS the filter. Ferrites create resonance and exceed 500mA rating at 3.2W/4Ω peak.
    # 10Ω 0805 ≥0.5W: limits peak current, EMI-safe, no resonance. Ref: MAX98357A datasheet §9.2)
    add(_next_ref("R"), "10R", FP_R0805, "Device", "R",
        [("1","AMP_OUT_P"),("2","AMP_OUT_P_FILT")])
    add(_next_ref("R"), "10R", FP_R0805, "Device", "R",
        [("1","AMP_OUT_N"),("2","AMP_OUT_N_FILT")])
    # Post-bead shunt caps (1nF)
    add(_next_ref("C"), "1n", FP_C0402, "Device", "C", [("1","AMP_OUT_P_FILT"),("2","GND")])
    add(_next_ref("C"), "1n", FP_C0402, "Device", "C", [("1","AMP_OUT_N_FILT"),("2","GND")])

    # TRRS detect → AMP_SD: 10k resistor + 100nF RC debounce
    # SJ2-2531X: Detect NC to Sleeve(GND). No plug = detect LOW. Plug inserted = detect FLOATS.
    # This pulls AMP_SD lower when no plug (speaker connected), raising it when headphones in.
    # Not a shutdown mechanism — just shifts SD_MODE voltage for channel selection.
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","TRRS_DETECT_RAW"),("2","AMP_SD")])
    # AMP_SD bypass cap (100nF to GND — RC debounce with the 10k above)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C",
        [("1","AMP_SD"),("2","GND")])

    # Amplifier decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_AUDIO"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","5V_AUDIO"),("2","GND")])
    # Microphone decoupling (one per mic, on MIC_VDD rail)
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","MIC_VDD"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","MIC_VDD"),("2","GND")])

    # Mic power rail: 3V3_SYS → current-limit resistor → red LED → MIC_VDD
    # LED is in the mic power path: glows whenever mics are powered (hardware indicator)
    # INMP441 draws ~1.4mA each (2.8mA total), LED Vf ~1.8V → headroom fine at 3.3V
    # Series resistor sized for LED brightness: (3.3V - 1.8V - 1.8V_mic) ≈ too tight
    # Actually: LED in shunt, not series — use a low-side indicator instead:
    # 3V3_SYS → BLM18AG601SN1 ferrite bead → MIC_VDD (EMI-filtered clean mic power)
    # MIC_VDD → 1k → LED → GND (shunt indicator, ~1.5mA)
    add(_next_ref("FB"), "BLM18AG601SN1", FP_FERRITE_0603, "Device", "FerriteBead",
        [("1","3V3_SYS"),("2","MIC_VDD")])
    add(_next_ref("R"), "1k", FP_R0402, "Device", "R",
        [("1","MIC_VDD"),("2","MIC_LED_A")])
    add(_next_ref("LED"), "RED_0402", FP_LED_0402, "Device", "LED",
        [("A","MIC_LED_A"),("K","GND")])
    add(_next_ref("LED"), "RED_0402", FP_LED_0402, "Device", "LED",
        [("A","MIC_LED_A"),("K","GND")])

    # Power indicator LED (green 0402): 3V3_SYS → 1k → LED → GND
    # Always on when system has power — hardwired, no GPIO control
    add(_next_ref("R"), "1k", FP_R0402, "Device", "R",
        [("1","3V3_SYS"),("2","PWR_LED_A")])
    add(_next_ref("LED"), "GREEN_0402", FP_LED_0402, "Device", "LED",
        [("A","PWR_LED_A"),("K","GND")])

    # ==== ZERO-COST FIX: PMIC charge indicator LED on IP5328P LIGHT pin ====
    # LIGHT is open-drain — sinks current when active (charging/full).
    # Circuit: 3V3_SYS → 1k → LED_A → LED_K → LIGHT(open-drain) → GND
    add(_next_ref("R"), "1k", FP_R0402, "Device", "R",
        [("1","3V3_SYS"),("2","PMIC_LIGHT_LED")])
    add(_next_ref("LED"), "AMBER_0402", FP_LED_0402, "Device", "LED",
        [("A","PMIC_LIGHT_LED"),("K","IP5328P_LIGHT")])

    # ======================================================================
    # L: NAU88C22 Audio Codec — Full-Duplex I2S Audio I/O
    # ======================================================================
    # Enables: guitar pedal, headset mic, line-in, stereo headphone out
    # Shares I2S bus with INMP441 mics (TDM mode) and MAX98357A
    # Controlled via I2C1 at address 0x1A
    # NAU88C22YG QFN-32 pin map:
    #   1:LHPOUT 2:RHPOUT 3:LSPKOUT 4:RSPKOUT 5:AVDD 6:LMICN 7:LMICP 8:RMICN
    #   9:RMICP 10:LAUX 11:RAUX 12:VREF 13:MICBIAS 14:AGND 15:R2P 16:R2N
    #   17:L2P 18:L2N 19:DGND 20:DVDD 21:MCLK 22:BCLK 23:FS 24:ADCOUT
    #   25:DACIN 26:CSB/GPIO1 27:SCLK 28:SDIN 29:MODE 30:GPIO2/CLKOUT 31:GPIO3/SMPLRT 32:GPIO4
    #   33:EPAD
    add("U27", "NAU88C22", FP_NAU88C22, "Audio", "NAU88C22",
        [("LHPOUT","CODEC_LHPOUT"),("RHPOUT","CODEC_RHPOUT"),
         ("LSPKOUT","CODEC_LSPKOUT"),("RSPKOUT","CODEC_RSPKOUT"),
         ("AVDD","CODEC_AVDD"),("LMICN","CODEC_LMICN"),("LMICP","CODEC_LMICP"),
         ("RMICN","CODEC_RMICN"),("RMICP","CODEC_RMICP"),
         ("LAUX","CODEC_LAUX"),("RAUX","CODEC_RAUX"),
         ("VREF","CODEC_VREF"),("MICBIAS","CODEC_MICBIAS"),
         ("AGND","GND"),("R2P","GND"),("R2N","GND"),("L2P","GND"),("L2N","GND"),
         ("DGND","GND"),("DVDD","CODEC_DVDD"),
         ("MCLK","GND"),        # No MCLK — NAU88C22 can derive from BCLK (PLL mode)
         ("BCLK","I2S_BCLK"),("FS","I2S_LRCLK"),
         ("ADCOUT","CODEC_ADCOUT"),  # Separate net — NOT on I2S_DATA_IN to avoid bus fight with INMP441s
         ("DACIN","I2S_DATA_OUT"),  # Radxa I2S output → Codec DAC input
         ("CSB","GND"),         # I2C address = 0x1A (CSB low)
         ("SCLK","I2C1_SCL"),("SDIN","I2C1_SDA"),
         ("MODE","3V3_SYS"),    # MODE high = I2C mode
         ("GPIO2","GND"),("GPIO3","GND"),("GPIO4","GND"),  # unused GPIOs
         ("EPAD","GND")])
    # AVDD decoupling (analog 3.3V)
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","CODEC_AVDD"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","CODEC_AVDD"),("2","GND")])
    # DVDD decoupling (digital 1.8V internal LDO)
    add(_next_ref("C"), "10u", FP_C0805, "Device", "C", [("1","CODEC_DVDD"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","CODEC_DVDD"),("2","GND")])
    # VREF decoupling (reference voltage)
    add(_next_ref("C"), "100u", FP_TANT_CASEB, "Device", "C_Polarized",
        [("1","CODEC_VREF"),("2","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","CODEC_VREF"),("2","GND")])
    # AVDD supply from 3V3_SYS via ferrite bead (clean analog supply)
    add(_next_ref("FB"), "BLM18AG601SN1", FP_FERRITE_0603, "Device", "FerriteBead",
        [("1","3V3_SYS"),("2","CODEC_AVDD")])
    # MICBIAS decoupling (provides bias voltage for electret headset mics)
    add(_next_ref("C"), "1u", FP_C0402, "Device", "C", [("1","CODEC_MICBIAS"),("2","GND")])

    # TRRS Ring2 → Codec left mic input (headset mic / line-in)
    # DC-blocking cap + bias from MICBIAS for electret headset mics
    add(_next_ref("C"), "1u", FP_C0402, "Device", "C",
        [("1","TRRS_RING2"),("2","CODEC_LMICP")])
    # LMICN to GND for single-ended mic input
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","CODEC_LMICN"),("2","GND")])
    # Codec ADC → I2S_DATA_IN solder jumper (0Ω, DNP by default).
    # Populate ONLY when using codec ADC input instead of INMP441 mics.
    # Both cannot drive I2S_DATA_IN simultaneously — firmware must disable the other.
    add(_next_ref("R"), "0R_DNP", FP_R0402, "Device", "R",
        [("1","CODEC_ADCOUT"),("2","I2S_DATA_IN")])
    # MICBIAS to Ring2 via 2.2k (powers electret headset mic)
    add(_next_ref("R"), "2.2k", FP_R0402, "Device", "R",
        [("1","CODEC_MICBIAS"),("2","TRRS_RING2")])

    # Codec headphone output → TRRS Tip/Ring1 via DC-blocking caps
    # These connect in parallel with the MAX98357A BTL outputs (through the NC switches).
    # When headphones are plugged in: NC switches open (disconnect amp from speaker),
    # and codec drives headphones via Tip/Ring1 directly.
    add(_next_ref("C"), "100u", FP_TANT_CASEB, "Device", "C_Polarized",
        [("1","CODEC_LHPOUT"),("2","AMP_OUT_P_FILT")])
    add(_next_ref("C"), "100u", FP_TANT_CASEB, "Device", "C_Polarized",
        [("1","CODEC_RHPOUT"),("2","AMP_OUT_N_FILT")])

    # ======================================================================
    # M: ADS1115 — 4-Channel 16-bit I2C ADC
    # ======================================================================
    # Analog inputs for sensors, expression pedal, voltage monitoring, 4-20mA
    # I2C address 0x48 (ADDR pin to GND)
    # ADS1115 MSOP-10 pin map:
    #   1:ADDR 2:ALRT 3:GND 4:AIN0 5:AIN1 6:AIN2 7:AIN3 8:VDD 9:SDA 10:SCL
    add("U28", "ADS1115", FP_ADS1115, "Analog_ADC", "ADS1115",
        [("ADDR","ADC_ADDR"),("ALRT","ADC_ALRT"),("GND","GND"),
         ("AIN0","ADC_AIN0"),("AIN1","ADC_AIN1"),("AIN2","ADC_AIN2"),("AIN3","ADC_AIN3"),
         ("VDD","3V3_SYS"),("SDA","I2C1_SDA"),("SCL","I2C1_SCL")])
    # ADDR to GND = I2C address 0x48
    add(_next_ref("R"), "0", FP_R0402, "Device", "R", [("1","ADC_ADDR"),("2","GND")])
    # ALRT open-drain interrupt (10k pull-up, optional — for threshold alerts)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","ADC_ALRT")])
    # VDD decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])
    # Analog input header (1x4): AIN0-AIN3 broken out for external sensors
    add("J17", "Analog-In", FP_CONN_1X05_F, "Connector_Generic", "Conn_01x05",
        [("1","ADC_AIN0_P"),("2","ADC_AIN1_P"),("3","ADC_AIN2_P"),("4","ADC_AIN3_P"),("5","GND")])

    # ======================================================================
    # N: SP3485 — RS-485 Transceiver (Modbus / DMX-512)
    # ======================================================================
    # Half-duplex RS-485. UART2 TX/RX on AUX_GPIO_1/2, DE on AUX_GPIO_3.
    # SP3485EN SOIC-8 pin map:
    #   1:RO 2:RE 3:DE 4:DI 5:GND 6:A 7:B 8:VCC
    add("U29", "SP3485", FP_SP3485, "Interface_UART", "SP3485",
        [("RO","AUX_GPIO_2"),  # Receiver output → UART2_RX (Radxa pin 10)
         ("RE","RS485_DE"),     # Receiver enable (active low) — tied to DE for half-duplex
         ("DE","RS485_DE"),     # Driver enable (active high)
         ("DI","AUX_GPIO_1"),   # Driver input → UART2_TX (Radxa pin 8)
         ("GND","GND"),("A","RS485_A"),("B","RS485_B"),("VCC","3V3_SYS")])
    # DE/RE control from AUX_GPIO_3 (Radxa pin 11)
    add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
        [("1","AUX_GPIO_3"),("2","RS485_DE")])
    # Pull-down ensures DE=LOW (receive mode) during boot before GPIO is configured
    add(_next_ref("R"), "100k", FP_R0402, "Device", "R",
        [("1","RS485_DE"),("2","GND")])
    # Bus termination resistor (120Ω between A and B, solder jumper — populate if end-of-line)
    add(_next_ref("R"), "120", FP_R0402, "Device", "R", [("1","RS485_A"),("2","RS485_B")])
    # VCC decoupling
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])
    # RS-485 A/B broken out on J4 (DAEMON-IO header) — no separate terminal needed.

    # ======================================================================
    # O: TSOP38238 — IR Receiver (38kHz demodulated output)
    # ======================================================================
    # Learns any IR remote (NEC, RC5, RC6, SIRC, raw protocols)
    # Output → PCF8574 P7 (was tied to GND, now IR receiver)
    # TSOP38238 pinout: 1:OUT 2:GND 3:VS
    # VCC filtering per Vishay datasheet: 3V3_SYS → 100R → IR_VS_FILT → VS pin
    add(_next_ref("R"), "100", FP_R0402, "Device", "R", [("1","3V3_SYS"),("2","IR_VS_FILT")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","IR_VS_FILT"),("2","GND")])
    add(_next_ref("C"), "4u7", FP_C0402, "Device", "C", [("1","IR_VS_FILT"),("2","GND")])
    add("U30", "TSOP38238", FP_TSOP38238, "Sensor_Optical", "TSOP38238",
        [("OUT","IR_RX"),("GND","GND"),("VS","IR_VS_FILT")])

    # UART debug: signals available on J4 pins 6/7 (AUX_GPIO_1/2 = UART2 TX/RX).
    # No separate header needed.

    # ======================================================================
    # Q: ATECC608B Secure Element — Hardware Crypto & Key Storage
    # ======================================================================
    # I2C address 0x60 (default). Provides: ECDSA P-256, SHA-256 HMAC,
    # hardware-bound key storage (keys never leave chip), device identity,
    # firmware signing, CC1101 AES key protection, anti-rollback counter.
    add("U31", "ATECC608B", FP_ATECC608B, "Security", "ATECC608B",
        [("SDA","I2C1_SDA"),("SCL","I2C1_SCL"),
         ("VCC","3V3_SYS"),("GND","GND"),
         ("NC_1","NC"),("NC_2","NC"),("NC_3","NC"),("EPAD","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # ======================================================================
    # R: Port Protection — Make Every Port Unfryable
    # ======================================================================

    # --- J13 Goobay VBUS: TVS + PTC (was ZERO protection) ---
    # PTC fuse in series: limits sustained fault current so TVS survives
    add(_next_ref("F"), "PTC_1A", FP_PTC_1206, "Device", "Polyfuse",
        [("1","GOOBAY_VBUS_FUSED"),("2","IP5328P_VBUS")])
    # TVS on the PMIC side of the PTC
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","IP5328P_VBUS")])

    # --- USB-A host ports backfeed protection (SY6280 body diode path) ---
    # Ports 2/3 are host-only (no charging Schottky) but SY6280 body diode
    # can still backfeed overvoltage from connector to 5V_SYS.
    # TVS directly on USB_VBUS_2/3 clamps before SY6280 body diode conducts.
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","USB_VBUS_2")])
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","USB_VBUS_3")])

    # --- USB charging port PTC fuses (sustained overvoltage protection) ---
    # These sit between the SS34 Schottky anodes and the connector VBUS.
    # At normal operation: SY6280 output passes through. At overvoltage: PTC trips.
    add(_next_ref("F"), "PTC_500mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","USB_VBUS_1"),("2","USB_VBUS_1_FUSED")])
    add(_next_ref("F"), "PTC_500mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","USB_VBUS_4"),("2","USB_VBUS_4_FUSED")])
    add(_next_ref("F"), "PTC_500mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","USB_VBUS_5"),("2","USB_VBUS_5_FUSED")])

    # --- BAT1 reverse polarity protection ---
    # SS34 in series: blocks reversed battery entirely (0.45V drop)
    add(_next_ref("D"), "SS34", FP_SCHOTTKY_SMA, "Device", "D_Schottky",
        [("A","BAT"),("K","BAT_PROTECTED")])
    # TVS on BAT_ISO: clamps overvoltage (12V lead-acid) so PTC trips
    add(_next_ref("D"), "SMBJ5.0A", FP_TVS_SMB, "Device", "D_TVS",
        [("A","GND"),("K","BAT_ISO")])

    # --- J17 Analog input protection (10k series + TVS per channel) ---
    # Protects ADS1115 from 24V, negative voltage, and ESD
    for i in range(4):
        ain = f"ADC_AIN{i}"
        ain_p = f"ADC_AIN{i}_P"
        add(_next_ref("R"), "10k", FP_R0402, "Device", "R",
            [("1",ain_p),("2",ain)])
        add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
            [("A","GND"),("K",ain)])

    # --- J4 GPIO protection (1k series + TVS per pin) ---
    # Protects Radxa SoC GPIO from overvoltage and ESD
    for gpio, gpio_p in [("AUX_GPIO_1","AUX_GPIO_1_P"),
                          ("AUX_GPIO_2","AUX_GPIO_2_P"),
                          ("AUX_GPIO_3","AUX_GPIO_3_P"),
                          ("IR_GPIO","IR_GPIO_P")]:
        add(_next_ref("R"), "1k", FP_R0402, "Device", "R",
            [("1",gpio_p),("2",gpio)])
        add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
            [("A","GND"),("K",gpio)])

    # RS-485 bus TVS (Bourns CDSOT23-SM712: asymmetric ±7V/±12V clamp)
    add(_next_ref("D"), "SM712", FP_SOT236, "Device", "D_TVS_x2_AAC",
        [("1","RS485_A"),("2","GND"),("3","RS485_B")])

    # --- J15 TRRS audio protection ---
    # PTC on speaker lines (protects MAX98357A from phantom power)
    add(_next_ref("F"), "PTC_200mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","SPK_P"),("2","SPK_P_FUSED")])
    add(_next_ref("F"), "PTC_200mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","SPK_N"),("2","SPK_N_FUSED")])
    # Series resistor on Ring2 (limits current from 48V phantom to codec MICBIAS)
    add(_next_ref("R"), "1k", FP_R0402, "Device", "R",
        [("1","TRRS_RING2"),("2","TRRS_RING2_P")])
    # TVS on Ring2 after series R
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","TRRS_RING2_P")])

    # --- J14 Ethernet surge protection ---
    # CDSOT23-SM712 on PHY side of MagJack (lightning/ring voltage)
    add(_next_ref("D"), "SM712", FP_SOT236, "Device", "D_TVS_x2_AAC",
        [("1","ETH_MDI_TXP"),("2","GND"),("3","ETH_MDI_TXN")])
    add(_next_ref("D"), "SM712", FP_SOT236, "Device", "D_TVS_x2_AAC",
        [("1","ETH_MDI_RXP"),("2","GND"),("3","ETH_MDI_RXN")])

    # WAGO field power: ISO_VCC1 is powered from 3V3_SYS via ISO1212 VCC1 pin.
    # NO reverse-polarity diode here — it would backfeed 24V field power into 3V3_SYS
    # and defeat the ISO1212 galvanic isolation. The field side must stay isolated.

    # ======================================================================
    # S: USB Data Switches — True Security Disconnect on All Stinger Ports
    # ======================================================================
    # SY6280 only cuts VBUS power. A self-powered device still has full D+/D-.
    # TS3USB221 switches cut BOTH data lines when port is disabled.
    # OE is active-LOW but STINGER_EN is active-HIGH → need inverter.
    # 74LVC04A hex inverter: 6 channels, TSSOP-14. Use 5 for ports 1-5.
    add("U32", "74LVC04A", FP_HEX_INV, "Logic", "74LVC04A",
        [("1A","STINGER_EN_1"),("1Y","STINGER_OE_1"),
         ("2A","STINGER_EN_2"),("2Y","STINGER_OE_2"),
         ("3A","STINGER_EN_3"),("3Y","STINGER_OE_3"),
         ("4A","STINGER_EN_4"),("4Y","STINGER_OE_4"),
         ("5A","STINGER_EN_5"),("5Y","STINGER_OE_5"),
         ("6A","GND"),("6Y","NC"),  # Unused channel — tie input to GND
         ("VCC","3V3_SYS"),("GND","GND")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # TS3USB221 per stinger port: SEL=GND (use channel 1 only), OE from inverter
    # Hub D+/D- on channel 1 (D1+/D1-), connector D+/D- on COM+/COM-
    usb_switch_configs = [
        ("U33", "HUB1_DN_DP_1", "HUB1_DN_DM_1", "STINGER_OE_1"),  # Port 1 (USB-C male)
        ("U34", "HUB1_DN_DP_2", "HUB1_DN_DM_2", "STINGER_OE_2"),  # Port 2 (USB-A female)
        ("U35", "HUB1_DN_DP_3", "HUB1_DN_DM_3", "STINGER_OE_3"),  # Port 3 (USB-A female)
        ("U36", "HUB2_DN_DP_1", "HUB2_DN_DM_1", "STINGER_OE_4"),  # Port 4 (USB-A male)
    ]
    for ref, dp_hub, dm_hub, oe_net in usb_switch_configs:
        add(ref, "TS3USB221", FP_TS3USB221, "Analog_Switch", "TS3USB221",
            [("OE",oe_net),("GND","GND"),
             ("D1+",dp_hub),("D1-",dm_hub),  # Hub side
             ("SEL","GND"),  # Select channel 1
             ("D2+","NC"),("D2-","NC"),  # Channel 2 unused
             ("COM+",dp_hub+"_SW"),("COM-",dm_hub+"_SW"),  # Connector side (switched)
             ("VCC","3V3_SYS")])
        add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # Port 5 (USB-C female, Hub2 port 3) — same treatment
    add("U37", "TS3USB221", FP_TS3USB221, "Analog_Switch", "TS3USB221",
        [("OE","STINGER_OE_5"),("GND","GND"),
         ("D1+","HUB2_DN_DP_3"),("D1-","HUB2_DN_DM_3"),
         ("SEL","GND"),("D2+","NC"),("D2-","NC"),
         ("COM+","HUB2_DN_DP_3_SW"),("COM-","HUB2_DN_DM_3_SW"),
         ("VCC","3V3_SYS")])
    add(_next_ref("C"), "100n", FP_C0402, "Device", "C", [("1","3V3_SYS"),("2","GND")])

    # --- J6 Display connector protection ---
    # SPI signals go directly to Radxa GPIO — add TVS clamping
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","SPI3_CLK")])
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","SPI3_MOSI")])
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","SCREEN_RST")])
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","SCREEN_DC")])

    # --- I2C bus protection ---
    # I2C1_SDA/SCL go to Radxa + all I2C devices — add TVS
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","I2C1_SDA")])
    add(_next_ref("D"), "ESD5Z3.3", FP_ESD_SOD523, "Device", "D_TVS",
        [("A","GND"),("K","I2C1_SCL")])

    # --- J4 power pin protection ---
    # PTC fuses on 3V3 and 5V outputs to prevent backfeed/short damage
    add(_next_ref("F"), "PTC_500mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","3V3_SYS"),("2","3V3_J4_OUT")])
    add(_next_ref("F"), "PTC_500mA", FP_PTC_0805, "Device", "Polyfuse",
        [("1","5V_SYS"),("2","5V_J4_OUT")])

    return comps


# Add BJT intermediate nets (not in original NETS list)
NETS.extend(["BJT_BASE", "BJT_COLLECTOR", "NC"])

# Build components
COMPONENTS = _build_components()


# -- KiCad netlist S-expression builder ---------------------------------------


def _build_netlist() -> str:
    """Render the full KiCad netlist S-expression."""
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = []

    lines.append('(export (version "E")')
    lines.append("  (design")
    lines.append('    (source "netlist/full_system.py")')
    lines.append(f'    (date "{now}")')
    lines.append('    (tool "Daemon V0 Phase 4 -- gen_golden_netlist.py")')
    lines.append("  )")

    # -- components section --
    lines.append("  (components")
    for c in COMPONENTS:
        lines.append(f'    (comp (ref "{c["ref"]}")')
        lines.append(f'          (value "{c["value"]}")')
        lines.append(f'          (footprint "{c["fp"]}")')
        lines.append(f'          (libsource (lib "{c["lib"]}") (part "{c["part"]}"))')
        lines.append("    )")
    lines.append("  )")

    # -- nets section --
    # Merge net aliases (connected in the real design)
    net_aliases: dict[str, str] = {
        # HUB1/HUB2 SUSP_N and OC_N removed — SL2.1A SOP-16 has no such pins
    }

    def resolve_net(name: str) -> str:
        while name in net_aliases:
            name = net_aliases[name]
        return name

    # Pin name → pad number maps for ICs where KiCad pad numbers differ from pin names.
    # Simple 2-pin parts (R, C, L, D, FB, Fuse) use "1"/"2" which already match.
    # For QFN/SOIC ICs, pad numbers are sequential; EPAD is "" or last+1.
    PIN_MAPS: dict[str, dict[str, str]] = {
        "IP5328P": {  # QFN-40+EPAD: pins 1-40, EPAD=41
            "DPA2":"1","CC1":"2","CC2":"3","DMC":"4","DPC":"5","DMB":"6","DPB":"7",
            "VSYS_1":"8","VSYS_2":"9","NTC":"10","L1":"11","L2":"12","L3":"13",
            "LX_1":"14","LX_2":"15","LX_3":"16","LX_4":"17","LX_5":"18",
            "BST":"19","LIGHT":"20","RSET":"21","VSYS_3":"22","VSYS_4":"23",
            "VSP":"24","VSN":"25","KEY":"26","VREG":"27","BAT":"28","AGND":"29",
            "VIN":"30","VING":"31","VBUS":"32","VBUSG":"33",
            "VOUT2":"34","VOUT2G":"35","VOUT1G":"36","VOUT1":"37",
            "DMA1":"38","DPA1":"39","DMA2":"40","EPAD":"41",
        },
        "SL2.1A": {  # SOIC-16: pins 1-16
            "VDD5":"1","DP":"2","DM":"3","VDD33":"4","DP1":"5","DM1":"6","DP2":"7","DM2":"8",
            "GND":"9","DP3":"10","DM3":"11","DP4":"12","DM4":"13","VDD18":"14","XIN":"15","XOUT":"16",
        },
        "RTL8152B": {  # QFN-24+EPAD
            "AVDD33_1":"1","MDI0P":"2","MDIN0":"3","MDI1P":"4","MDIN1":"5","U2GND":"6",
            "U2DM":"7","U2DP":"8","U2VDD10":"9","AVDD33_2":"10","VDD5":"11","DVDD10_UPS":"12",
            "DVDD33":"13","GPIO":"14","LEDCSB":"15","DVDD10":"16","SPISCK":"17",
            "XTALDET":"18","LANWAKEB":"19","SPISDO":"20","CKXTAL1":"21","CKXTAL2":"22",
            "AVDD10":"23","RSET":"24","EPAD":"25",
        },
        "MAX98357A": {  # QFN-16+EPAD
            "VDD":"1","GND_2":"2","~{SD_MODE}":"3","GAIN_SLOT":"4","GND_5":"5","DIN":"6",
            "BCLK":"7","LRCLK":"8","GND_9":"9","GND_10":"10","GND_11":"11","GND_12":"12",
            "OUTN":"13","GND_14":"14","OUTP":"15","GND_16":"16","EPAD":"17",
        },
        "CC1101": {  # QFN-20+EPAD
            "SCLK":"1","SI":"2","SO":"3","CSN":"4","GDO2":"5","GDO0":"6",
            "AVDD_1":"7","AVDD_2":"8","RF_N":"9","RF_P":"10","AVDD_3":"11","AVDD_4":"12",
            "DCOUPL":"13","DGUARD":"14","GND_1":"15","GND_2":"16","XI":"17","XO":"18",
            "DVDD":"19","RBIAS":"20","EPAD":"21",
        },
        "ISO1212": {  # SSOP-16
            "VCC1":"1","OUT1":"2","OUT2":"3","EN":"4","GND1":"5","SUB1":"6","NC_7":"7","SUB2":"8",
            "FGND2":"9","SENSE2":"10","IN2":"11","FGND1":"12","SENSE1":"13","IN1":"14",
            "NC_15":"15","NC_16":"16",
        },
        "PCF8574": {  # SOIC-16
            "A0":"1","A1":"2","A2":"3","P0":"4","P1":"5","P2":"6","P3":"7","VSS":"8",
            "P4":"9","P5":"10","P6":"11","P7":"12","INT":"13","SCL":"14","SDA":"15","VCC":"16",
        },
        "NE555D": {  # SOIC-8
            "GND":"1","TR":"2","Q":"3","R":"4","CV":"5","THR":"6","DIS":"7","VCC":"8",
        },
        "AP2112K-3.3": {  # SOT-23-5
            "VIN":"1","GND":"2","EN":"3","NC":"4","VOUT":"5",
        },
        "SY6280AAC": {  # SOT-23-5
            "IN":"1","GND":"2","EN":"3","OUT":"4","ISET":"5",
        },
        "SY6280AAAC": {  # SOT-23-5 (same pinout as AAC)
            "IN":"1","GND":"2","EN":"3","OUT":"4","ISET":"5",
        },
        "74AHCT1G125": {  # SOT-23-5
            "nOE":"1","A":"2","GND":"3","Y":"4","VCC":"5",
        },
        "USBLC6-2SC6": {  # SOT-23-6
            "1":"1","2":"2","3":"3","4":"4","5":"5","6":"6",
        },
        "Q_PNP_EBC": {"E":"1","B":"2","C":"3"},  # BC857
        "Q_NPN_GSD": {"G":"1","S":"2","D":"3"},
        "BSS84": {"G":"1","S":"2","D":"3"},  # P-ch MOSFET SOT-23: G=1,S=2,D=3
        "2N7002": {"G":"1","S":"2","D":"3"},  # N-ch MOSFET SOT-23: G=1,S=2,D=3
        "D_Schottky": {"A":"1","K":"2"},  # SS34 SMA / BAT54 SOD-323
        "D_TVS": {"A":"1","K":"2"},  # SMBJ5.0A, ESD5Z3.3
        "Polyfuse": {"1":"1","2":"2"},
        "Crystal": {"1":"1","2":"2","3":"3","4":"4"},
        "Antenna_Chip": {"1":"1","2":"2"},
        "INMP441": {"VDD":"1","GND":"2","SCK":"3","WS":"4","SD":"5","L/R":"6"},
        "WS2812B-2020": {"VDD":"1","DOUT":"2","VSS":"3","DIN":"4"},
        "RED_0402": {"A":"2","K":"1"},  # LED_0402: pad1=K, pad2=A
        "GREEN_0402": {"A":"2","K":"1"},
        "VSMB294008": {"A":"2","K":"1"},  # IR LED (0603)
        "ESD9B5.0ST5G": {"A":"1","K":"2"},  # TVS diode
        "USB_C_Plug_USB2.0": {"VBUS":"A4","CC":"A5","D+":"A6","D-":"A7","GND":"A1"},
        "USB_C_Receptacle_USB2.0": {
            "VBUS":"A4","D-":"A7","D+":"A6","CC1":"A5","CC2":"B5","GND":"A1",
        },
        "AudioJack4_Switch": {
            # SJ2-2531X KiCad footprint pads: T, R1, R2, S, GND
            "Sleeve":"S","Tip":"T","Ring1":"R1","Ring2":"R2",
            "TipSwitch":"T","Ring1Switch":"R1",  # NC switch → same pad as main contact
            "Detect":"GND",  # Detect NC to sleeve = GND pad
        },
        "Goobay-74446": {  # USB-C receptacle used as Goobay bridge
            "VBUS":"A4","D-":"A7","D+":"A6","CC1":"A5","CC2":"B5","GND":"A1",
        },
        "NAU88C22": {  # QFN-32+EPAD
            "LHPOUT":"1","RHPOUT":"2","LSPKOUT":"3","RSPKOUT":"4","AVDD":"5",
            "LMICN":"6","LMICP":"7","RMICN":"8","RMICP":"9","LAUX":"10","RAUX":"11",
            "VREF":"12","MICBIAS":"13","AGND":"14","R2P":"15","R2N":"16",
            "L2P":"17","L2N":"18","DGND":"19","DVDD":"20",
            "MCLK":"21","BCLK":"22","FS":"23","ADCOUT":"24","DACIN":"25",
            "CSB":"26","SCLK":"27","SDIN":"28","MODE":"29",
            "GPIO2":"30","GPIO3":"31","GPIO4":"32","EPAD":"33",
        },
        "ADS1115": {  # MSOP-10
            "ADDR":"1","ALRT":"2","GND":"3","AIN0":"4","AIN1":"5",
            "AIN2":"6","AIN3":"7","VDD":"8","SDA":"9","SCL":"10",
        },
        "SP3485": {  # SOIC-8
            "RO":"1","RE":"2","DE":"3","DI":"4","GND":"5","A":"6","B":"7","VCC":"8",
        },
        "TSOP38238": {"OUT":"1","GND":"2","VS":"3"},
        "AMBER_0402": {"A":"2","K":"1"},  # charge indicator LED
        "D_TVS_x2_AAC": {"A1":"1","K":"2","A2":"3"},  # VCAN26A2/SM712 3-pin dual TVS
        "ATECC608B": {"SDA":"5","SCL":"6","VCC":"8","GND":"4",
                      "NC_1":"1","NC_2":"2","NC_3":"3","EPAD":"9"},
        "SS14": {"A":"1","K":"2"},  # 1A Schottky SMA
        "Relay_DPDT": {  # G6K-2F-Y: pin map from KiCad symbol
            "Coil_1":"1","Coil_2":"16",
            "COM1":"12","NC1":"11","NO1":"9",
            "COM2":"4","NC2":"5","NO2":"8",
        },
        "1N4148W": {"A":"1","K":"2"},
        "BSS138": {"G":"1","S":"2","D":"3"},
        "74LVC04A": {  # Hex inverter TSSOP-14
            "1A":"1","1Y":"2","2A":"3","2Y":"4","3A":"5","3Y":"6","GND":"7",
            "4Y":"8","4A":"9","5Y":"10","5A":"11","6Y":"12","6A":"13","VCC":"14",
        },
        "TS3USB221": {  # USB 2.0 DPDT switch VSSOP-10
            "OE":"1","GND":"2","D1+":"3","D1-":"4","SEL":"5",
            "D2+":"6","D2-":"7","COM+":"8","COM-":"9","VCC":"10",
        },
        "Q_NMOS_GSD": {"G":"1","S":"2","D":"3"},
        "Q_NMOS_GDS": {"G":"1","D":"2","S":"3"},  # AO3400A SOT-23: G=1,D=2,S=3
        "USB_A": {  # USB-A connector (both male and female): pad 1=VBUS, 2=D-, 3=D+, 4=GND, 5=shield
            "VBUS":"1","D-":"2","D+":"3","GND":"4",
        },
        "RJ45_Hanrun_HR911105A_Horizontal": {
            "1":"1","2":"2","3":"3","4":"4","5":"5","6":"6","8":"8","SH":"SH",
        },
    }

    # Build pin name → pad number resolver
    def resolve_pin(comp: dict, pin_name: str) -> str:
        """Convert pin name to KiCad pad number."""
        part = comp["part"]
        # Check direct part match
        if part in PIN_MAPS and pin_name in PIN_MAPS[part]:
            return PIN_MAPS[part][pin_name]
        # Check value match (for transistors etc.)
        if comp["value"] in PIN_MAPS and pin_name in PIN_MAPS[comp["value"]]:
            return PIN_MAPS[comp["value"]][pin_name]
        # Simple parts: pin name IS the pad number (R, C, L use "1"/"2")
        return pin_name

    # Build reverse map: net_name -> [(ref, pad_number), ...]
    net_map: dict[str, list[tuple[str, str]]] = {}
    for net in NETS:
        resolved = resolve_net(net)
        if resolved not in net_map:
            net_map[resolved] = []

    for c in COMPONENTS:
        for pin_name, net_name in c["pins"]:
            resolved = resolve_net(net_name)
            if resolved not in net_map:
                net_map[resolved] = []
            pad_num = resolve_pin(c, pin_name)
            net_map[resolved].append((c["ref"], pad_num))

    lines.append("  (nets")
    for code, (net_name, nodes) in enumerate(net_map.items(), start=1):
        lines.append(f'    (net (code "{code}") (name "{net_name}")')
        for ref, pin in nodes:
            lines.append(f'      (node (ref "{ref}") (pin "{pin}"))')
        lines.append("    )")
    lines.append("  )")

    lines.append(")")
    return "\n".join(lines) + "\n"


def generate_golden_netlist() -> None:
    content = _build_netlist()
    OUTPUT_FILE.write_text(content, encoding="utf-8")
    print(f"Golden netlist written -> {OUTPUT_FILE}")
    print(f"  Components : {len(COMPONENTS)}")
    print(f"  Nets       : {len(set(NETS))}")
    print()


if __name__ == "__main__":
    generate_golden_netlist()