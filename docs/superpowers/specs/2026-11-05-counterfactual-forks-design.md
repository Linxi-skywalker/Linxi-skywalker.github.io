# Counterfactual Optimizer Forks

## Goal

Let a learner click a point on the original Momentum trajectory and compare four valid continuations from that exact iteration.

## Interaction

- Clicking the original Momentum path selects its nearest recorded iteration and reveals the branch panel.
- Four continuations are generated together from the selected position: keep Momentum state and coefficient; reset velocity and continue Momentum; preserve velocity while changing the Momentum coefficient (default 0.5); switch to Adam with fresh Adam moments and adjustable beta values.
- The Momentum coefficient, Adam beta1, and Adam beta2 controls recompute the four branches immediately.
- Every continuation uses the same objective, learning rate, and original iteration budget. It runs only for the steps remaining after the selected point.
- The original four optimizer paths remain visible as references. The selected fork point is marked on the terrain.
- Branches appear together on 3D surface, top-down contour, and loss-by-iteration plots. Each has a distinct color and label, with final loss and nearest known minimum summarized in the panel.
- A branch that diverges stops at its last valid point and is reported as divergent.
- Clearing the branch comparison removes the branch traces and selection marker without changing the original experiment.

## State semantics

Each original Momentum point stores its optimizer state snapshot. The unchanged continuation restores that exact snapshot. Reset-velocity starts from the same coordinates with velocity zero. Adjusted-momentum keeps the stored velocity but applies the new coefficient beginning with the next update. Adam switch starts its first- and second-moment estimates at zero and uses the chosen beta values.

## Visual direction

Use a compact inline branch panel in the existing mist-blue and violet interface. The clicked step and coordinates appear first; three parameter controls follow; four restrained, color-distinct result rows map directly to the four overlay paths. Do not add dependencies or replace the Plotly rendering stack.

## Scope

This feature branches from the original Momentum path only. It does not mutate the base run, change the shared learning rate, or branch recursively from an already-created counterfactual.
