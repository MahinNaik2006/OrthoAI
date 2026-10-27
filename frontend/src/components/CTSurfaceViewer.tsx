import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Bone, Crosshair, Focus, RotateCcw, Ruler, Trash2, Wrench } from 'lucide-react';
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Quaternion, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CTSurface, CTSurfacePart } from '../services/api';

type Vec3 = [number, number, number];

type SubMesh = {
  id: string;
  name: string;
  color: string;
  vertices: number[];
  faces: number[];
  vertexCount: number;
};

type Measurement = {
  id: string;
  a: Vec3;
  b: Vec3;
  lengthScene: number;
  lengthMm: number | null;
};

type FragmentMetrics = {
  source: 'cnn' | 'geometric';
  center: Vec3;
  axis: Vec3;
  radial: Vec3;
  forward: Vec3;
  radius: number;
  closestOnMain: Vec3;
  closestOnFragment: Vec3;
  gapScene: number;
  gapMm: number | null;
  showGap: boolean;
  fragmentWidthScene: number;
  fragmentLengthScene: number;
  fragmentDepthScene: number;
  fragmentWidthMm: number | null;
  fragmentLengthMm: number | null;
  fragmentDepthMm: number | null;
  boneLengthScene: number;
  boneLengthMm: number | null;
  plateCenter: Vec3;
  plateWidth: number;
  plateLength: number;
  plateThickness: number;
  screwRadius: number;
  headRadius: number;
  screws: { center: Vec3; head: Vec3; length: number }[];
  obbCenter: Vec3;
  obbLabel: Vec3;
  gapLineA: Vec3;
  gapLineB: Vec3;
  gapTickA1: Vec3;
  gapTickA2: Vec3;
  gapTickB1: Vec3;
  gapTickB2: Vec3;
  gapLabel: Vec3;
  boneLineA: Vec3;
  boneLineB: Vec3;
  boneTickA1: Vec3;
  boneTickA2: Vec3;
  boneTickB1: Vec3;
  boneTickB2: Vec3;
  boneLabel: Vec3;
  viewPosition: Vec3;
  fragmentVertexCount: number;
};

type SurfaceAnalysis = {
  baseMeshes: SubMesh[];
  redMeshes: SubMesh[];
  metrics: FragmentMetrics | null;
  meshScale: number | null;
  detectedByCnn: boolean;
  detectedFromGeometry: boolean;
};

const FRACTURE_COLOR = '#ff3b52';
const FRACTURE_GLOW = '#8f1024';
const MEASURE_COLOR = '#8ef0ff';
const PENDING_COLOR = '#ffd166';

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const magnitude = length(a);
  return magnitude > 1e-8 ? scale(a, 1 / magnitude) : [0, 0, 1];
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toVector3(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

function formatLength(mm: number | null, scene: number, digits = 1): string {
  return mm === null ? `${scene.toFixed(2)} u` : `${mm.toFixed(digits)} mm`;
}

function boundsOf(vertices: number[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < vertices.length; index += 3) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  }
  return { min, max };
}

function boxGap(a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }): number {
  const x = Math.max(0, Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0]));
  const y = Math.max(0, Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1]));
  const z = Math.max(0, Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2]));
  return Math.hypot(x, y, z);
}

function centroid(vertices: number[]): Vec3 {
  if (!vertices.length) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (let index = 0; index < vertices.length; index += 3) {
    x += vertices[index];
    y += vertices[index + 1];
    z += vertices[index + 2];
    count += 1;
  }
  return [x / count, y / count, z / count];
}

function samplePoints(vertices: number[], maxCount: number): Vec3[] {
  const count = vertices.length / 3;
  const stride = Math.max(1, Math.ceil(count / maxCount));
  const points: Vec3[] = [];
  for (let index = 0; index < count; index += stride) {
    points.push([vertices[index * 3], vertices[index * 3 + 1], vertices[index * 3 + 2]]);
  }
  return points;
}

function closestPair(
  mainVertices: number[],
  fragmentVertices: number[],
): { main: Vec3; fragment: Vec3; distance: number } {
  const mainPoints = samplePoints(mainVertices, 420);
  const fragmentPoints = samplePoints(fragmentVertices, 420);
  let bestMain: Vec3 = [0, 0, 0];
  let bestFragment: Vec3 = [0, 0, 0];
  let bestDistance = Infinity;
  for (const mainPoint of mainPoints) {
    for (const fragmentPoint of fragmentPoints) {
      const distance = Math.hypot(
        mainPoint[0] - fragmentPoint[0],
        mainPoint[1] - fragmentPoint[1],
        mainPoint[2] - fragmentPoint[2],
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMain = mainPoint;
        bestFragment = fragmentPoint;
      }
    }
  }
  return { main: bestMain, fragment: bestFragment, distance: bestDistance };
}

