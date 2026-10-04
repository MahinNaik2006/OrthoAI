import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { CatmullRomCurve3, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';

type PlaygroundMode = 'fracture' | 'postoperative';

function makeRibCurve(side: -1 | 1, level: number) {
  const y = 1.35 - level * 0.38;
  const width = 1.22 - level * 0.045;
  return new CatmullRomCurve3([
    new Vector3(side * 0.1, y + 0.06, 0.02),
    new Vector3(side * width * 0.62, y + 0.13, 0.08),
    new Vector3(side * width, y - 0.06, 0.22),
    new Vector3(side * width * 0.88, y - 0.31, 0.43),
    new Vector3(side * width * 0.54, y - 0.44, 0.56),
    new Vector3(side * 0.14, y - 0.46, 0.59),
  ]);
}

function Rib({
  side,
  level,
  color,
  fractureColor,
  highlighted,
  showFracture,
}: {
  side: -1 | 1;
  level: number;
  color: string;
  fractureColor: string;
  highlighted: boolean;
  showFracture: boolean;
}) {
  const { upper, lower, markPosition } = useMemo(() => {
    const curve = makeRibCurve(side, level);
    const cutStart = 0.66;
    const cutEnd = 0.73;
    return {
      upper: new CatmullRomCurve3(curve.getPoints(40).slice(0, Math.floor(40 * cutStart) + 1)),
      lower: new CatmullRomCurve3(curve.getPoints(40).slice(Math.floor(40 * cutEnd))),
      markPosition: curve.getPoint(0.695),
    };
  }, [level, side]);

  const splitForDemo = highlighted && showFracture;
  const makeSegment = (curve: CatmullRomCurve3) => (
    <mesh>
      <tubeGeometry args={[curve, 36, 0.055, 8, false]} />
      <meshStandardMaterial color={color} roughness={0.65} metalness={0.12} />
    </mesh>
  );

  return (
    <group>
      {splitForDemo ? (
        <>
          {makeSegment(upper)}
          {makeSegment(lower)}
          <mesh position={[markPosition.x + side * 0.08, markPosition.y + 0.045, markPosition.z + 0.04]} rotation={[0.25, 0.15, side * -0.35]}>
            <coneGeometry args={[0.09, 0.2, 5]} />
            <meshStandardMaterial color={fractureColor} emissive={fractureColor} emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[markPosition.x - side * 0.06, markPosition.y - 0.065, markPosition.z - 0.025]} rotation={[0.3, -0.2, side * 0.4]}>
            <coneGeometry args={[0.07, 0.16, 5]} />
            <meshStandardMaterial color={fractureColor} emissive={fractureColor} emissiveIntensity={0.4} />
          </mesh>
        </>
      ) : (
        makeSegment(makeRibCurve(side, level))
      )}
    </group>
  );
}

function Spine({ color }: { color: string }) {
  return (
    <group>
      {Array.from({ length: 8 }, (_, index) => (
        <mesh key={index} position={[0, 1.42 - index * 0.39, -0.04]}>
          <cylinderGeometry args={[0.15, 0.17, 0.3, 16]} />
          <meshStandardMaterial color={color} roughness={0.72} />
        </mesh>
      ))}
    </group>
  );
}

function MuscleLayer({ color, visible }: { color: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <mesh position={[0, -0.1, -0.25]} scale={[1.18, 1.5, 0.18]}>
      <sphereGeometry args={[1, 28, 20]} />
      <meshStandardMaterial color={color} transparent opacity={0.18} roughness={0.9} depthWrite={false} />
    </mesh>
  );
}

