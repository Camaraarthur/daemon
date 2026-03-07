# Daemon V0 PCB - Research Notes

Date: 2025-03-07

---

## 1. Radxa Zero 3W Model RS107-D1E0H1W15

### Model Number Decoding

The model number `RS107-DxEyHzW15` breaks down as:

| Code | Meaning | Value in RS107-D1E0H1W15 |
|------|---------|--------------------------|
| RS107 | Radxa Zero 3W product family | - |
| D1 | DRAM (RAM) = 1GB LPDDR4 | 1GB |
| E0 | eMMC storage = 0 (none) | No eMMC |
| H1 | Header = 1 (pre-soldered GPIO header) | Header included |
| W15 | Wireless variant designation | Standard WiFi 6 / BT 5.4 |

### Available Variants

- **RAM**: 1GB, 2GB, 4GB, 8GB (LPDDR4)
- **eMMC**: None (E0), 8GB, 16GB, 32GB, 64GB
- **Header**: H0 = no header, H1 = pre-soldered 40-pin header

Example model numbers:
- `RS107-D1E0H0W15` = 1GB RAM, no eMMC, no header
- `RS107-D4E32H1W15` = 4GB RAM, 32GB eMMC, with header
- `RS107-D8E64H1W15` = 8GB RAM, 64GB eMMC, with header

### Board Dimensions

- **Board size**: 65mm x 30mm (Raspberry Pi Zero form factor)
- **SoC**: Rockchip RK3566
- Mechanical CAD files available: v1.11 2D DXF and v1.11 3D STP from Radxa downloads

### Sources
- https://radxa.com/products/zeros/zero3w/
- https://www.dstewart.com/okdo-radxa-zero-3w-1gb-wifi-bluetooth-5-0-without-gpio-164563.html
- https://www.cnx-software.com/2023/12/08/radxa-zero-3w-sbc-rockchip-rk3566-8gb-ram-wifi6-raspberry-pi-zero-2-w-form-factor/
- https://docs.radxa.com/en/zero/zero3

---

## 2. Radxa Zero 3W GPIO Header Type

### Connector Type

**The Radxa Zero 3W (H1 variants) comes with a standard male 2x20 pin header (2.54mm pitch) pre-soldered to the board.** This is the same type of header used on Raspberry Pi boards -- male pins sticking up from the PCB surface.

- H1 models: Male 2x20 (40-pin) header, 2.54mm pitch, pre-soldered
- H0 models: No header soldered (bare through-holes; user can solder their own)

**Note:** One source (CNX Software) mentioned "female GPIO headers" for a specific high-end configuration, but this appears to be an error or a one-off variant. The standard H1 configuration across all retailers shows a conventional male pin header, consistent with Raspberry Pi Zero form factor compatibility.

### Pin Height (Standard Male 2x20 Header)

Standard 2x20 male pin headers at 2.54mm pitch have:
- **Total pin length**: ~11.5-11.6mm
- **Pin height above PCB**: ~8.5mm (typical for standard through-hole headers)
- **Pin below PCB (solder tail)**: ~3.0-3.1mm
- **Plastic spacer height**: ~2.5mm

These are typical dimensions for standard male pin headers. The exact header component used by Radxa is not specified in their documentation.

### Sources
- https://radxa.com/products/zeros/zero3w/
- https://docs.radxa.com/en/zero/zero3/hardware-design/hardware-interface
- https://arace.tech/products/radxa-zero-3w

---

## 3. Female 2x20 Pin Socket / Stacking Header Options

### Option A: Standard Female Socket (Non-Stacking)

A plain 2x20 female socket (no pass-through pins) mates onto the male header:
- **Mating depth**: ~3.5mm (pins insert this far into the socket)
- **Socket body height**: ~8.5mm typical
- **Board-to-board spacing**: Approximately socket height minus mating depth, so ~5mm with a standard socket