function principalAxis(vertices: number[]): Vec3 {
  const points = samplePoints(vertices, 900);
  if (!points.length) return [0, 0, 1];
  const mean = points.reduce<Vec3>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
    [0, 0, 0],
  );
  const count = points.length;
  const center: Vec3 = [mean[0] / count, mean[1] / count, mean[2] / count];
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  points.forEach((point) => {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    covariance[0][0] += dx * dx;
    covariance[0][1] += dx * dy;
    covariance[0][2] += dx * dz;
    covariance[1][1] += dy * dy;
    covariance[1][2] += dy * dz;
    covariance[2][2] += dz * dz;
  });
  covariance[1][0] = covariance[0][1];
  covariance[2][0] = covariance[0][2];
  covariance[2][1] = covariance[1][2];

  let axis: Vec3 = normalize([1, 1, 1]);
  for (let iteration = 0; iteration < 18; iteration += 1) {
    const next: Vec3 = [
      covariance[0][0] * axis[0] + covariance[0][1] * axis[1] + covariance[0][2] * axis[2],
      covariance[1][0] * axis[0] + covariance[1][1] * axis[1] + covariance[1][2] * axis[2],
      covariance[2][0] * axis[0] + covariance[2][1] * axis[1] + covariance[2][2] * axis[2],
    ];
    if (length(next) < 1e-8) break;
    axis = normalize(next);
  }
  return axis;
}

function splitComponents(part: CTSurfacePart): SubMesh[] {
  const vertexCount = Math.floor(part.vertices.length / 3);
  if (!vertexCount) return [];
  const parent = new Int32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) parent[index] = index;

  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    let current = value;
    while (parent[current] !== current) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };

  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  for (let index = 0; index < part.faces.length; index += 3) {
    union(part.faces[index], part.faces[index + 1]);
    union(part.faces[index + 1], part.faces[index + 2]);
  }

  const groups = new Map<number, number[]>();
  for (let index = 0; index < vertexCount; index += 1) {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  }

  const groupsBySize = [...groups.values()].sort((left, right) => right.length - left.length);
  const vertexGroup = new Int32Array(vertexCount);
  groupsBySize.forEach((indices, groupIndex) => {
    indices.forEach((vertexIndex) => {
      vertexGroup[vertexIndex] = groupIndex;
    });
  });
  const groupFaces: number[][] = groupsBySize.map(() => []);
  for (let index = 0; index < part.faces.length; index += 3) {
    groupFaces[vertexGroup[part.faces[index]]].push(
      part.faces[index],
      part.faces[index + 1],
      part.faces[index + 2],
    );
  }

  const subMeshes: SubMesh[] = [];
  groupsBySize.forEach((indices, groupIndex) => {
    const faces = groupFaces[groupIndex];
    if (!faces.length) return;
    const remap = new Map<number, number>();
    indices.forEach((vertexIndex, nextIndex) => remap.set(vertexIndex, nextIndex));
    const vertices: number[] = [];
    indices.forEach((vertexIndex) => {
      vertices.push(
        part.vertices[vertexIndex * 3],
        part.vertices[vertexIndex * 3 + 1],
        part.vertices[vertexIndex * 3 + 2],
      );
    });
    const remappedFaces: number[] = [];
    for (let index = 0; index < faces.length; index += 3) {
      remappedFaces.push(
        remap.get(faces[index]) ?? 0,
        remap.get(faces[index + 1]) ?? 0,
        remap.get(faces[index + 2]) ?? 0,
      );
    }
    subMeshes.push({
      id: `${part.name}-${groupIndex}`,
      name: part.name,
      color: part.color,
      vertices,
      faces: remappedFaces,
      vertexCount: indices.length,
    });
  });
  return subMeshes;
}

function partToMesh(part: CTSurfacePart, id: string): SubMesh {
  return {
    id,
    name: part.name,
    color: part.color,
    vertices: part.vertices,
    faces: part.faces,
    vertexCount: Math.floor(part.vertices.length / 3),
  };
}

