# Prior Art Deep Search: LED in Series with Microphone Power on PCB Trace

**Date**: 2026-04-06  
**Purpose**: Patent application preparation — comprehensive prior art assessment

---

## 1. CLOSEST PRIOR ART (Ranked by Threat Level)

### THREAT LEVEL: HIGH — Bose US11490248B2 (Granted)

- **Title**: Privacy Mode for a Wireless Audio Device
- **Assignee**: Lutron Technology Company (originally Bose)
- **Filed**: 2017-12-14 | **Granted**: 2022-11-01
- **Status**: ACTIVE granted patent

**What it claims (Claim 1 verbatim)**:
> An apparatus comprising: a microphone [...]; a switch having a first state and a second state [...] wherein the switch comprises a first transistor and a second transistor coupled in series electrical connection between a power connection and a ground connection; a control circuit electrically connected to the microphone [...] configured to control power to the microphone via a pin connected to a gate or base of each of the first and second transistors of the switch; and a light emitting diode (LED) connected to the switch and the microphone and configured to provide visual feedback indicating whether or not the second state is enabled; wherein, in the second state, the control circuit is configured to pull the pin to a logic high level to disconnect power to the microphone and provide power to the LED by turning on the second transistor and turning off the first transistor [...]

**Circuit topology**: Two transistors (Q1, Q3) act as a current-path multiplexer. In privacy mode, Q3 conducts, forcing current through LED+R1 to ground while dropping voltage below mic operating threshold (~1.6V). The LED is described as "connected in series electrical connection between the power supply line of the microphone through a resistor R1, and the power supply VCC."

**KEY DISTINCTION FROM OUR INVENTION**: 
- Bose REQUIRES transistors (Q1, Q3) and a control circuit with a pin
- Bose has a control circuit that ACTIVELY manages the privacy state
- Bose's LED indicates privacy mode (mic OFF), not mic activity (mic ON)
- Bose's system is software-triggerable via the control circuit
- Our invention: LED is ALWAYS in series — no transistors, no switch, no control circuit. Current to mic MUST pass through LED at all times. LED indicates mic is ACTIVE, not muted.

### THREAT LEVEL: HIGH — Meta US11343274B2 (Granted)

- **Title**: Non-spoofable privacy indicator showing disabling of sensors
- **Assignee**: Meta Platforms Inc.
- **Filed**: 2019-09-06 | **Granted**: 2022-05-24

**Circuit topology**: Uses SEPARATE switches with forced inversion logic. Switch A connects sensors to power, Switch B connects LED to power. Switches are mechanically or software-locked in OPPOSITE states. When sensors ON → LED OFF, when sensors OFF → LED ON.

**KEY DISTINCTION**: 
- Meta uses two independent power paths with inverted switches
- LED indicates sensors are OFF (privacy mode), not that they're active
- Requires active switching logic
- Our invention: single power path, LED always in line, indicates sensor is ON

### THREAT LEVEL: MEDIUM — Apple US20220094833A1 (Application)

- **Title**: Tamper-resistant indicator of recording by camera
- **Assignee**: Apple Inc.

**Circuit topology**: Uses a LIGHT SENSOR adjacent to the indicator LED. If the light sensor detects the LED is masked/covered, it disables the camera via active transistor switches (FIG. 7, 8). The light sensor is "hardwired to the camera and inaccessible by the system circuitry."

**KEY DISTINCTION**:
- Apple adds a light sensor as a tamper-detection mechanism
- Uses active transistor switches to control camera power
- Focused on preventing someone from COVERING the LED, not on LED-in-series
- Much more complex than our passive approach

### THREAT LEVEL: MEDIUM — BlackBerry/Malikie US10579820B2 (Granted)

- **Title**: Verified Privacy Mode Devices
- **Assignee**: Malikie Innovations Limited (originally BlackBerry)
- **Filed**: 2016-12-09 | **Granted**: 2020-03-03

**Circuit topology**: Uses ARM TrustZone trusted execution environment. LED controlled by TEE, not in series with sensor power. Hardware enable/disable control lines with transistors. Notes that "brightness and blinking duty cycle of an indicator LED can be chosen to allow the microphone bias current to properly supply."

**KEY DISTINCTION**:
- Requires TEE/TrustZone — active computing element
- LED is software-controlled by trusted firmware, not passively in series
- Much more complex, requires specific processor architecture

### THREAT LEVEL: LOW — Google US9317721B2 (Granted)

- **Title**: Privacy aware camera and device status indicator system
- **Assignee**: Google LLC
- **Filed**: 2012-10-31 | **Granted**: 2016-04-19

**Circuit topology**: Fully software-controlled. Privacy module in protected kernel memory controls LED. Compares commands against "library of known commands" to determine privacy state.

