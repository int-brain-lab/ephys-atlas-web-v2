# Encoding and comparison UX

Status: accepted

## Settings panel

Display and interpretation settings use a collapsible right-side panel, typically about 280–340 px wide on desktop. Closing it returns the space to the scientific workspace. Region navigation and selection remain conceptually separate from display settings.

Scientific object selection lives in the persistent context header rather than
being duplicated in this panel. Settings distinguish summary interpretation
from visual encoding:

- Statistic is visually prominent at the top; representation and parcellation remain in the header context picker.
- Color controls form a distinct section containing colormap, value range, scale/transform, and related display parameters.
- Less common controls may be collapsible without hiding important non-default state.

## Color range control

The primary range editor combines a compact histogram with two draggable range handles and precise numeric fields.

- The histogram provides context for clipping and saturation decisions.
- Both endpoints are editable numerically.
- A reset action restores the feature default.
- Robust-range presets such as full range, 1–99%, or 5–95% may be provided when their semantics are well defined.
- Keyboard operation is required.

## Region-list value encoding

Each region row combines an exact value with a compact graphical encoding on a common scale.

- Use a short horizontal bar or equivalent aligned position/length encoding.
- Apply the current feature colormap while preserving text and selection contrast.
- Sequential quantities use a shared baseline; diverging quantities use a meaningful center such as zero when appropriate.
- Exact formatted values remain visible.
- Missing values are explicit and never treated as zero.

The default ordering is anatomical, with immediate switching among `Anatomy`, `Value ↑`, and `Value ↓`. Search/filtering does not silently change the active ordering.

## Selection identity colors

Persistently selected regions receive stable categorical identity colors independent of the feature colormap.

- Reuse identity colors across slice outlines, selected-region rows, histogram markers, and comparison plots.
- Do not replace scalar feature fills.
- Use a color-vision-deficiency-aware palette and avoid relying on hue alone for larger selections.
- Keep assignment stable for the lifetime of a selection.

## Default comparison visualization

The expanded comparison workspace uses aligned small-multiple distributions as the primary visualization.

- Selected regions share the same quantitative x-axis.
- Each selected region receives its own aligned row/panel using its stable categorical identity.
- Mean, median, quartiles, or similar descriptive markers may be overlaid when available and scientifically appropriate.
- A compact aligned table provides descriptive values such as `n`, mean, median, standard deviation, and range according to dataset availability.
- Violin or box representations may exist as alternatives but are not the primary launch layout.

Rationale: aligned distributions compare location, spread, skew, and multimodality more directly than separated violins while scaling better to several selected regions.