function buildMetrics(
  fragmentVertices: number[],
  referenceVertices: number[],
  boneVertices: number[],
  meshScale: number | null,
  source: 'cnn' | 'geometric',
): FragmentMetrics | null {
  if (fragmentVertices.length < 3 || referenceVertices.length < 3 || boneVertices.length < 3) {
    return null;
  }
  const fragmentCenter = centroid(fragmentVertices);
  const referenceCenter = centroid(referenceVertices);
  const boneCenter = centroid(boneVertices);
  let axis = principalAxis(boneVertices);
  const towardFragment = sub(fragmentCenter, referenceCenter);
  if (dot(axis, towardFragment) < 0) axis = scale(axis, -1);

  const closest = closestPair(referenceVertices, fragmentVertices);
  const gapScene = Number.isFinite(closest.distance) ? closest.distance : 0;
  const center = midpoint(closest.main, closest.fragment);
  const toFracture = sub(center, boneCenter);
  let radial = sub(toFracture, scale(axis, dot(toFracture, axis)));
  if (length(radial) < 1e-4) {
    const fallback = Math.abs(dot(axis, [0, 1, 0])) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    radial = normalize(cross(axis, fallback as Vec3));
  } else {
    radial = normalize(radial);
  }
  const forward = normalize(cross(axis, radial));

  const band = Math.max(gapScene * 1.2, 0.2);
  let radius = 0;
  let supportRadius = 0;
  const boneStride = Math.max(1, Math.ceil(boneVertices.length / 3 / 1400));
  for (let index = 0; index < boneVertices.length; index += 3 * boneStride) {
    const point: Vec3 = [boneVertices[index], boneVertices[index + 1], boneVertices[index + 2]];
    const relativeToFracture = sub(point, center);
    if (Math.abs(dot(relativeToFracture, axis)) > band) continue;
    const relativeToBone = sub(point, boneCenter);
    const perpendicular = sub(relativeToBone, scale(axis, dot(relativeToBone, axis)));
    radius = Math.max(radius, length(perpendicular));
    supportRadius = Math.max(supportRadius, dot(relativeToBone, radial));
  }
  if (radius < 0.05) radius = Math.max(gapScene * 0.5, 0.08);
  if (supportRadius < 0.05) supportRadius = radius;

  const plateWidth = clamp(radius * 1.55, 0.14, 0.62);
  const plateThickness = clamp(plateWidth * 0.14, 0.025, 0.09);
  const overlap = Math.max(radius * 0.9, plateWidth * 0.5);
  const plateLength = gapScene + overlap * 2;
  const axialCenter = add(boneCenter, scale(axis, dot(sub(center, boneCenter), axis)));
  const plateCenter = add(axialCenter, scale(radial, supportRadius + plateThickness / 2));
  const screwDistances = [
    -(gapScene / 2 + overlap * 0.8),
    -(gapScene / 2 + overlap * 0.35),
    gapScene / 2 + overlap * 0.35,
    gapScene / 2 + overlap * 0.8,
  ];
  const screwLength = Math.max(radius * 1.4, 0.2);
  const screwRadius = clamp(plateWidth * 0.045, 0.006, 0.018);
  const headRadius = screwRadius * 2.1;
  const screws = screwDistances.map((distance) => {
    const platePoint = add(plateCenter, scale(axis, distance));
    return {
      center: add(platePoint, scale(radial, plateThickness / 2 - screwLength / 2)),
      head: add(platePoint, scale(radial, plateThickness * 0.75)),
      length: screwLength,
    };
  });

  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minSide = Infinity;
  let maxSide = -Infinity;
  let minForward = Infinity;
  let maxForward = -Infinity;
  for (let index = 0; index < fragmentVertices.length; index += 3) {
    const point: Vec3 = [
      fragmentVertices[index],
      fragmentVertices[index + 1],
      fragmentVertices[index + 2],
    ];
    const relative = sub(point, boneCenter);
    const along = dot(relative, axis);
    const side = dot(relative, radial);
    const ahead = dot(relative, forward);
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minSide = Math.min(minSide, side);
    maxSide = Math.max(maxSide, side);
    minForward = Math.min(minForward, ahead);
    maxForward = Math.max(maxForward, ahead);
  }
  const fragmentLengthScene = Math.max(0, maxAlong - minAlong);
  const fragmentDepthScene = Math.max(0, maxSide - minSide);
  const fragmentWidthScene = Math.max(0, maxForward - minForward);
  const obbCenter = add(
    boneCenter,
    add(
      scale(axis, (minAlong + maxAlong) / 2),
      add(
        scale(radial, (minSide + maxSide) / 2),
        scale(forward, (minForward + maxForward) / 2),
      ),
    ),
  );

  let boneMin = Infinity;
  let boneMax = -Infinity;
  for (let index = 0; index < boneVertices.length; index += 3) {
    const point: Vec3 = [boneVertices[index], boneVertices[index + 1], boneVertices[index + 2]];
    const along = dot(sub(point, boneCenter), axis);
    boneMin = Math.min(boneMin, along);
    boneMax = Math.max(boneMax, along);
  }
  const boneLengthScene = Math.max(0, boneMax - boneMin);

  const dimensionOffset = Math.max(plateWidth * 1.5, radius + plateThickness + 0.14);
  const tickHalf = Math.max(plateWidth * 0.18, 0.03);
  const gapLineA = add(closest.main, scale(radial, dimensionOffset));
  const gapLineB = add(closest.fragment, scale(radial, dimensionOffset));
  const gapLabel = add(
    midpoint(gapLineA, gapLineB),
    scale(forward, Math.max(plateWidth * 0.34, 0.08)),
  );

  const boneOffset = radius * 2 + plateWidth * 0.9;
  const boneStart = add(boneCenter, scale(axis, boneMin));
  const boneEnd = add(boneCenter, scale(axis, boneMax));
  const boneLineA = add(boneStart, scale(radial, boneOffset));
  const boneLineB = add(boneEnd, scale(radial, boneOffset));
  const boneLabel = add(
    midpoint(boneLineA, boneLineB),
    scale(forward, Math.max(plateWidth * 0.3, 0.08)),
  );

  return {
    source,
    center,
    axis,
    radial,
    forward,
    radius,
    closestOnMain: closest.main,
    closestOnFragment: closest.fragment,
    gapScene,
    gapMm: meshScale ? gapScene / meshScale : null,
    showGap: gapScene > 0.02,
    fragmentWidthScene,
    fragmentLengthScene,
    fragmentDepthScene,
    fragmentWidthMm: meshScale ? fragmentWidthScene / meshScale : null,
    fragmentLengthMm: meshScale ? fragmentLengthScene / meshScale : null,
    fragmentDepthMm: meshScale ? fragmentDepthScene / meshScale : null,
    boneLengthScene,
    boneLengthMm: meshScale ? boneLengthScene / meshScale : null,
    plateCenter,
    plateWidth,
    plateLength,
    plateThickness,
    screwRadius,
    headRadius,
    screws,
    obbCenter,
    obbLabel: add(obbCenter, scale(axis, fragmentLengthScene / 2 + 0.1)),
    gapLineA,
    gapLineB,
    gapTickA1: add(gapLineA, scale(forward, tickHalf)),
    gapTickA2: add(gapLineA, scale(forward, -tickHalf)),
    gapTickB1: add(gapLineB, scale(forward, tickHalf)),
    gapTickB2: add(gapLineB, scale(forward, -tickHalf)),
    gapLabel,
    boneLineA,
    boneLineB,
    boneTickA1: add(boneLineA, scale(forward, tickHalf)),
    boneTickA2: add(boneLineA, scale(forward, -tickHalf)),
    boneTickB1: add(boneLineB, scale(forward, tickHalf)),
    boneTickB2: add(boneLineB, scale(forward, -tickHalf)),
    boneLabel,
    viewPosition: add(center, add(scale(radial, 2.6), add(scale(forward, 1.5), scale(axis, 0.7)))),
    fragmentVertexCount: Math.floor(fragmentVertices.length / 3),
  };
}