**KEY DISTINCTION**: Entirely software-based. No hardware circuit novelty.

### THREAT LEVEL: LOW — Harvatek US6307479B1 (Expired)

- **Title**: Running indicator for integrated circuit package
- **Assignee**: Harvatek Corp
- **Filed**: 2000-08-07 | **Granted**: 2001-10-23 | **STATUS: EXPIRED**

**Circuit topology**: LED directly in series with IC power input pad inside the IC package. LED lights when IC has power. Window in package cover to view LED.

**KEY DISTINCTION**: 
- This IS an LED in series with power — but for IC operational diagnostics, not privacy
- Inside an IC package, not on a PCB trace
- No mention of sensors, microphones, privacy, or wearables
- EXPIRED — cannot block our patent, but IS citable prior art for the basic concept
- This establishes that "LED in series with power line as indicator" is KNOWN in the art since 2000

---

## 2. RELATED BUT NON-BLOCKING PRIOR ART

### Humane AI Pin "Trust Light"
- Patent hints at "one or more light indicators to indicate on/off status"
- Uses a DEDICATED PRIVACY CHIP — active component, software-controlled
- Indicates ANY sensor activity, not just microphone
- No series electrical connection described

### Purism Librem Hardware Kill Switches
- Physical toggle switches that SEVER the circuit to mic/camera
- No LED indicator tied to the power path
- Kill switches are binary disconnect, not series indicator
- No patent found for this mechanism

### Amazon Echo / Google Nest Hardware Mute
- Physical button that disconnects mic power and illuminates red LED
- LED and mic on SEPARATE circuits controlled by the button switch
- Similar concept (hardware-guaranteed indicator) but different topology
- No patent specifically for the LED circuit found in search

### Apple iSight Camera LED (Pre-T2)
- LED wired to same STANDBY signal as camera image sensor
- When STANDBY is de-asserted, both camera and LED power on
- However: Brocker & Checkoway (iSeeYou, USENIX 2014) proved the firmware in the USB controller could be hacked to de-assert STANDBY for the sensor while keeping it asserted for the LED
- This means Apple's original design was NOT truly hardwired in series — it was firmware-controlled via the same signal line, which is fundamentally different from our approach
- No specific patent found for this LED wiring approach

### CN201533437U — Chinese Phantom Power LED Circuit
- LEDs driven by phantom power in microphone circuits
- Series-connected LEDs for brightness uniformity
- Purpose: status indication for audio equipment, not privacy
- Not privacy-related, not on PCB trace for wearables

---

## 3. ACADEMIC LITERATURE

### TickTock (ACM CCS 2022) — Ramesh et al.
- Detects microphone status via electromagnetic leakage of clock signals
- Entirely EXTERNAL detection method — does not modify hardware
- Motivation: "there are no adequate solutions to thwart attacks on microphones"
- This SUPPORTS our patent by establishing the PROBLEM exists and current solutions are inadequate

### KIMYA (USENIX Security 2023) — De Vaere & Perrig, ETH Zurich
- Hardening framework for smart speakers
- Uses ARM Cortex-M isolated execution environment
- LED guarantee through SOFTWARE isolation, not hardware series connection
- States: "KIMYA provides strong guarantees that this indicator LED cannot be circumvented"
- But mechanism is software/firmware isolation, NOT passive hardware

### iSeeYou (USENIX Security 2014) — Brocker & Checkoway
- PROVED that MacBook iSight LED could be disabled via firmware hack
- Demonstrates WHY software-controlled indicators are insufficient
- Directly motivates our hardware-only approach

### MicPro (ACM CCS 2023)
- Microphone-based voice privacy protection
- Software approach to privacy, not hardware indicator

### "Always On" (FPF 2016) — Stacey Gray
- Policy paper on privacy implications of always-on microphones
- Establishes the PROBLEM space, supports our patent's motivation

---

## 4. CHINESE PATENT LANDSCAPE

No directly relevant Chinese patents found matching our specific invention. Searched:
- CN201533437U — phantom power LED circuit (audio equipment, not privacy)
- CN209402729U — MEMS microphone packaging
- CN101902673B — microphone interface circuit
- CN107181992A — wireless microphone with smart control

The Chinese patent landscape appears to have a GAP in this specific area of hardware privacy indicators for microphones.

---

## 5. CLAIM BREADTH ASSESSMENT

### What is established prior art (CANNOT claim):
1. LED in series with IC power as operational indicator (US6307479, expired)
2. LED controlled by switch/transistor to indicate mic mute state (US11490248B2, Bose/Lutron)
3. Inverted-switch LED indicator for sensor disable (US11343274B2, Meta)
4. Software-controlled privacy LED via TEE/kernel (US10579820B2, US9317721B2)
5. Tamper-resistant LED with light sensor feedback (US20220094833A1, Apple)

