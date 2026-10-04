import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { RotateCcw } from 'lucide-react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CTSurface, CTSurfacePart } from '../services/api';

function SurfaceMesh({
  vertices,
  faces,
  color,
  overlay = false,
}: {
  vertices: number[];
  faces: number[];
  color: string;
  overlay?: boolean;
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
    <mesh geometry={geometry} renderOrder={overlay ? 2 : 1}>
      <meshStandardMaterial
        color={color}
        roughness={0.72}
        metalness={0.04}
        side={DoubleSide}
        polygonOffset={overlay}
        polygonOffsetFactor={overlay ? -2 : 0}
      />
    </mesh>
  );
}

function AnatomyPartMesh({ part }: { part: CTSurfacePart }) {
  return <SurfaceMesh vertices={part.vertices} faces={part.faces} color={part.color} />;
}

export function CTSurfaceViewer({ surface }: { surface: CTSurface }) {
  const [color, setColor] = useState('#dce5ef');
  const [showFractureCandidates, setShowFractureCandidates] = useState(true);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const isAnatomy = surface.source === 'monai_anatomy_segmentation';
  const fracturePart = surface.fracture_part;

  return (
    <section className="panel ct-surface-panel">
      <div className="playground-heading">
        <div>
          <p className="eyebrow">{isAnatomy ? 'MONAI · Whole Body CT Segmentation' : 'Computed from uploaded CT voxels'}</p>
          <h2>{isAnatomy ? 'Segmented bone anatomy' : 'CT intensity surface'}</h2>
          {isAnatomy ? (
            <p>
              Separate 3D anatomy labels at {surface.spacing_mm} mm spacing.
              {fracturePart ? ' Red shows unverified fracture candidates from the locally trained CNN.' : ' A compatible trained fracture model is not available for this case.'}
            </p>
          ) : (
            <p>
              Displaying the {surface.threshold_percentile}th-percentile intensity isosurface
              (threshold {surface.threshold_intensity.toFixed(2)}); this is not bone segmentation.
            </p>
          )}
        </div>
        {fracturePart ? (
          <label className="ct-surface-color">
            <span>Show red model candidates</span>
            <input
              aria-label="Show predicted fracture candidates"
              type="checkbox"
              checked={showFractureCandidates}
              onChange={(event) => setShowFractureCandidates(event.target.checked)}
            />
          </label>
        ) : isAnatomy ? null : (
          <label className="ct-surface-color">
            <span>Display color</span>
            <input aria-label="CT surface color" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        )}
      </div>

      <div className="playground-canvas ct-surface-canvas">
        <Canvas camera={{ position: [0, 0.2, 5.4], fov: 42 }}>
          <color attach="background" args={['#0a1521']} />
          <ambientLight intensity={1.3} />
          <directionalLight position={[4, 5, 7]} intensity={2.2} />
          <directionalLight position={[-4, -2, -3]} intensity={0.8} color="#5e8cae" />
          {isAnatomy
            ? surface.parts.map((part) => <AnatomyPartMesh key={part.name} part={part} />)
            : <SurfaceMesh vertices={surface.vertices} faces={surface.faces} color={color} />}
          {fracturePart && showFractureCandidates ? (
            <SurfaceMesh
              vertices={fracturePart.vertices}
              faces={fracturePart.faces}
              color={fracturePart.color}
              overlay
            />
          ) : null}
          <OrbitControls ref={controlsRef} makeDefault enablePan enableZoom enableRotate minDistance={2.5} maxDistance={10} />
        </Canvas>
        <div className="playground-canvas-label">
          {isAnatomy ? 'MONAI · BONE ANATOMY LABELS' : 'CT-DERIVED · INTENSITY SURFACE'}
        </div>
        <button
          type="button"
          className="playground-reset"
          aria-label="Reset CT surface view"
          title="Reset camera"
          onClick={() => controlsRef.current?.reset()}
        >
          <RotateCcw size={15} />
        </button>
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
        {fracturePart ? (
          <span className="ct-anatomy-label">
            <i style={{ backgroundColor: fracturePart.color }} />
            {fracturePart.name} · {fracturePart.voxel_count.toLocaleString()} candidate voxels
          </span>
        ) : null}
      </div>
      <p className="playground-disclaimer">
        {fracturePart
          ? 'EXPERIMENTAL MODEL OUTPUT — Red regions are unverified fracture candidates from a locally trained CNN; they are not confirmed fractures or a diagnosis. This is not a surgical plan. Expert review is required.'
          : isAnatomy
            ? 'ANATOMY SEGMENTATION ONLY — The MONAI model labels anatomical structures; it does not detect, distinguish, color, or rebuild fractures. No diagnosis or surgical plan is provided. The bundle cites TotalSegmentator data (CC-BY-4.0); attribution is required.'
            : 'VISUALIZATION ONLY — Raw-intensity thresholding does not separate bone, muscle, or fracture. It can include unrelated high-intensity structures and is not a diagnosis or surgical plan.'}
      </p>
    </section>
  );
}
