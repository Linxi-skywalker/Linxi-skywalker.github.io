# Counterfactual Optimizer Forks Implementation Plan

> **For agentic workers:** Required sub-skill: implement the tasks in order and review each deliverable before moving on.

**Goal:** Add an interactive four-way Momentum continuation comparison from a clicked recorded iteration.

**Architecture:** The engine stores immutable optimizer-state snapshots at each base trajectory point and exposes a continuation routine. The plotting module owns an optional set of branch traces and a selected fork marker. The app handles path clicks, adjustable branch parameters, result summaries, and invalidation when the underlying objective or shared experiment parameters change.

**Tech Stack:** Existing browser JavaScript modules, Plotly 3.1.0, HTML, CSS. No new dependencies.

## Global Constraints

- Start every branch at the exact selected recorded coordinate and continue only through the remaining original iteration budget.
- Keep the base experiment unchanged and visible as a reference.
- Apply updated Momentum μ from the fork onward while carrying the pre-fork velocity state.
- Initialize Adam moments to zero when switching methods; use the selected β₁ and β₂.
- Draw every branch on the 3D view, top-down view, and loss-by-iteration chart.
- Preserve existing optimizer controls, plot trace indices, and responsive styling.
- Do not add or run tests unless the user asks for testing or verification; run syntax and diff checks before completion.

---

### Task 1: Capture and restore optimizer state

**Files:**
- Modify `public/optimizer-atlas/engine.js`

- [ ] Define a cloneable optimizer-state shape for Momentum, Adam, and RMSprop.
- [ ] Store a snapshot on the initial point and each valid point produced by `simulate`.
- [ ] Add a continuation function that accepts method, config, start point, state snapshot, and remaining iteration count.
- [ ] Preserve divergence guards and absolute timeline indices in continuation points.
- [ ] Verify source syntax and inspect the resulting state/step conventions.

### Task 2: Render selected fork and branch traces

**Files:**
- Modify `public/optimizer-atlas/plots.js`

- [ ] Add a path-click callback that only accepts the original Momentum trace and reports clicked coordinates.
- [ ] Map the click to an actual base-run point in the app.
- [ ] Add setter/clearer APIs for the fork marker and four branch runs.
- [ ] Append branch traces after existing traces so the existing `updateStep` trace indices remain stable.
- [ ] Add branches to 3D, top-down, and loss plots with distinct colors and hover labels.
- [ ] Keep the original trajectories unchanged.

### Task 3: Add the branch panel and live controls

**Files:**
- Modify `public/optimizer-atlas/index.html`
- Modify `public/optimizer-atlas/app.js`
- Modify `public/optimizer-atlas/styles.css`

- [ ] Add a compact inline panel with selected step/coordinate, μ, β₁, β₂ controls, four branch outcomes, and a clear action.
- [ ] Generate four branches on path selection and regenerate when any branch-only parameter changes.
- [ ] Keep the base experiment parameters untouched by branch controls.
- [ ] Clear stale branches if the objective, start, learning rate, optimizer parameters, or iteration budget changes.
- [ ] Use matching method colors/labels across the panel and plot traces; keep the panel responsive and keyboard accessible.

### Task 4: Verify and deploy

**Files:**
- Inspect `public/optimizer-atlas/app.js`, `engine.js`, `plots.js`, `index.html`, and `styles.css`.

- [ ] Run JavaScript syntax checks and `git diff --check`.
- [ ] Confirm the existing trace indices consumed by `updateStep` remain unchanged.
- [ ] Commit and push the implementation to the existing GitHub Pages branch.