function analyzeSurface(surface: CTSurface): SurfaceAnalysis {
  const meshScale = surface.mesh_scale && surface.mesh_scale > 0 ? surface.mesh_scale : null;
  const cnnPart = surface.fracture_part;

  if (surface.source === 'intensity_isosurface') {
    const baseMeshes = [
      {
        id: 'intensity-surface',
        name: 'CT intensity surface',
        color: '#dce5ef',
        vertices: surface.vertices,
        faces: surface.faces,
        vertexCount: Math.floor(surface.vertices.length / 3),
      },
    ];
    const redMeshes = cnnPart
      ? [{ ...partToMesh(cnnPart, 'cnn-fracture'), color: cnnPart.color || FRACTURE_COLOR }]
      : [];
    const metrics = cnnPart
      ? buildMetrics(cnnPart.vertices, surface.vertices, surface.vertices, meshScale, 'cnn')
      : null;
    return {
      baseMeshes,
      redMeshes,
      metrics,
      meshScale,
      detectedByCnn: Boolean(cnnPart),
      detectedFromGeometry: false,
    };
  }

  if (cnnPart) {
    const allVertices = surface.parts.flatMap((part) => part.vertices);
    return {
      baseMeshes: surface.parts.map((part, index) => partToMesh(part, `anatomy-${index}`)),
      redMeshes: [{ ...partToMesh(cnnPart, 'cnn-fracture'), color: cnnPart.color || FRACTURE_COLOR }],
      metrics: buildMetrics(cnnPart.vertices, allVertices, allVertices, meshScale, 'cnn'),
      meshScale,
      detectedByCnn: true,
      detectedFromGeometry: false,
    };
  }

  const baseMeshes: SubMesh[] = [];
  const candidates: { mesh: SubMesh; main: SubMesh }[] = [];
  surface.parts.forEach((part) => {
    const components = splitComponents(part);
    if (!components.length) return;
    if (components.length > 3) {
      components.forEach((component) => baseMeshes.push(component));
      return;
    }
    const main = components[0];
    const mainBounds = boundsOf(main.vertices);
    const mainDiagonal = Math.hypot(
      mainBounds.max[0] - mainBounds.min[0],
      mainBounds.max[1] - mainBounds.min[1],
      mainBounds.max[2] - mainBounds.min[2],
    );
    components.forEach((component) => {
      if (component === main) {
        baseMeshes.push(main);
        return;
      }
      const componentBounds = boundsOf(component.vertices);
      const fragmentDiagonal = Math.hypot(
        componentBounds.max[0] - componentBounds.min[0],
        componentBounds.max[1] - componentBounds.min[1],
        componentBounds.max[2] - componentBounds.min[2],
      );
      const ratio = component.vertexCount / Math.max(1, main.vertexCount);
      const proximity = boxGap(componentBounds, mainBounds);
      const isCandidate = (
        ratio >= 0.02
        && ratio <= 0.4
        && fragmentDiagonal <= mainDiagonal * 0.75
        && proximity <= mainDiagonal * 0.3
      );
      if (isCandidate) {
        candidates.push({
          mesh: { ...component, color: FRACTURE_COLOR },
          main,
        });
      } else {
        baseMeshes.push(component);
      }
    });
  });

  candidates.sort((left, right) => right.mesh.vertexCount - left.mesh.vertexCount);
  const primary = candidates[0];
  const metrics = primary
    ? buildMetrics(
      primary.mesh.vertices,
      primary.main.vertices,
      primary.main.vertices.concat(primary.mesh.vertices),
      meshScale,
      'geometric',
    )
    : null;

  return {
    baseMeshes,
    redMeshes: candidates.map((candidate) => candidate.mesh),
    metrics,
    meshScale,
    detectedByCnn: false,
    detectedFromGeometry: candidates.length > 0,
  };
}

