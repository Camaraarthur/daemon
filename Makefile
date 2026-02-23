.PHONY: all install lint test dft netlist simulate layout clean

PYTHON := python3
VENV   := .venv
PIP    := $(VENV)/bin/pip
PY     := $(VENV)/bin/python
PYTEST := $(VENV)/bin/pytest
RUFF   := $(VENV)/bin/ruff

# ── Environment ──────────────────────────────────────────────────────────────

install:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e ".[dev]"

# ── Code quality ─────────────────────────────────────────────────────────────

lint:
	$(RUFF) check .
	$(RUFF) format --check .

format:
	$(RUFF) format .

# ── Pipeline phases ──────────────────────────────────────────────────────────

## Phase 1 – DFT: emit test-point report for IP5306
dft:
	$(PY) -m dft.ip5306_testpoints

## Phase 2 – SKiDL: generate KiCad netlist for the audio subsystem
netlist:
	$(PY) -m netlist.audio_subsystem

## Phase 3 – PySpice: run transient power assertions
simulate:
	$(PY) -m simulation.power_transients

## Phase 4 – Layout: inject differential-pair constraints into .kicad_pcb
##            Requires KiCad's pcbnew Python module on PYTHONPATH
layout:
	$(PY) -m layout.configure_constraints daemon_v0_layout.kicad_pcb
	$(PY) -m layout.freerouting_dsn daemon_v0_layout.dsn

# ── Full pipeline (CI entry-point) ───────────────────────────────────────────

all: lint dft netlist simulate
	@echo "✓ Daemon V0 hardware CI pipeline passed."

# ── Tests ─────────────────────────────────────────────────────────────────────

test:
	$(PYTEST) --cov=. --cov-report=term-missing

# ── Housekeeping ──────────────────────────────────────────────────────────────

clean:
	rm -rf $(VENV) __pycache__ **/__pycache__ *.net *.ses *.dsn .coverage htmlcov