### Option B: Stacking Headers (Female Socket + Male Pins Below)

Stacking headers have a female socket on top AND long male pins extending down through the PCB:

| Product | Socket Height | Pin Length | Board-to-Board | Notes |
|---------|--------------|------------|-----------------|-------|
| Pololu #2748 (Standard Stackable) | ~8.5mm | 10mm pins | ~8.5mm | Matches 11mm M2.5 standoffs for RPi |
| Pololu #2749 (Extra 0.3" Spacer) | ~16.1mm | 7.1mm pins | ~16mm | Clears RPi USB/Ethernet jacks |
| Adafruit #2223 (Extra-long pins) | ~8.5mm | 10mm pins | ~8.5mm | 5mm x 51mm x 19mm overall |
| Adafruit #1979 (Extra-tall) | ~23mm | - | ~23mm | For clearing tall components |
| Generic 18mm tall | ~18mm | - | ~18mm | Various Amazon sellers |

### Achieving ~8.85mm Board-to-Board Spacing

For approximately **8.85mm board-to-board spacing**, the standard Pololu #2748 or Adafruit #2223 stacking header is the closest match:
- These have an ~8.5mm female socket body
- When mated onto standard male pins, the board-to-board distance is approximately **8.5mm**
- The 0.35mm difference from 8.85mm could be accommodated with a thin washer/spacer or PCB thickness variations

**Alternative approach**: Use a plain (non-stacking) female 2x20 socket with a specific body height. Standard female headers come in various heights (7mm, 8.5mm, 11mm). An 8.5mm female socket body would give roughly the right spacing.

### Key Suppliers
- Pololu: https://www.pololu.com/product/2748 (standard), https://www.pololu.com/product/2749 (tall)
- Adafruit: https://www.adafruit.com/product/2223 (extra-long pins)
- Amazon: Search "2x20 40 Pin Stacking Female Header 2.54mm Raspberry Pi"

### Sources
- https://www.pololu.com/product/2748
- https://www.pololu.com/product/2749
- https://www.adafruit.com/product/2223
- https://www.adafruit.com/product/1979

---

## 4. Goobay 74446 USB-C Bridge Adapter

### What It Is

The Goobay 74446 is a **180-degree U-shaped USB-C male-to-male adapter**. It has two USB-C male plugs oriented in a U-shape, allowing it to bridge between two USB-C female ports that are facing each other (or on the same plane).

### Specifications

- **Type**: USB-C male to USB-C male, 180-degree U-shape
- **Standard**: USB4
- **Data transfer**: Up to 40 Gbit/s
- **Power delivery**: Up to 240W (USB PD EPR)
- **Video**: Up to 8K @ 60Hz
- **Backwards compatible**: USB 3.1, USB 2.0, Thunderbolt 3/4
- **Housing**: Robust, high-quality metal casing
- **Net weight**: 80g (0.08 kg)

### Physical Dimensions

**Exact product dimensions are NOT published by Goobay.** Only packaging dimensions are available:
- Package: 150mm x 150mm x 30mm (gross)

Based on USB-C connector standards and similar U-shape adapters:
- **USB-C plug width**: ~8.4mm
- **USB-C plug height**: ~2.6mm
- **USB-C insertion depth**: ~6.65mm
- **Typical U-shape adapter total width**: ~20-25mm (two plugs side by side)
- **Typical U-shape adapter depth**: ~13-15mm (the U-bend depth, i.e., how far back the adapter extends from the port face)
- **Gap between the two USB-C plugs**: ~13.5mm is common for similar adapters

### How It Mechanically Bridges

The adapter forms a "U" shape: two USB-C male connectors pointing in the same direction, connected by a short PCB/flex circuit at the back. When plugged into two USB-C ports on adjacent boards/devices, it creates an electrical bridge while the boards face the same direction. The two plugs insert into the two USB-C receptacles, and the U-bend sits between/behind the devices.