function FixationHardware({ color }: { color: string }) {
  return (
    <group position={[0.76, -0.25, 0.57]} rotation={[0, 0.03, -0.16]}>
      <mesh>
        <boxGeometry args={[0.15, 0.82, 0.09]} />
        <meshStandardMaterial color={color} metalness={0.75} roughness={0.28} />
      </mesh>
      {[-0.3, -0.1, 0.12, 0.32].map((y) => (
        <group key={y} position={[0, y, 0.06]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.048, 0.048, 0.045, 16]} />
            <meshStandardMaterial color={color} metalness={0.82} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, -0.18]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.38, 12]} />
            <meshStandardMaterial color={color} metalness={0.8} roughness={0.26} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Scene({
  mode,
  boneColor,
  muscleColor,
  fractureColor,
  fixationColor,
  showMuscle,
  showFracture,
  showHardware,
  controlsRef,
}: {
  mode: PlaygroundMode;
  boneColor: string;
  muscleColor: string;
  fractureColor: string;
  fixationColor: string;
  showMuscle: boolean;
  showFracture: boolean;
  showHardware: boolean;
  controlsRef?: RefObject<OrbitControlsImpl | null>;
}) {
  return (
    <>
      <color attach="background" args={[mode === 'fracture' ? '#0a1521' : '#091a1b']} />
      <ambientLight intensity={1.4} />
      <directionalLight position={[4, 5, 7]} intensity={2.1} />
      <pointLight position={[-4, -1, 3]} color={mode === 'fracture' ? '#ff394f' : '#31d98b'} intensity={0.42} />
      <group position={[0, -0.03, 0]}>
        <MuscleLayer color={muscleColor} visible={showMuscle} />
        <Spine color={boneColor} />
        {Array.from({ length: 6 }, (_, index) => (
          <group key={index}>
            <Rib
              side={-1}
              level={index}
              color={boneColor}
              fractureColor={fractureColor}
              highlighted={false}
              showFracture={mode === 'fracture' && showFracture}
            />
            <Rib
              side={1}
              level={index}
              color={boneColor}
              fractureColor={fractureColor}
              highlighted={index === 4}
              showFracture={mode === 'fracture' && showFracture}
            />
          </group>
        ))}
        {mode === 'postoperative' && showHardware ? <FixationHardware color={fixationColor} /> : null}
      </group>
      <OrbitControls ref={controlsRef} makeDefault enablePan enableZoom enableRotate minDistance={3} maxDistance={10} />
    </>
  );
}

export function AnatomyPlayground({ mode }: { mode: PlaygroundMode }) {
  const [boneColor, setBoneColor] = useState('#dce5ef');
  const [muscleColor, setMuscleColor] = useState('#758b9d');
  const [fractureColor, setFractureColor] = useState('#ff334f');
  const [fixationColor, setFixationColor] = useState('#37d486');
  const [showMuscle, setShowMuscle] = useState(true);
  const [showStructure, setShowStructure] = useState(true);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const isFracture = mode === 'fracture';
  const resetCamera = () => controlsRef.current?.reset();

  return (
    <section className={`panel anatomy-playground ${isFracture ? 'fracture-playground' : 'after-playground'}`}>
      <div className="playground-heading">
        <div>
          <p className="eyebrow">{isFracture ? 'Playground 01 · preoperative' : 'Playground 02 · virtual simulation'}</p>
          <h2>{isFracture ? 'Fractured anatomy' : 'Proposed after fixation'}</h2>
          <p>{isFracture ? 'Explore the illustrative fracture overlay and surrounding anatomy.' : 'Explore a virtual reduced alignment with a conceptual green fixation plate.'}</p>
        </div>
        <span className={`playground-state ${isFracture ? 'fracture-state' : 'after-state'}`}>
          <span /> {isFracture ? 'FRACTURE · RED' : 'SIMULATION · GREEN'}
        </span>
      </div>

      <div className="playground-canvas">
        <Canvas camera={{ position: [0, 0.15, 5.7], fov: 43 }}>
          <Scene
            mode={mode}
            boneColor={boneColor}
            muscleColor={muscleColor}
            fractureColor={fractureColor}
            fixationColor={fixationColor}
            showMuscle={showMuscle}
            showFracture={showStructure}
            showHardware={showStructure}
            controlsRef={controlsRef}
          />
        </Canvas>
        <div className="playground-canvas-label">{isFracture ? 'BEFORE · FRACTURE OVERLAY' : 'AFTER · VIRTUAL FIXATION'}</div>
        <button type="button" className="playground-reset" aria-label="Reset 3D view" title="Reset camera" onClick={resetCamera}>
          <RotateCcw size={15} />
        </button>
        <div className="playground-controls">
          <label title="Change the display color of the illustrative bone layer">
            <span>Bone</span><input type="color" value={boneColor} onChange={(event) => setBoneColor(event.target.value)} />
          </label>
          <label title="Change the display color of the illustrative soft-tissue layer">
            <span>Muscle layer</span><input type="color" value={muscleColor} onChange={(event) => setMuscleColor(event.target.value)} />
          </label>
          {isFracture ? (
            <label title="Change the illustrative fracture overlay color">
              <span>Fracture</span><input type="color" value={fractureColor} onChange={(event) => setFractureColor(event.target.value)} />
            </label>
          ) : (
            <label title="Change the conceptual fixation color">
              <span>Fixation</span><input type="color" value={fixationColor} onChange={(event) => setFixationColor(event.target.value)} />
            </label>
          )}
          <button type="button" onClick={() => setShowMuscle((visible) => !visible)}>
            {showMuscle ? <Eye size={14} /> : <EyeOff size={14} />} Muscle
          </button>
          <button type="button" onClick={() => setShowStructure((visible) => !visible)}>
            {showStructure ? <Eye size={14} /> : <EyeOff size={14} />} {isFracture ? 'Break' : 'Fixation'}
          </button>
        </div>
      </div>

      <div className="playground-legend">
        <span><i className="legend-bone" />Bone illustration</span>
        <span><i className="legend-muscle" />Soft-tissue placeholder</span>
        {isFracture ? <span><i className="legend-fracture" />Illustrative break</span> : <span><i className="legend-fixation" />Virtual fixation plate</span>}
      </div>
      <p className="playground-disclaimer">
        {isFracture
          ? 'DEMO VISUALIZATION — This illustrative break is not segmented from the uploaded scan. No validated fracture model is configured.'
          : 'VIRTUAL SIMULATION — Conceptual alignment and fixation only. It does not represent a surgical plan or guarantee an outcome.'}
      </p>
    </section>
  );
}

export function Viewer3D({ mode = 'before' }: { mode?: 'before' | 'after' }) {
  const playgroundMode = mode === 'before' ? 'fracture' : 'postoperative';
  return (
    <div className="viewer-pane">
      <Canvas camera={{ position: [0, 0.15, 5.7], fov: 43 }}>
        <Scene
          mode={playgroundMode}
          boneColor="#dce5ef"
          muscleColor="#758b9d"
          fractureColor="#ff334f"
          fixationColor="#37d486"
          showMuscle
          showFracture
          showHardware
        />
      </Canvas>
      <div className="viewer-overlay">{mode === 'before' ? 'BEFORE · DEMO' : 'VIRTUAL AFTER'}</div>
    </div>
  );
}