function SurfaceMesh({
  vertices,
  faces,
  color,
  overlay = false,
  fragment = false,
  onPointerDown,
}: {
  vertices: number[];
  faces: number[];
  color: string;
  overlay?: boolean;
  fragment?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const mesh = new BufferGeometry();
    mesh.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    mesh.setIndex(new BufferAttribute(new Uint32Array(faces), 1));
    mesh.computeVertexNormals();
    return mesh;
  }, [vertices, faces]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} renderOrder={overlay ? 2 : 1} onPointerDown={onPointerDown}>
      <meshStandardMaterial
        color={color}
        roughness={fragment ? 0.55 : 0.72}
        metalness={fragment ? 0.08 : 0.04}
        emissive={fragment ? FRACTURE_GLOW : '#000000'}
        emissiveIntensity={fragment ? 0.5 : 0}
        side={DoubleSide}
        polygonOffset={overlay}
        polygonOffsetFactor={overlay ? -2 : 0}
      />
    </mesh>
  );
}

function FixationPreview({ metrics }: { metrics: FragmentMetrics }) {
  const plateBasis = useMemo(
    () => new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        toVector3(metrics.forward),
        toVector3(metrics.axis),
        toVector3(metrics.radial),
      ),
    ),
    [metrics],
  );
  const screwRotation = useMemo(
    () => new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      toVector3(metrics.radial),
    ),
    [metrics],
  );

  return (
    <group>
      <mesh position={metrics.plateCenter} quaternion={plateBasis}>
        <boxGeometry args={[metrics.plateWidth, metrics.plateLength, metrics.plateThickness]} />
        <meshStandardMaterial color="#8db3cf" metalness={0.88} roughness={0.26} />
      </mesh>
      {metrics.screws.map((screw, index) => (
        <group key={index}>
          <mesh position={screw.center} quaternion={screwRotation}>
            <cylinderGeometry args={[metrics.screwRadius, metrics.screwRadius, screw.length, 12]} />
            <meshStandardMaterial color="#dbe6f2" metalness={0.95} roughness={0.18} />
          </mesh>
          <mesh position={screw.head} quaternion={screwRotation}>
            <cylinderGeometry
              args={[metrics.headRadius, metrics.headRadius, metrics.plateThickness * 0.55, 14]}
            />
            <meshStandardMaterial color="#eef6ff" metalness={0.95} roughness={0.16} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function FractureAnnotations({ metrics }: { metrics: FragmentMetrics }) {
  const labelClass = 'ct-3d-label';
  const dimensionClass = 'ct-3d-label ct-3d-label-alert';
  const obbBasis = useMemo(
    () => new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(
        toVector3(metrics.forward),
        toVector3(metrics.axis),
        toVector3(metrics.radial),
      ),
    ),
    [metrics],
  );

  return (
    <group>
      {metrics.showGap ? (
        <group>
          <Line points={[metrics.gapLineA, metrics.gapLineB]} color="#ff9aa8" lineWidth={1.6} />
          <Line points={[metrics.gapTickA1, metrics.gapTickA2]} color="#ff9aa8" lineWidth={1.2} />
          <Line points={[metrics.gapTickB1, metrics.gapTickB2]} color="#ff9aa8" lineWidth={1.2} />
          <Html
            position={metrics.gapLabel}
            center
            distanceFactor={7}
            className={dimensionClass}
            style={{ pointerEvents: 'none' }}
          >
            <span>Gap {formatLength(metrics.gapMm, metrics.gapScene)}</span>
          </Html>
        </group>
      ) : null}

      <mesh position={metrics.obbCenter} quaternion={obbBasis}>
        <boxGeometry
          args={[
            metrics.fragmentWidthScene,
            metrics.fragmentLengthScene,
            metrics.fragmentDepthScene,
          ]}
        />
        <meshBasicMaterial color="#ff9aa8" wireframe transparent opacity={0.6} />
      </mesh>
      <Html
        position={metrics.obbLabel}
        center
        distanceFactor={7}
        className={labelClass}
        style={{ pointerEvents: 'none' }}
      >
        <span>
          {formatLength(metrics.fragmentWidthMm, metrics.fragmentWidthScene)} ×{' '}
          {formatLength(metrics.fragmentLengthMm, metrics.fragmentLengthScene)} ×{' '}
          {formatLength(metrics.fragmentDepthMm, metrics.fragmentDepthScene)}
        </span>
      </Html>

      <Line points={[metrics.boneLineA, metrics.boneLineB]} color="#7fb7d8" lineWidth={1.2} />
      <Line points={[metrics.boneTickA1, metrics.boneTickA2]} color="#7fb7d8" lineWidth={1.1} />
      <Line points={[metrics.boneTickB1, metrics.boneTickB2]} color="#7fb7d8" lineWidth={1.1} />
      <Html
        position={metrics.boneLabel}
        center
        distanceFactor={7}
        className={labelClass}
        style={{ pointerEvents: 'none' }}
      >
        <span>Bone length {formatLength(metrics.boneLengthMm, metrics.boneLengthScene)}</span>
      </Html>
    </group>
  );
}

function MeasurementOverlay({
  measurements,
  pendingPoint,
  markerSize,
}: {
  measurements: Measurement[];
  pendingPoint: Vec3 | null;
  markerSize: number;
}) {
  return (
    <group>
      {measurements.map((measurement) => (
        <group key={measurement.id}>
          <Line points={[measurement.a, measurement.b]} color={MEASURE_COLOR} lineWidth={2.5} />
          <mesh position={measurement.a}>
            <sphereGeometry args={[markerSize, 14, 14]} />
            <meshStandardMaterial color={MEASURE_COLOR} emissive="#1c8ea8" emissiveIntensity={0.8} />
          </mesh>
          <mesh position={measurement.b}>
            <sphereGeometry args={[markerSize, 14, 14]} />
            <meshStandardMaterial color={MEASURE_COLOR} emissive="#1c8ea8" emissiveIntensity={0.8} />
          </mesh>
          <Html
            position={midpoint(measurement.a, measurement.b)}
            center
            distanceFactor={7}
            className="ct-3d-label ct-measure-label"
            style={{ pointerEvents: 'none' }}
          >
            <span>{formatLength(measurement.lengthMm, measurement.lengthScene)}</span>
          </Html>
        </group>
      ))}
      {pendingPoint ? (
        <mesh position={pendingPoint}>
          <sphereGeometry args={[markerSize, 14, 14]} />
          <meshStandardMaterial color={PENDING_COLOR} emissive="#b57a00" emissiveIntensity={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}

function CameraFocus({
  metrics,
  nonce,
}: {
  metrics: FragmentMetrics | null;
  nonce: number;
}) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (!metrics || nonce === 0) return;
    const target = toVector3(metrics.center);
    camera.position.set(
      metrics.viewPosition[0],
      metrics.viewPosition[1],
      metrics.viewPosition[2],
    );
    camera.lookAt(target);
    const orbit = controls as OrbitControlsImpl | null;
    if (orbit) {
      orbit.target.copy(target);
      orbit.update();
    }
  }, [camera, controls, metrics, nonce]);
  return null;
}

export function CTSurfaceViewer({ surface }: { surface: CTSurface }) {
  const [color, setColor] = useState('#dce5ef');
  const [showFracture, setShowFracture] = useState(true);
  const [showFixation, setShowFixation] = useState(true);
  const [showDimensions, setShowDimensions] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [pendingPoint, setPendingPoint] = useState<Vec3 | null>(null);
  const [focusNonce, setFocusNonce] = useState(1);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const analysis = useMemo(() => analyzeSurface(surface), [surface]);
  const isAnatomy = surface.source === 'monai_anatomy_segmentation';
  const metrics = analysis.metrics;
  const hasFracture = analysis.redMeshes.length > 0;
  const markerSize = Math.max(0.018, (metrics?.boneLengthScene ?? 3.4) * 0.009);

  const handleSurfacePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (!measureMode) return;
    event.stopPropagation();
    const point: Vec3 = [event.point.x, event.point.y, event.point.z];
    if (!pendingPoint) {
      setPendingPoint(point);
      return;
    }
    const lengthScene = length(sub(point, pendingPoint));
    if (lengthScene < 0.005) {
      setPendingPoint(point);
      return;
    }
    setMeasurements((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        a: pendingPoint,
        b: point,
        lengthScene,
        lengthMm: analysis.meshScale ? lengthScene / analysis.meshScale : null,
      },
    ]);
    setPendingPoint(null);
  };

  const toggleMeasure = () => {
    setMeasureMode((value) => !value);
    setPendingPoint(null);
  };

  const clearMeasurements = () => {
    setMeasurements([]);
    setPendingPoint(null);
  };

  const removeMeasurement = (id: string) => {
    setMeasurements((items) => items.filter((item) => item.id !== id));
  };

  const resetView = () => {
    setFocusNonce(0);
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.set(0, 0, 0);
    controls.object.position.set(0, 0.2, 5.4);
    controls.update();
  };

  return (
    <section className="panel ct-surface-panel">
      <div className="playground-heading">
        <div>
          <p className="eyebrow">{isAnatomy ? 'MONAI · Whole Body CT Segmentation' : 'Computed from uploaded CT voxels'}</p>
          <h2>{isAnatomy ? 'Segmented bone anatomy' : 'CT intensity surface'}</h2>
          {isAnatomy ? (
            <p>
              Separate 3D anatomy labels at {surface.spacing_mm} mm spacing.{' '}
              {analysis.detectedByCnn
                ? 'Red shows unverified fracture candidates from the locally trained CNN; the fixation preview is an illustrative construct, not a surgical plan.'
                : analysis.detectedFromGeometry
                  ? 'Red marks a disconnected bone fragment found by surface-continuity analysis, not a trained fracture model. The fixation preview is illustrative only.'
                  : 'No disconnected fragment was detected in this surface; use the measurement tool to inspect the anatomy directly.'}
            </p>
          ) : (
            <p>
              Displaying the {surface.threshold_percentile}th-percentile intensity isosurface
              (threshold {surface.threshold_intensity.toFixed(2)}); this is not bone segmentation.
              {analysis.detectedByCnn ? ' Red shows unverified CNN fracture candidates.' : ''}
            </p>
          )}
        </div>
        {!isAnatomy ? (
          <label className="ct-surface-color">
            <span>Display color</span>
            <input
              aria-label="CT surface color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div
        className={`playground-canvas ct-surface-canvas${measureMode ? ' is-measuring' : ''}`}
      >
        <Canvas camera={{ position: metrics ? metrics.viewPosition : [0, 0.2, 5.4], fov: 42 }}>
          <color attach="background" args={['#0a1521']} />
          <ambientLight intensity={1.3} />
          <directionalLight position={[4, 5, 7]} intensity={2.2} />
          <directionalLight position={[-4, -2, -3]} intensity={0.8} color="#5e8cae" />
          {analysis.baseMeshes.map((mesh) => (
            <SurfaceMesh
              key={mesh.id}
              vertices={mesh.vertices}
              faces={mesh.faces}
              color={mesh.color}
              onPointerDown={handleSurfacePointerDown}
            />
          ))}
          {showFracture
            ? analysis.redMeshes.map((mesh) => (
              <SurfaceMesh
                key={mesh.id}
                vertices={mesh.vertices}
                faces={mesh.faces}
                color={mesh.color}
                overlay={analysis.detectedByCnn}
                fragment
                onPointerDown={handleSurfacePointerDown}
              />
            ))
            : null}
          {metrics && showFixation ? <FixationPreview metrics={metrics} /> : null}
          {metrics && showDimensions ? <FractureAnnotations metrics={metrics} /> : null}
          <MeasurementOverlay
            measurements={measurements}
            pendingPoint={pendingPoint}
            markerSize={markerSize}
          />
          <CameraFocus metrics={metrics} nonce={focusNonce} />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enabled={!measureMode}
            enablePan
            enableZoom
            enableRotate
            minDistance={2.5}
            maxDistance={10}
          />
        </Canvas>
        <div className="playground-canvas-label">
          {measureMode
            ? 'MEASURE MODE · CLICK TWO POINTS'
            : isAnatomy
              ? 'MONAI · BONE ANATOMY LABELS'
              : 'CT-DERIVED · INTENSITY SURFACE'}
        </div>
        <div className="ct-surface-hud">
          {metrics ? (
            <button
              type="button"
              className="ct-hud-button"
              title="Focus the fracture and fixation preview"
              onClick={() => setFocusNonce((nonce) => nonce + 1)}
            >
              <Focus size={15} /> Fracture view
            </button>
          ) : null}
          <button
            type="button"
            className="ct-hud-button icon"
            aria-label="Reset CT surface view"
            title="Reset camera"
            onClick={resetView}
          >
            <RotateCcw size={15} />
          </button>
        </div>
        <div className="playground-controls ct-surface-controls">
          <button
            type="button"
            className={measureMode ? 'active' : ''}
            onClick={toggleMeasure}
          >
            <Crosshair size={14} /> {measureMode ? 'Selecting points' : 'Measure 2 points'}
          </button>
          <button
            type="button"
            onClick={clearMeasurements}
            disabled={!measurements.length}
          >
            <Trash2 size={14} /> Clear
          </button>
          {hasFracture ? (
            <button
              type="button"
              className={showFracture ? 'active' : ''}
              onClick={() => setShowFracture((value) => !value)}
            >
              <Bone size={14} /> Fracture red
            </button>
          ) : null}
          {metrics ? (
            <button
              type="button"
              className={showFixation ? 'active' : ''}
              onClick={() => setShowFixation((value) => !value)}
            >
              <Wrench size={14} /> Fixation
            </button>
          ) : null}
          {metrics ? (
            <button
              type="button"
              className={showDimensions ? 'active' : ''}
              onClick={() => setShowDimensions((value) => !value)}
            >
              <Ruler size={14} /> Dimensions
            </button>
          ) : null}
          {measureMode ? (
            <span className="ct-measure-hint">Click two points on the bone surface.</span>
          ) : null}
        </div>
      </div>

      <div className="ct-surface-meta">
        <span>{surface.vertex_count.toLocaleString()} vertices</span>
        <span>{surface.face_count.toLocaleString()} faces</span>
        {isAnatomy
          ? surface.parts.map((part) => (
            <span key={part.name} className="ct-anatomy-label">
              <i style={{ backgroundColor: part.color }} />
              {part.name} · {part.voxel_count.toLocaleString()} voxels
            </span>
          ))
          : <span>Surface threshold based on scan intensity percentiles</span>}
        {analysis.detectedByCnn && surface.fracture_part ? (
          <span className="ct-anatomy-label">
            <i style={{ backgroundColor: surface.fracture_part.color }} />
            {surface.fracture_part.name} · {surface.fracture_part.voxel_count.toLocaleString()} candidate voxels
          </span>
        ) : null}
        {analysis.detectedFromGeometry ? (
          <span className="ct-anatomy-label">
            <i style={{ backgroundColor: FRACTURE_COLOR }} />
            Possible fracture fragment · {metrics?.fragmentVertexCount.toLocaleString() ?? '—'} vertices
          </span>
        ) : null}
      </div>

      <div className="ct-surface-insights">
        <article className="ct-insight-card">
          <p className="eyebrow"><Bone size={14} /> {analysis.detectedByCnn ? 'Fracture zone' : 'Fracture fragment'}</p>
          {metrics ? (
            <div className="ct-insight-grid">
              <div>
                <span>{analysis.detectedByCnn ? 'Zone width' : 'Fragment width'}</span>
                <strong>{formatLength(metrics.fragmentWidthMm, metrics.fragmentWidthScene)}</strong>
              </div>
              <div>
                <span>{analysis.detectedByCnn ? 'Zone length' : 'Fragment length'}</span>
                <strong>{formatLength(metrics.fragmentLengthMm, metrics.fragmentLengthScene)}</strong>
              </div>
              <div>
                <span>{analysis.detectedByCnn ? 'Zone depth' : 'Fragment depth'}</span>
                <strong>{formatLength(metrics.fragmentDepthMm, metrics.fragmentDepthScene)}</strong>
              </div>
              <div>
                <span>{metrics.showGap ? 'Gap' : 'Bone length'}</span>
                <strong>
                  {metrics.showGap
                    ? formatLength(metrics.gapMm, metrics.gapScene)
                    : formatLength(metrics.boneLengthMm, metrics.boneLengthScene)}
                </strong>
              </div>
            </div>
          ) : (
            <p className="ct-insight-empty">
              No disconnected fragment was detected. Use the measurement tool to inspect dimensions directly.
            </p>
          )}
          {metrics ? (
            <p className="ct-insight-note">
              Derived from the scan-derived surface{analysis.meshScale ? '' : ' (millimeter scale unavailable)'}.
            </p>
          ) : null}
        </article>

        <article className="ct-insight-card">
          <p className="eyebrow"><Ruler size={14} /> Measurements</p>
          {measurements.length ? (
            <ul className="ct-measure-list">
              {measurements.map((measurement, index) => (
                <li key={measurement.id}>
                  <span>M{index + 1}</span>
                  <strong>{formatLength(measurement.lengthMm, measurement.lengthScene)}</strong>
                  <button
                    type="button"
                    aria-label={`Remove measurement ${index + 1}`}
                    onClick={() => removeMeasurement(measurement.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ct-insight-empty">
              Activate <strong>Measure 2 points</strong> and click two points on the bone surface to get a length{' '}
              {analysis.meshScale ? 'in millimeters' : 'in relative scene units (millimeter scale unavailable)'}.
            </p>
          )}
          {measureMode ? (
            <p className="ct-measure-status">
              {pendingPoint ? 'First point set. Select the second point.' : 'Select the first point on the bone surface.'}
            </p>
          ) : null}
        </article>
      </div>

      <p className="playground-disclaimer">
        {analysis.detectedByCnn
          ? 'EXPERIMENTAL MODEL OUTPUT — Red regions are unverified fracture candidates from a locally trained CNN; they are not confirmed fractures or a diagnosis. The plate, screws, and dimensions are an illustrative construct, not a validated surgical plan. Measurements are derived from the rendered surface and may be inaccurate. Expert review is required.'
          : analysis.detectedFromGeometry
            ? 'GEOMETRIC VISUALIZATION — Red marks a disconnected surface fragment detected by connectivity analysis, not a trained fracture model or a diagnosis. The plate, screws, and dimensions are illustrative only and are not a surgical plan. Measurements are derived from the rendered surface and require clinician verification.'
            : isAnatomy
              ? 'ANATOMY SEGMENTATION ONLY — The MONAI model labels anatomical structures; it does not detect, distinguish, color, or rebuild fractures. The measure tool reports distances on the rendered surface and is not a clinical measurement device. No diagnosis or surgical plan is provided. The bundle cites TotalSegmentator data (CC-BY-4.0); attribution is required.'
              : 'VISUALIZATION ONLY — Raw-intensity thresholding does not separate bone, muscle, or fracture. It can include unrelated high-intensity structures and is not a diagnosis or surgical plan.'}
      </p>
    </section>
  );
}