**IMPORTANT FOR PCB DESIGN**: You need to know the exact center-to-center distance between the two USB-C plugs on this adapter. This is not published. You may need to physically measure the adapter or find a detailed review with measurements. The USB-C connector standard width is 8.4mm, so the minimum center-to-center would be ~9-10mm, but the actual spacing on this specific adapter is unknown.

### Sources
- https://www.amazon.com/Goobay-Extension-Backwards-Compatible-74446/dp/B0DHCYHL6Q
- https://www.smartech.ee/en/products/kabei-un-adapteri/kabei/usb-kabei/goobay-74446-usb-c-adapter-180-u-shape-usb4/
- https://www.wentronic.com/en/usb-ctm-adapter-180-u-shape-usb4tm-74445

---

## 5. WS2812B LED Sizes and Alternatives

### WS2812B Standard (5050 / PLCC4)

- **Package**: 5050, PLCC4
- **Dimensions**: **5.0mm x 5.0mm x 1.6mm** (confirmed from TME/datasheet)
- **Voltage**: 3.7-5.3V DC
- **Pins**: 4 (VCC, GND, DIN, DOUT)
- Yes, 5x5mm is the real physical size

### Smaller Alternatives

| LED | Package | Dimensions | Notes |
|-----|---------|------------|-------|
| **WS2812B-Mini** | 3535, PLCC4 | **3.5mm x 3.5mm x ~1.6mm** | Same protocol as WS2812B, just smaller |
| **SK6812 Mini** | 3535 | **3.5mm x 3.5mm** | WS2812B-compatible clone, same size as WS2812B-Mini |
| **SK6812-MINI-E** | 3228 (reverse mount) | **3.2mm x 2.8mm x 1.78mm** | Reverse-mount (LEDs shine through the PCB). Side-mounted legs -- much easier to hand-solder. Popular for keyboards |

### Recommendations

- **If 5x5mm is too large**: Use **WS2812B-Mini (3535)** at 3.5x3.5mm -- same protocol, 51% less board area
- **If you want easiest soldering in small size**: Use **SK6812-MINI-E (3228)** at 3.2x2.8mm -- mid-mount legs are very hand-solder-friendly. Note: these are reverse-mount (light exits from the bottom/PCB side)
- **All are WS2812B-protocol compatible** and work with existing NeoPixel/WS2812 libraries

### Sources
- https://www.tme.com/us/en-us/details/ws2812b-b/smd-colour-leds/worldsemi/ws2812b-black/
- https://www.tme.com/us/en-us/details/ws2812b-mini/smd-colour-leds/worldsemi/
- https://www.adafruit.com/product/4960
- https://cdn-shop.adafruit.com/product-files/4960/4960_SK6812MINI-E_REV02_EN.pdf

---

## 6. KiCad 8: Flip Component to B.Cu

### Keyboard Shortcut

**Press `F`** while hovering over or holding a component in KiCad 8 pcbnew.

This is the "Flip" command. It moves the footprint from F.Cu (front copper) to B.Cu (back copper) and vice versa. All layers associated with the footprint are swapped to their corresponding opposite-side layers (e.g., F.SilkS becomes B.SilkS, F.Fab becomes B.Fab, etc.).

### Steps
1. Select the component (click on it, or hover over it)
2. Press **`F`** to flip it to the other side
3. The component will now be on B.Cu (if it was on F.Cu) or vice versa

### Additional Notes
- To flip the entire board VIEW (see the back side), the shortcut may vary but is not the same as flipping a component
- The `F` shortcut works both when the component is picked up (being moved) and when it is selected in place

### Sources
- https://docs.kicad.org/8.0/en/pcbnew/pcbnew.html
- https://forum.kicad.info/t/what-is-the-shortcut-for-flip-board-view/22442
- https://learn.sparkfun.com/tutorials/beginners-guide-to-kicad/editing-a-pcb-layout
