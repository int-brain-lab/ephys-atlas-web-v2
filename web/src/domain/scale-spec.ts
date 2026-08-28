import type { ColorScale } from './types.js';

/** Release-owned scale specifications shared by every scalar presentation. */
export interface LinearScaleSpec {
  readonly kind: 'linear';
}

export interface LogScaleSpec {
  readonly kind: 'log';
}

export interface SymlogScaleSpec {
  readonly kind: 'symlog';
  /** Release-owned linear transition in raw feature units. */
  readonly linearThreshold: number;
}

export type ScaleSpec = LinearScaleSpec | LogScaleSpec | SymlogScaleSpec;
export type ScaleDomain = readonly [number, number];

const LINEAR: LinearScaleSpec = { kind: 'linear' };
const LOG: LogScaleSpec = { kind: 'log' };

export function scaleSpec(scale: ColorScale, symlogThreshold?: number): ScaleSpec {
  if (scale === 'linear') return LINEAR;
  if (scale === 'log') return LOG;
  if (!(Number.isFinite(symlogThreshold) && (symlogThreshold ?? 0) > 0)) {
    throw new Error('Signed-log scale requires a finite positive release-owned threshold');
  }
  return { kind: 'symlog', linearThreshold: symlogThreshold! };
}

export function scaleKind(scale: ScaleSpec | ColorScale): ColorScale {
  return typeof scale === 'string' ? scale : scale.kind;
}

/** A logarithmic domain and its values must be strictly positive. */
export function scaleValueIsValid(value: number, scale: ScaleSpec | ColorScale): boolean {
  if (!Number.isFinite(value)) return false;
  if (scaleKind(scale) === 'log') return value > 0;
  return scaleKind(scale) !== 'symlog'
    || (typeof scale !== 'string' && scale.kind === 'symlog'
      && Number.isFinite(scale.linearThreshold) && scale.linearThreshold > 0);
}

export function scaleDomainIsValid(domain: ScaleDomain, scale: ScaleSpec | ColorScale): boolean {
  return Number.isFinite(domain[0])
    && Number.isFinite(domain[1])
    && domain[1] > domain[0]
    && scaleValueIsValid(domain[0], scale);
}

/** Maps a raw value onto the selected presentation axis. */
export function scaleForward(value: number, scale: ScaleSpec | ColorScale): number | null {
  if (!scaleValueIsValid(value, scale)) return null;
  if (scaleKind(scale) === 'log') return Math.log(value);
  if (scaleKind(scale) === 'symlog') {
    const threshold = (scale as SymlogScaleSpec).linearThreshold;
    return Math.sign(value) * Math.log1p(Math.abs(value) / threshold);
  }
  return value;
}

/** Maps a selected presentation-axis value back to the raw value. */
export function scaleInverse(value: number, scale: ScaleSpec | ColorScale): number {
  if (scaleKind(scale) === 'log') return Math.exp(value);
  if (scaleKind(scale) === 'symlog') {
    if (typeof scale === 'string' || scale.kind !== 'symlog') throw new Error('Signed-log inverse requires its release-owned threshold');
    return Math.sign(value) * scale.linearThreshold * Math.expm1(Math.abs(value));
  }
  return value;
}

/**
 * Normalizes a raw value within a raw-value domain.  It deliberately does not
 * clamp: color mappers and interactive controls own their existing clipping
 * policies, while sharing the exact transform and validity rules.
 */
export function scaleNormalize(
  value: number,
  domain: ScaleDomain,
  scale: ScaleSpec | ColorScale,
): number | null {
  if (!scaleDomainIsValid(domain, scale)) return null;
  const transformedValue = scaleForward(value, scale);
  const start = scaleForward(domain[0], scale);
  const end = scaleForward(domain[1], scale);
  if (transformedValue === null || start === null || end === null) return null;
  const span = end - start;
  return span > 0 ? (transformedValue - start) / span : null;
}

/** Inverts a normalized presentation-axis position into the raw domain. */
export function scaleDenormalize(
  position: number,
  domain: ScaleDomain,
  scale: ScaleSpec | ColorScale,
): number | null {
  if (!scaleDomainIsValid(domain, scale)) return null;
  const start = scaleForward(domain[0], scale);
  const end = scaleForward(domain[1], scale);
  if (start === null || end === null) return null;
  return scaleInverse(start + position * (end - start), scale);
}

export function clampScalePosition(position: number): number {
  return Math.max(0, Math.min(1, position));
}