### What appears to be NOVEL (our invention's unique space):
1. LED in direct electrical series on the sensor POWER TRACE (not in IC package)
2. NO active components in the indicator path — purely passive
3. LED indicates sensor is ACTIVE (not muted/private) — opposite polarity from Bose/Meta
4. Cannot be circumvented by software/firmware (unlike Apple iSight)
5. Current physically MUST flow through LED to reach sensor
6. On PCB trace level — layout-enforced, not firmware-enforced

### RECOMMENDED CLAIM STRATEGY:

#### Broadest Defensible Independent Claim (Claim 1):
"An electronic device comprising: a sensor requiring electrical power to operate; and a light-emitting element electrically connected in series with a power supply conductor of the sensor, wherein substantially all electrical current supplied to the sensor passes through the light-emitting element, and wherein the light-emitting element produces a visible indication whenever the sensor is receiving operating power, without requiring any active switching element, control circuit, or firmware to produce said visible indication."

#### Key Dependent Claims to Add:
- Claim 2: wherein the sensor is a MEMS microphone
- Claim 3: wherein the sensor is a camera module
- Claim 4: wherein the light-emitting element is an LED
- Claim 5: wherein the device is a wearable computing device
- Claim 6: wherein the power supply conductor is a PCB trace
- Claim 7: wherein the LED voltage drop is selected to remain within the sensor's operating voltage range
- Claim 8: wherein the visible indication is perceivable by persons other than the device user (bystander notification)
- Claim 9: wherein the device further comprises a wireless communication module
- Claim 10: wherein the series connection is the sole power path to the sensor (no bypass)
- Claim 11: method claim — "A method for providing a tamper-proof indication of sensor activity..."
- Claim 12: PCB layout claim — "A printed circuit board comprising a power trace to a sensor, wherein a light-emitting element is disposed in series on said power trace..."

#### WHY THIS SURVIVES EXAMINATION:

**Against Bose (US11490248B2)**: Our claim explicitly requires "without requiring any active switching element, control circuit, or firmware." Bose requires transistors Q1/Q3 and a control circuit pin. Completely different topology.

**Against Meta (US11343274B2)**: Our claim requires LED in SERIES on the SAME power conductor as the sensor. Meta uses SEPARATE power paths with inverted switches.

**Against US6307479 (Harvatek)**: Our claim is for an "electronic device" with a "sensor," not an IC package diagnostic. Different field of use, different purpose (privacy vs. diagnostics), different physical implementation (PCB trace vs. IC package internal).

**Against Apple (US20220094833)**: Apple requires active components (light sensor + transistor switches). Our claim explicitly excludes active components.

**Against all software approaches**: Our claim requires "without requiring any... firmware" — eliminates all TEE/kernel/software approaches.

#### SWEET SPOT RECOMMENDATION:

Go **broad on the circuit topology** (any sensor + any light-emitting element in series, no active components) but **narrow on the PURPOSE** (privacy/activity indication). This avoids US6307479 (diagnostics purpose) while covering:
- Microphones on wearables
- Cameras on laptops/phones
- Any sensor on any IoT device
- Future sensor types

The commercially valuable claims are:
1. The broad "passive series indicator for sensor activity" claim
2. The specific "MEMS mic + LED on PCB trace for wearable" claim
3. The method claim for "tamper-proof sensor activity indication"
4. The PCB layout claim

---

## 6. RISKS AND RECOMMENDATIONS

### Potential Examiner Objections:
1. **Obviousness (35 USC 103)**: Examiner could combine US6307479 (LED in series with IC) + any privacy paper to argue it's obvious. Counter: US6307479 is for IC diagnostics inside a package, and NO ONE in 25+ years has applied this to sensor privacy indication on a PCB, despite the well-documented need (TickTock, iSeeYou, KIMYA all identify the problem).

2. **Prior art from Apple iSight**: Apple's design shares the same power signal but is firmware-controlled (proven hackable by iSeeYou). Our design is fundamentally different: direct electrical series, no firmware involvement.

3. **Voltage drop concern**: Examiner may question whether LED voltage drop affects sensor operation. Include data showing MEMS mic VDD range (1.6-3.6V typical) and LED forward voltage (1.8-2.2V for red) are compatible with 3.3V supply.

### Strategic Recommendations:
1. **File a provisional ASAP** — the prior art field is getting crowded (Bose 2017, Meta 2018, Apple 2022)
2. **Include international claims** — Chinese patent landscape has a clear gap
3. **Include both device and method claims**
4. **Include PCB layout claims** — this is a unique claim type that none of the prior art touches
5. **Reference iSeeYou paper** in the specification to establish why firmware-controlled indicators are insufficient
6. **Reference TickTock paper** to establish the unmet need for hardware-guaranteed indicators
